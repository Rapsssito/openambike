package org.openambike.app.link;

import java.util.ArrayDeque;

/**
 * Auto-connect's decisions, with no Android code, so that they can be tested on their own: when to look for the bike,
 * when to connect, when to lock, and when to let go (docs/roadmap.md, "Auto-connect, auto-lock and rides"). It is told
 * what happens, with the time, and answers through {@link Actions}; it is called on one thread only.
 *
 * <p>With the app on screen, it stands aside and the app connects as it always does. In the background, it connects
 * once the bike's signal has averaged above the near threshold for a while, and once connected, lets go when the
 * connection's signal averages below the far threshold, or when the bike has not moved for long: then it locks first
 * if auto-lock is on, never while the bike moved in the last moments. With auto-unlock on, a connection it made because
 * the phone came near unlocks the bike; nothing else does (docs/safety.md, "What the project never does"), and not
 * while the rider's own lock holds: once they lock the bike in the app, until they unlock it there.
 */
final class AutoConnect {
    /** What it asks for. Each request that takes time answers through the matching method of AutoConnect. */
    interface Actions {
        /** Looks for the bike only; fast near it, slow otherwise. Replaces any scan already running. */
        void scan(boolean fast);

        void stopScan();

        /** Connects, authenticates and listens to the bike; answers with {@link #linkUp} or {@link #linkFailed}. */
        void connect();

        /** Reads the connection's signal strength; answers with {@link #rssi}. */
        void readRssi();

        /** Locks the bike; answers with {@link #lockDone}. */
        void lock();

        /** Unlocks the bike; nothing waits for the answer. */
        void unlock();

        /** Ends the connection; answers with {@link #linkDown}. */
        void disconnect();

        /** What the permanent notification says. */
        void status(Status status);

        /** A notification that asks for attention. */
        void alert(Alert alert);
    }

    enum Status {
        LOOKING,
        CONNECTED,
        PAUSED,
    }

    enum Alert {
        /** The connection dropped while the bike was not known to be locked. */
        MAY_BE_UNLOCKED,
        /** The bike stood still near the phone for long: auto-connect paused until the app is opened. */
        PAUSED_PARKED,
    }

    /** The thresholds; the defaults are the ones docs/roadmap.md gives, from docs/protocol.md, "Advertising". */
    static final class Settings {
        int nearDbm = -72;
        long nearMs = 10_000;
        int farDbm = -85;
        long farMs = 5_000;
        long parkedMs = 15 * 60_000;
        long rideGuardMs = 30_000;
        /** A pause for standing near ends once the bike has not been heard above the far threshold for this long. */
        long awayMs = 60_000;
        /** Android stops the results of an app that starts more than 5 scans in 30 seconds: scans change no faster. */
        long scanModeMs = 15_000;
        boolean autoLock;
        /** Only with auto-lock: a bike unlocked on arrival is locked again on leaving. */
        boolean autoUnlock;
    }

    enum State {
        OFF,
        /** The app is on screen and connects by itself. */
        APP,
        IDLE,
        NEAR,
        CONNECTING,
        CONNECTED,
        LEAVING,
        PAUSED,
    }

    private static final class Reading {
        final long at;
        final int rssi;

        Reading(long at, int rssi) {
            this.at = at;
            this.rssi = rssi;
        }
    }

    private final Actions actions;
    private final Settings settings;
    private State state = State.OFF;
    private boolean foreground;
    /** Whether the link is connected and the bike accepted the key, whoever connected it. */
    private boolean linkReady;
    /** The bike's lock as last read or notified; null when not known on this connection. */
    private Boolean locked;
    /** Whether the rider locked the bike in the app, and has not unlocked it there since. */
    private boolean lockHeld;
    private long lastMoved;
    private long since;
    private long scanModeSince = Long.MIN_VALUE / 2;
    private boolean leavingParked;
    /** Whether the pause came from the bike standing near: it then ends by itself once the rider has left. */
    private boolean pausedParked;
    /** When the bike was last heard above the far threshold, during a pause for standing near. */
    private long lastNear;
    private final ArrayDeque<Reading> readings = new ArrayDeque<>();

    AutoConnect(Actions actions, Settings settings) {
        this.actions = actions;
        this.settings = settings;
    }

    State state() {
        return state;
    }

    void start(long now) {
        if (state != State.OFF && state != State.PAUSED) return;
        settle(now);
    }

    /** Stops looking and deciding; the connection, if any, is left to the app. */
    void stop() {
        if (state == State.IDLE || state == State.NEAR) actions.stopScan();
        state = State.OFF;
    }

    /** After a pause: the app asked to connect, or was opened. */
    void resume(long now) {
        if (state != State.PAUSED) return;
        if (pausedParked) actions.stopScan();
        pausedParked = false;
        settle(now);
    }

    /** The rider disconnected in the app: auto-connect waits until they connect again. */
    void userDisconnected() {
        if (state == State.OFF) return;
        if (state == State.IDLE || state == State.NEAR || pausedParked) actions.stopScan();
        state = State.PAUSED;
        pausedParked = false;
        actions.status(Status.PAUSED);
    }

    void setForeground(boolean foreground, long now) {
        this.foreground = foreground;
        switch (state) {
            case APP:
            case IDLE:
            case NEAR:
            case CONNECTED:
                settle(now);
                break;
            default:
                // A connection or a lock under way finishes first; a pause or off stays.
                break;
        }
    }

    /** Where it stands now, from whether the app is on screen and whether the link is ready. */
    private void settle(long now) {
        State before = state;
        if (foreground) {
            if (before == State.IDLE || before == State.NEAR) actions.stopScan();
            state = State.APP;
            actions.status(linkReady ? Status.CONNECTED : Status.LOOKING);
        } else if (linkReady) {
            if (before != State.CONNECTED) {
                state = State.CONNECTED;
                since = now;
                // A grace period: the ride guard counts from when it took the connection over.
                lastMoved = Math.max(lastMoved, now);
                readings.clear();
            }
            actions.status(Status.CONNECTED);
        } else {
            if (before != State.IDLE) look(false, now);
            actions.status(Status.LOOKING);
        }
    }

    private void look(boolean fast, long now) {
        state = fast ? State.NEAR : State.IDLE;
        readings.clear();
        since = now;
        scanModeSince = now;
        actions.scan(fast);
    }

    // What the link reports.

    /** An advertisement of the bike. */
    void heard(int rssi, long now) {
        if (state == State.PAUSED && pausedParked && rssi >= settings.farDbm) lastNear = now;
        if (state == State.IDLE && rssi > settings.nearDbm) look(true, now);
        if (state == State.NEAR) readings.add(new Reading(now, rssi));
    }

    /** The link is connected and the bike accepted the key. */
    void linkUp(long now) {
        linkReady = true;
        if (state == State.APP) actions.status(Status.CONNECTED);
        if (state == State.CONNECTING) {
            state = State.APP;
            lastMoved = now;
            settle(now);
            if (settings.autoLock && settings.autoUnlock && !lockHeld && !Boolean.FALSE.equals(locked)) actions.unlock();
        }
    }

    void linkFailed(long now) {
        if (state == State.CONNECTING) settle(now);
    }

    void linkDown(long now) {
        boolean wasLocked = Boolean.TRUE.equals(locked);
        linkReady = false;
        locked = null;
        switch (state) {
            case CONNECTED:
                if (settings.autoLock && !wasLocked) actions.alert(Alert.MAY_BE_UNLOCKED);
                settle(now);
                break;
            case CONNECTING:
                linkFailed(now);
                break;
            case LEAVING:
                if (leavingParked) {
                    // Paused, it keeps a slow scan only to notice when the rider has left.
                    state = State.PAUSED;
                    pausedParked = true;
                    lastNear = now;
                    actions.scan(false);
                    actions.status(Status.PAUSED);
                    actions.alert(Alert.PAUSED_PARKED);
                } else {
                    settle(now);
                }
                break;
            case APP:
                actions.status(Status.LOOKING);
                break;
            default:
                break;
        }
    }

    /** The connection's signal strength. */
    void rssi(int rssi, long now) {
        if (state == State.CONNECTED) readings.add(new Reading(now, rssi));
    }

    /** The bike reported speed or power. */
    void moved(long now) {
        lastMoved = now;
    }

    /** The rider locked or unlocked the bike in the app: a lock by hand holds against auto-unlock. */
    void setLockHeld(boolean held) {
        lockHeld = held;
    }

    /** The bike's lock, as read or notified. */
    void lockState(boolean locked) {
        this.locked = locked;
    }

    void lockDone(boolean ok) {
        if (state != State.LEAVING) return;
        if (!ok) actions.alert(Alert.MAY_BE_UNLOCKED);
        actions.disconnect();
    }

    /** Called about twice a second while it runs. */
    void tick(long now) {
        if (state == State.PAUSED && pausedParked && now - lastNear >= settings.awayMs) {
            // The rider left the bike: auto-connect looks for it again, slowly, as before the pause.
            pausedParked = false;
            look(false, now);
            actions.status(Status.LOOKING);
            return;
        }
        if (state == State.NEAR) {
            dropBefore(now - settings.nearMs);
            if (now - since >= settings.nearMs && average() > settings.nearDbm) {
                actions.stopScan();
                state = State.CONNECTING;
                actions.connect();
            } else if (now - since >= settings.nearMs && now - scanModeSince >= settings.scanModeMs) {
                look(false, now);
            }
        } else if (state == State.CONNECTED) {
            actions.readRssi();
            dropBefore(now - settings.farMs);
            boolean moving = now - lastMoved < settings.rideGuardMs;
            boolean weak = now - since >= settings.farMs && !readings.isEmpty() && average() < settings.farDbm;
            boolean parked = now - lastMoved >= settings.parkedMs;
            if (parked) leave(true);
            else if (weak && !moving) leave(false);
        }
    }

    private void leave(boolean parked) {
        state = State.LEAVING;
        leavingParked = parked;
        if (settings.autoLock && !Boolean.TRUE.equals(locked)) actions.lock();
        else actions.disconnect();
    }

    private void dropBefore(long time) {
        while (!readings.isEmpty() && readings.peek().at < time) readings.poll();
    }

    /** The average of the readings kept, or the lowest possible value if there are none. */
    private double average() {
        if (readings.isEmpty()) return Integer.MIN_VALUE;
        double sum = 0;
        for (Reading reading : readings) sum += reading.rssi;
        return sum / readings.size();
    }
}
