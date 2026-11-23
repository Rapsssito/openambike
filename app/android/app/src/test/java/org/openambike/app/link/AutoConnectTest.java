package org.openambike.app.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;

public class AutoConnectTest {
    /** Records what auto-connect asks for, as text. */
    private static final class Recorder implements AutoConnect.Actions {
        final List<String> done = new ArrayList<>();

        @Override
        public void scan(boolean fast) {
            done.add(fast ? "scan fast" : "scan slow");
        }

        @Override
        public void stopScan() {
            done.add("stop scan");
        }

        @Override
        public void connect() {
            done.add("connect");
        }

        @Override
        public void readRssi() {}

        @Override
        public void lock() {
            done.add("lock");
        }

        @Override
        public void unlock() {
            done.add("unlock");
        }

        @Override
        public void disconnect() {
            done.add("disconnect");
        }

        @Override
        public void status(AutoConnect.Status status) {}

        @Override
        public void alert(AutoConnect.Alert alert) {
            done.add("alert " + alert);
        }

        boolean did(String action) {
            return done.contains(action);
        }
    }

    private Recorder actions;
    private AutoConnect.Settings settings;
    private AutoConnect auto;
    private long now;

    @Before
    public void setUp() {
        actions = new Recorder();
        settings = new AutoConnect.Settings();
        settings.autoLock = true;
        auto = new AutoConnect(actions, settings);
        now = 1_000_000;
    }

    /** Hears the bike at {@code rssi} every half second for {@code ms}, ticking as the service does. */
    private void hear(int rssi, long ms) {
        for (long end = now + ms; now < end; now += 500) {
            auto.heard(rssi, now);
            auto.tick(now);
        }
    }

    /** Reads the connection's signal at {@code rssi} every half second for {@code ms}. */
    private void signal(int rssi, long ms) {
        for (long end = now + ms; now < end; now += 500) {
            auto.rssi(rssi, now);
            auto.tick(now);
        }
    }

    private void connectedInBackground() {
        auto.start(now);
        hear(-60, 11_000);
        auto.linkUp(now);
        assertEquals(AutoConnect.State.CONNECTED, auto.state());
    }

    @Test
    public void inTheBackgroundItLooksSlowlyThenFastNearTheBikeThenConnects() {
        auto.start(now);
        assertEquals(List.of("scan slow"), actions.done);
        hear(-65, 4_000);
        assertTrue(actions.did("scan fast"));
        assertFalse(actions.did("connect"));
        hear(-65, 1_500);
        assertTrue(actions.did("connect"));
        assertEquals(AutoConnect.State.CONNECTING, auto.state());
    }

    @Test
    public void aBikeHeardOnlyFarAwayIsNotConnected() {
        auto.start(now);
        hear(-80, 60_000);
        assertFalse(actions.did("scan fast"));
        assertFalse(actions.did("connect"));
    }

    @Test
    public void aBikeNearForAMomentOnlyIsNotConnectedAndTheScanSlowsDownAgain() {
        auto.start(now);
        hear(-65, 1_000);
        hear(-80, 20_000);
        assertFalse(actions.did("connect"));
        assertEquals(AutoConnect.State.IDLE, auto.state());
    }

    @Test
    public void aConnectionTheAppMadeFromAfarIsNotLetGoUntilTheRiderWasNearAndLeft() {
        auto.start(now);
        auto.lockState(false);
        auto.linkUp(now);
        assertEquals(AutoConnect.State.CONNECTED, auto.state());
        assertTrue(actions.did("stop scan"));
        assertEquals(AutoConnect.Event.APP_CONNECTED, auto.history().get(0).event);
        signal(-90, 60_000);
        assertFalse(actions.did("lock"));
        assertFalse(actions.did("disconnect"));
        signal(-60, 5_000);
        signal(-90, 5_000);
        assertTrue(actions.did("lock"));
    }

    @Test
    public void walkingAwayLocksThenDisconnects() {
        connectedInBackground();
        auto.lockState(false);
        signal(-60, 30_000);
        signal(-90, 5_500);
        assertEquals(List.of("lock"), actions.done.subList(actions.done.size() - 1, actions.done.size()));
        auto.lockDone(true, now);
        assertTrue(actions.did("disconnect"));
        auto.linkDown(now);
        assertEquals(AutoConnect.State.IDLE, auto.state());
        assertFalse(actions.did("alert MAY_BE_UNLOCKED"));
    }

    @Test
    public void aBikeAlreadyLockedIsNotLockedAgain() {
        connectedInBackground();
        auto.lockState(true);
        signal(-60, 30_000);
        signal(-90, 5_500);
        assertFalse(actions.did("lock"));
        assertTrue(actions.did("disconnect"));
        assertEquals(AutoConnect.Event.LEFT_LOCKED_AWAY, auto.history().get(0).event);
    }

    @Test
    public void withoutAutoLockWalkingAwayOnlyDisconnects() {
        settings.autoLock = false;
        connectedInBackground();
        signal(-60, 30_000);
        signal(-90, 5_500);
        assertFalse(actions.did("lock"));
        assertTrue(actions.did("disconnect"));
    }

    @Test
    public void itNeverLocksWhileTheBikeMovedInTheLast30Seconds() {
        connectedInBackground();
        signal(-60, 31_000);
        auto.moved(now);
        signal(-90, 20_000);
        assertFalse(actions.did("lock"));
        signal(-90, 11_000);
        assertTrue(actions.did("lock"));
    }

    @Test
    public void walkingAwayRightAfterConnectingLocksWithoutWaitingForTheRideGuard() {
        connectedInBackground();
        auto.lockState(false);
        signal(-90, settings.farMs + 1_000);
        assertTrue(actions.did("lock"));
    }

    @Test
    public void aConnectionJustMadeIsNotTakenForAParkedBike() {
        connectedInBackground();
        signal(-60, 60_000);
        assertFalse(actions.did("lock"));
        assertFalse(actions.did("disconnect"));
    }

    @Test
    public void theHistorySaysWhatItDidAndWhyNewestFirst() {
        connectedInBackground();
        auto.lockState(false);
        signal(-60, 5_000);
        auto.moved(now);
        signal(-90, settings.farMs + 1_000);
        signal(-90, settings.rideGuardMs);
        auto.lockDone(true, now);
        List<AutoConnect.Event> events = new java.util.ArrayList<>();
        for (AutoConnect.Entry entry : auto.history()) events.add(entry.event);
        assertEquals(
            List.of(
                AutoConnect.Event.LOCKED,
                AutoConnect.Event.LOCKING_AWAY,
                AutoConnect.Event.WAITING_MOVED,
                AutoConnect.Event.CONNECTING
            ),
            events
        );
        assertEquals(-90, auto.history().get(1).value);
        assertEquals(-60, auto.history().get(3).value);
    }

    @Test
    public void oneDeepDipInThreeDoesNotLockForTheMedianDecides() {
        connectedInBackground();
        auto.lockState(false);
        // Two readings in three near, one far below, as the rider's body blocks the phone: the mean is about -90 dBm,
        // below the far threshold, but the median is -70.
        for (long end = now + 30_000, i = 0; now < end; now += 500, i++) {
            auto.rssi(i % 3 == 0 ? -130 : -70, now);
            auto.tick(now);
        }
        assertFalse(actions.did("lock"));
        signal(-90, settings.farMs + 1_000);
        assertTrue(actions.did("lock"));
    }

    @Test
    public void aSignalJustAboveTheFarThresholdDoesNotLock() {
        connectedInBackground();
        signal(-60, 31_000);
        signal(settings.farDbm + 2, 60_000);
        assertFalse(actions.did("lock"));
        assertFalse(actions.did("disconnect"));
    }

    @Test
    public void parkedNearFor15MinutesItLocksDisconnectsAndPausesUntilResumed() {
        connectedInBackground();
        signal(-60, 15 * 60_000 + 1_000);
        assertTrue(actions.did("lock"));
        auto.lockDone(true, now);
        auto.linkDown(now);
        assertEquals(AutoConnect.State.PAUSED, auto.state());
        assertTrue(actions.did("alert PAUSED_PARKED"));
        int before = actions.done.size();
        hear(-60, 30_000);
        assertEquals(before, actions.done.size());
        auto.resume(now);
        assertEquals(AutoConnect.State.IDLE, auto.state());
    }

    @Test
    public void aPauseForStandingNearEndsOnceTheRiderHasLeftForAMinute() {
        connectedInBackground();
        signal(-60, 15 * 60_000 + 1_000);
        auto.lockDone(true, now);
        auto.linkDown(now);
        assertEquals(AutoConnect.State.PAUSED, auto.state());
        assertTrue(actions.did("scan slow"));
        // Still near, or near again within the minute: the pause goes on.
        hear(-70, 50_000);
        hear(-90, 50_000);
        assertEquals(AutoConnect.State.PAUSED, auto.state());
        // Then not heard near for a minute: it looks for the bike again.
        for (long end = now + 61_000; now < end; now += 500) auto.tick(now);
        assertEquals(AutoConnect.State.IDLE, auto.state());
    }

    @Test
    public void aPauseOfTheRiderDoesNotEndByItself() {
        connectedInBackground();
        auto.userDisconnected(now);
        auto.linkDown(now);
        for (long end = now + 10 * 60_000; now < end; now += 500) auto.tick(now);
        assertEquals(AutoConnect.State.PAUSED, auto.state());
    }

    @Test
    public void aLinkLostBeforeLockingWarnsThatTheBikeMayBeUnlocked() {
        connectedInBackground();
        auto.lockState(false);
        auto.linkDown(now);
        assertTrue(actions.did("alert MAY_BE_UNLOCKED"));
        assertEquals(AutoConnect.State.IDLE, auto.state());
    }

    @Test
    public void aFailedLockWarnsAndStillDisconnects() {
        connectedInBackground();
        signal(-60, 31_000);
        signal(-90, 5_500);
        auto.lockDone(false, now);
        assertTrue(actions.did("alert MAY_BE_UNLOCKED"));
        assertTrue(actions.did("disconnect"));
    }

    @Test
    public void theRiderDisconnectingPausesItUntilResumed() {
        connectedInBackground();
        auto.userDisconnected(now);
        auto.linkDown(now);
        assertEquals(AutoConnect.State.PAUSED, auto.state());
        assertFalse(actions.did("alert MAY_BE_UNLOCKED"));
        auto.resume(now);
        assertEquals(AutoConnect.State.IDLE, auto.state());
    }

    @Test
    public void aPauseForStandingNearEndsOnceTheBikeMovesOnAConnectionOfTheApp() {
        connectedInBackground();
        signal(-60, 15 * 60_000 + 1_000);
        auto.lockDone(true, now);
        auto.linkDown(now);
        assertEquals(AutoConnect.State.PAUSED, auto.state());
        auto.linkUp(now);
        assertEquals(AutoConnect.State.PAUSED, auto.state());
        auto.moved(now);
        assertEquals(AutoConnect.State.CONNECTED, auto.state());
    }

    @Test
    public void aPauseOfTheRiderDoesNotEndWhenTheBikeMoves() {
        connectedInBackground();
        auto.userDisconnected(now);
        auto.moved(now);
        assertEquals(AutoConnect.State.PAUSED, auto.state());
    }

    @Test
    public void withAutoUnlockAConnectionMadeBecauseThePhoneCameNearUnlocksALockedBike() {
        settings.autoUnlock = true;
        auto.start(now);
        hear(-60, 11_000);
        auto.lockState(true);
        auto.linkUp(now);
        assertTrue(actions.did("unlock"));
    }

    @Test
    public void aLockByHandHoldsAgainstAutoUnlockUntilUnlockedByHand() {
        settings.autoUnlock = true;
        auto.setLockHeld(true);
        auto.start(now);
        hear(-60, 11_000);
        auto.lockState(true);
        auto.linkUp(now);
        assertFalse(actions.did("unlock"));

        auto.setLockHeld(false);
        auto.linkDown(now);
        hear(-60, 11_000);
        auto.lockState(true);
        auto.linkUp(now);
        assertTrue(actions.did("unlock"));
    }

    @Test
    public void withoutAutoUnlockOrAutoLockNothingUnlocks() {
        auto.start(now);
        hear(-60, 11_000);
        auto.lockState(true);
        auto.linkUp(now);
        assertFalse(actions.did("unlock"));

        setUp();
        settings.autoLock = false;
        settings.autoUnlock = true;
        auto.start(now);
        hear(-60, 11_000);
        auto.lockState(true);
        auto.linkUp(now);
        assertFalse(actions.did("unlock"));
    }

    @Test
    public void aBikeAlreadyUnlockedIsNotUnlockedAgain() {
        settings.autoUnlock = true;
        auto.start(now);
        hear(-60, 11_000);
        auto.lockState(false);
        auto.linkUp(now);
        assertFalse(actions.did("unlock"));
    }

    @Test
    public void theAppConnectingDoesNotUnlockAtOnce() {
        settings.autoUnlock = true;
        auto.start(now);
        auto.lockState(true);
        auto.linkUp(now);
        assertEquals(AutoConnect.State.CONNECTED, auto.state());
        assertFalse(actions.did("unlock"));
    }


    @Test
    public void thePreviewCountsDownToTheConnectionAndToTheLockAndKeepsTheLastLock() {
        auto.start(now);
        hear(-60, 2_000);
        AutoConnect.Preview near = auto.preview(now);
        assertEquals(Integer.valueOf(-60), near.heardDbm);
        assertTrue(near.connectInMs > 0 && near.connectInMs <= settings.nearMs);
        hear(-60, 9_000);
        auto.lockState(false);
        auto.linkUp(now);
        signal(-60, 31_000);
        signal(-90, 1_000);
        AutoConnect.Preview leaving = auto.preview(now);
        assertEquals(Long.valueOf(settings.farMs - 1_000), leaving.leaveInMs);
        auto.lockState(true);
        auto.linkDown(now);
        assertEquals(Boolean.TRUE, auto.preview(now).lastLocked);
    }

    @Test
    public void aConnectionTheAppMadeUnlocksOnceTheRiderIsNearAndNotBefore() {
        settings.autoUnlock = true;
        auto.start(now);
        auto.lockState(true);
        auto.linkUp(now);
        signal(-85, 10_000);
        assertFalse(actions.did("unlock"));
        signal(-54, 5_000);
        assertTrue(actions.did("unlock"));
        assertEquals(AutoConnect.Event.UNLOCKED_ON_ARRIVAL, auto.history().get(0).event);
    }

    @Test
    public void aLockPressedByHandHoldsAgainstTheUnlockOfAConnectionTheAppMade() {
        settings.autoUnlock = true;
        auto.setLockHeld(true);
        auto.start(now);
        auto.lockState(true);
        auto.linkUp(now);
        signal(-54, 6_000);
        assertFalse(actions.did("unlock"));
        assertEquals(AutoConnect.Event.UNLOCK_HELD, auto.history().get(0).event);
    }
}
