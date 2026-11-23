package org.openambike.app.link;

/**
 * Auto-ride's decisions, with no Android code, so that they can be tested on their own (app/DEVELOPMENT.md,
 * "Auto-connect"): a ride starts once the bike, pedalled, has reported movement for long enough, whoever holds the
 * connection, and the rides it started stop when auto-connect takes the rider to have left: as it lets the bike go, for
 * the rider walking away or the bike standing still near, or once a dropped connection did not come back. A ride
 * started by hand is stopped by hand; after the rider stops a ride by hand, none starts until the bike has stood still
 * for long or was let go. It is told what happens, with the time, and is called on one thread only.
 */
final class AutoRide {
    interface Actions {
        void startRide();

        /** Stops the ride it started; {@code lastMoved} is when it last moved, where the ride ends. */
        void stopRide(long lastMoved);
    }

    static final class Settings {
        /** How long the bike reports movement, from a report that it is pedalled, before a ride starts. */
        long movingMs = 5_000;
        /** A gap between two reports of movement longer than this is a moment standing: the movement counts again. */
        long gapMs = 3_000;
        /** After a stop by hand, how long the bike stands still before a ride may start again: the parked time. */
        long parkedMs = 15 * 60_000;
    }

    private final Actions actions;
    private final Settings settings;
    /** No ride recorded: when the movement counted began, with the bike pedalled, and when it was last reported. */
    private Long movingSince;
    private long lastMove;
    /** Whether a ride is recorded, and whether auto-ride started it. */
    private boolean riding;
    private boolean started;
    /** False after the rider stopped a ride by hand, until the bike stood still for long or was let go. */
    private boolean armed = true;
    private long lastMoved = Long.MIN_VALUE / 2;

    /** Where auto-ride stands, for the app to show. */
    static final class Preview {
        boolean riding;
        /** Not riding, the bike moving: how long until a ride starts; null otherwise. */
        Long startInMs;
        /** Riding a ride it started, the bike standing: how long until auto-connect lets it go; null otherwise. */
        Long stopInMs;
    }

    AutoRide(Actions actions, Settings settings) {
        this.actions = actions;
        this.settings = settings;
    }

    /** A ride already recorded when auto-ride starts, after Android restarted the service, and who started it. */
    void rideGoingOn(boolean startedByAutoRide, long now) {
        riding = true;
        started = startedByAutoRide;
        lastMoved = Math.max(lastMoved, now);
    }

    /**
     * The bike reported movement; {@code pedalled}, with the rider's power, which wheeling the bike does not give. The
     * movement counts from a report that it is pedalled, so that wheeling the bike out starts no ride.
     */
    void bikeMoved(long now, boolean pedalled) {
        lastMoved = now;
        if (riding || !armed) return;
        if (movingSince != null && now - lastMove > settings.gapMs) movingSince = null;
        if (movingSince == null && pedalled) movingSince = now;
        lastMove = now;
        if (movingSince != null && now - movingSince >= settings.movingMs) {
            movingSince = null;
            riding = true;
            started = true;
            actions.startRide();
        }
    }

    /** Auto-connect took the rider to have left: it let the bike go, or a dropped connection did not come back. */
    void letGo() {
        armed = true;
        movingSince = null;
        if (riding && started) stop();
    }

    /** The rider started a ride by hand. */
    void startedByHand(long now) {
        riding = true;
        started = false;
        lastMoved = Math.max(lastMoved, now);
        movingSince = null;
    }

    /** The rider stopped a ride by hand: none starts until the bike stood still for long or was let go. */
    void stoppedByHand() {
        riding = false;
        started = false;
        armed = false;
        movingSince = null;
    }

    /** @param letGoInMs how long until auto-connect lets the bike go without the rider walking away; null if not counting. */
    Preview preview(long now, Long letGoInMs) {
        Preview preview = new Preview();
        preview.riding = riding;
        if (riding && started && letGoInMs != null && now - lastMoved >= settings.gapMs) preview.stopInMs = letGoInMs;
        if (!riding && armed && movingSince != null && now - lastMove <= settings.gapMs) {
            preview.startInMs = Math.max(0, settings.movingMs - (lastMove - movingSince));
        }
        return preview;
    }

    /** Called about twice a second while it runs. */
    void tick(long now) {
        if (!riding && !armed && now - lastMoved >= settings.parkedMs) armed = true;
    }

    private void stop() {
        riding = false;
        started = false;
        actions.stopRide(lastMoved);
    }
}
