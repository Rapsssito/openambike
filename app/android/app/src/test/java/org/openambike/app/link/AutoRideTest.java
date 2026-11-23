package org.openambike.app.link;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;

public class AutoRideTest {
    private final List<String> done = new ArrayList<>();
    private AutoRide ride;
    private long now;

    @Before
    public void setUp() {
        ride = new AutoRide(
            new AutoRide.Actions() {
                @Override
                public void startRide() {
                    done.add("start");
                }

                @Override
                public void stopRide(long lastMoved) {
                    done.add("stop at " + lastMoved);
                }
            },
            new AutoRide.Settings()
        );
        now = 1_000_000;
    }

    /** The bike, pedalled, reports movement once a second for {@code ms}, ticking as the service does. */
    private void move(long ms) {
        report(ms, true);
    }

    /** The bike reports movement with no rider's power, as when wheeled, once a second for {@code ms}. */
    private void wheel(long ms) {
        report(ms, false);
    }

    private void report(long ms, boolean pedalled) {
        for (long end = now + ms; now < end; now += 1000) {
            ride.bikeMoved(now, pedalled);
            ride.tick(now);
        }
    }

    private void stand(long ms) {
        for (long end = now + ms; now < end; now += 1000) ride.tick(now);
    }

    @Test
    public void aRideStartsOnceTheBikeMovedFor5SecondsFromThePedalling() {
        move(5_000);
        assertEquals(List.of(), done);
        move(1_000);
        assertEquals(List.of("start"), done);
    }

    @Test
    public void wheelingTheBikeStartsNoRide() {
        wheel(10 * 60_000);
        assertEquals(List.of(), done);
    }

    @Test
    public void movementBeforeThePedallingDoesNotCount() {
        wheel(30_000);
        move(5_000);
        assertEquals(List.of(), done);
        move(1_000);
        assertEquals(List.of("start"), done);
    }

    @Test
    public void aMomentStandingCountsTheMovementAgainFromTheNextPedalling() {
        move(4_000);
        stand(4_000);
        wheel(10_000);
        assertEquals(List.of(), done);
        move(5_000);
        assertEquals(List.of(), done);
        move(1_000);
        assertEquals(List.of("start"), done);
    }

    @Test
    public void aShortGapWithinTheMovementKeepsTheCount() {
        move(3_000);
        stand(2_000);
        wheel(1_000);
        assertEquals(List.of("start"), done);
    }

    @Test
    public void aRideItStartedGoesOnWhileTheBikeStandsUntilAutoConnectLetsItGo() {
        move(6_000);
        long lastMoved = now - 1000;
        stand(30 * 60_000);
        assertEquals(List.of("start"), done);
        ride.letGo();
        assertEquals(List.of("start", "stop at " + lastMoved), done);
    }

    @Test
    public void aRideItStartedStopsWhenAutoConnectLetsTheBikeGo() {
        move(22_000);
        long lastMoved = now - 1000;
        stand(30_000);
        ride.letGo();
        assertEquals(List.of("start", "stop at " + lastMoved), done);
    }

    @Test
    public void aRideStartedByHandIsStoppedOnlyByHand() {
        ride.startedByHand(now);
        stand(20 * 60_000);
        ride.letGo();
        assertEquals(List.of(), done);
    }

    @Test
    public void afterAStopByHandNoRideStartsUntilTheBikeStoodStillFor15Minutes() {
        move(22_000);
        ride.stoppedByHand();
        move(60_000);
        assertEquals(List.of("start"), done);
        stand(15 * 60_000);
        move(22_000);
        assertEquals(List.of("start", "start"), done);
    }

    @Test
    public void afterAStopByHandARideStartsAgainOnceTheBikeWasLetGo() {
        move(22_000);
        ride.stoppedByHand();
        ride.letGo();
        move(22_000);
        assertEquals(List.of("start", "start"), done);
    }
}
