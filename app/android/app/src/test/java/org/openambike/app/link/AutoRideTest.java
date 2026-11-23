package org.openambike.app.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

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

    /** The bike reports movement once a second for {@code ms}, ticking as the service does. */
    private void move(long ms) {
        for (long end = now + ms; now < end; now += 1000) {
            ride.bikeMoved(now);
            ride.tick(now);
        }
    }

    private void stand(long ms) {
        for (long end = now + ms; now < end; now += 1000) ride.tick(now);
    }

    @Test
    public void aRideStartsOnceTheBikeMovedFor20Seconds() {
        move(20_000);
        assertEquals(List.of(), done);
        move(2_000);
        assertEquals(List.of("start"), done);
    }

    @Test
    public void wheelingTheBikeOutInShortPushesStartsNoRide() {
        for (int i = 0; i < 10; i++) {
            move(5_000);
            stand(5_000);
        }
        assertEquals(List.of(), done);
    }

    @Test
    public void aRideItStartedStopsAfter15MinutesStandingAndEndsAtItsLastMovement() {
        move(22_000);
        long lastMoved = now - 1000;
        stand(14 * 60_000);
        assertEquals(List.of("start"), done);
        stand(60_000);
        assertEquals(List.of("start", "stop at " + lastMoved), done);
    }

    @Test
    public void gpsMovementKeepsTheRideGoingWithoutTheBike() {
        move(22_000);
        for (int i = 0; i < 20 * 60; i++) {
            ride.gpsMoved(now);
            stand(1000);
        }
        assertEquals(List.of("start"), done);
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

    @Test
    public void thePreviewCountsDownToTheStartWhileMovingAndToTheStopWhileStanding() {
        move(10_000);
        AutoRide.Preview moving = ride.preview(now);
        assertFalse(moving.riding);
        assertEquals(Long.valueOf(11_000), moving.startInMs);
        move(12_000);
        stand(5_000);
        AutoRide.Preview standing = ride.preview(now);
        assertTrue(standing.riding);
        assertNull(standing.startInMs);
        assertEquals(Long.valueOf(15 * 60_000 - 6_000), standing.stopInMs);
    }
}
