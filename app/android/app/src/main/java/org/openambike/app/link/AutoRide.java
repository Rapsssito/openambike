package org.openambike.app.link;

import java.util.ArrayDeque;

/**
 * Auto-ride's decisions, with no Android code, so that they can be tested on their own (app/DEVELOPMENT.md,
 * "Auto-connect"): a ride starts once the bike has reported movement for long enough, whoever holds the connection,
 * and the rides it started stop once neither the bike nor the GPS has shown movement for long, or as soon as
 * auto-connect lets the bike go. A ride started by hand is stopped by hand; after the rider stops a ride by hand, none
 * starts until the bike has stood still for long or was let go. It is told what happens, with the time, and is called on
 * one thread only.
 */
final class AutoRide {
    interface Actions {
        void startRide();

        /** Stops the ride it started; {@code lastMoved} is when it last moved, where the ride ends. */
        void stopRide(long lastMoved);
    }

    static final class Settings {
        /** How long the bike reports movement, within {@link #windowMs}, before a ride starts. */
        long movingMs = 20_000;
        long windowMs = 30_000;
        /** A gap between two reports of movement longer than this is a moment standing, not part of the movement. */
        long gapMs = 3_000;
        /** As long as auto-connect waits before it lets a parked bike go. */
        long parkedMs = 15 * 60_000;
    }

    private final Actions actions;
    private final Settings settings;
    /** When the bike reported movement, within the window, while no ride is recorded. */
    private final ArrayDeque<Long> moves = new ArrayDeque<>();
    /** Whether a ride is recorded, and whether auto-ride started it. */
    private boolean riding;
    private boolean started;
    /** False after the rider stopped a ride by hand, until the bike stood still for long or was let go. */
    private boolean armed = true;
    private long lastMoved = Long.MIN_VALUE / 2;

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

    /** The bike reported movement. */
    void bikeMoved(long now) {
        lastMoved = now;
        if (riding || !armed) return;
        moves.add(now);
        while (!moves.isEmpty() && moves.peek() < now - settings.windowMs) moves.poll();
        long moving = 0;
        Long previous = null;
        for (long at : moves) {
            if (previous != null && at - previous <= settings.gapMs) moving += at - previous;
            previous = at;
        }
        if (moving >= settings.movingMs) {
            moves.clear();
            riding = true;
            started = true;
            actions.startRide();
        }
    }

    /** The GPS says the phone moves: a ride going on does not stop for standing still. */
    void gpsMoved(long now) {
        if (riding) lastMoved = now;
    }

    /** Auto-connect let the bike go: the rider left it. */
    void letGo() {
        armed = true;
        moves.clear();
        if (riding && started) stop();
    }

    /** The rider started a ride by hand. */
    void startedByHand(long now) {
        riding = true;
        started = false;
        lastMoved = Math.max(lastMoved, now);
        moves.clear();
    }

    /** The rider stopped a ride by hand: none starts until the bike stood still for long or was let go. */
    void stoppedByHand() {
        riding = false;
        started = false;
        armed = false;
        moves.clear();
    }

    /** Called about twice a second while it runs. */
    void tick(long now) {
        boolean parked = now - lastMoved >= settings.parkedMs;
        if (riding && started && parked) stop();
        else if (!riding && !armed && parked) armed = true;
    }

    private void stop() {
        riding = false;
        started = false;
        actions.stopRide(lastMoved);
    }
}
