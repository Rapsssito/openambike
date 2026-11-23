package org.openambike.app.link;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * Auto-connect's decisions, with no Android code, so that they can be tested on their own: when to look for the bike,
 * when to connect, when to lock, and when to let go (docs/roadmap.md, "Auto-connect, auto-lock and rides"). It is told
 * what happens, with the time, and answers through {@link Actions}; it is called on one thread only.
 *
 * <p>Whether the app is on screen or not, it connects once the median of the bike's signal has been above the near
 * threshold for a while, and once connected, whoever connected, lets go when the median of the connection's signal falls
 * below the far threshold after it was above it, the rider having been near, or when the bike has not moved for long. The
 * median, so that one deep dip, as the rider's body blocks the phone, or one strong reading, does not decide. It locks
 * first if auto-lock is on, never while the bike moved in the last moments. With auto-unlock on, a connection it made because
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

        /** The rider left the bike: a lock pressed by hand no longer holds against auto-unlock. */
        void lockHeldEnded();

        /** The connection dropped and did not come back within the away time: the rider is taken to have left. */
        void linkGone();
    }

    enum Status {
        LOOKING,
        CONNECTED,
        PAUSED,
    }

    enum Alert {
        /** The connection dropped while the bike was not known to be locked. */
        MAY_BE_UNLOCKED,
        /** The bike stood still near the phone for long: auto-connect paused until the rider leaves, rides or connects. */
        PAUSED_PARKED,
    }

    /** The thresholds; the defaults are the ones docs/roadmap.md gives, from docs/protocol.md, "Advertising". */
    static final class Settings {
        int nearDbm = -72;
        long nearMs = 5_000;
        int farDbm = -76;
        long farMs = 3_000;
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
        IDLE,
        NEAR,
        CONNECTING,
        CONNECTED,
        LEAVING,
        PAUSED,
    }

    /** What it did or decided, for the history the app shows; the texts are the app's. */
    enum Event {
        /** The median of the bike's signal was above the near threshold: it connects; value, the median in dBm. */
        CONNECTING,
        /** The app connected to the bike: auto-connect holds that connection as its own. */
        APP_CONNECTED,
        /** Auto-unlock unlocked the bike, which came near. */
        UNLOCKED_ON_ARRIVAL,
        /** Auto-unlock did not unlock it: the rider's own lock holds. */
        UNLOCK_HELD,
        /** The signal says the rider left, but the bike moved lately: it waits; value, seconds since it moved. */
        WAITING_MOVED,
        /** The rider left: it locks, then lets go; value, the signal's median in dBm. */
        LOCKING_AWAY,
        /** The rider left: it lets go, auto-lock being off; value, as above. */
        LEAVING_AWAY,
        /** The rider left: it lets go, the bike being locked already; value, as above. */
        LEFT_LOCKED_AWAY,
        /** The bike stood still near for long: it locks, then lets go and pauses; value, in minutes. */
        LOCKING_PARKED,
        /** As above, auto-lock being off. */
        LEAVING_PARKED,
        /** As above, the bike being locked already. */
        LEFT_LOCKED_PARKED,
        LOCKED,
        LOCK_FAILED,
        /** The connection dropped by itself: it waits for it to come back; value, the away time in seconds. */
        LINK_LOST,
        /** The connection came back within the away time: it carries on as before the drop. */
        RECONNECTED,
        /** The connection did not come back within the away time: the rider is taken to have left. */
        LINK_GONE,
        /** As above, with auto-lock on and the bike not known to be locked. */
        LINK_LOST_UNLOCKED,
        PAUSED_BY_RIDER,
        PAUSED_PARKED,
        /** After a pause for standing near, the rider left: it looks for the bike again. */
        RIDER_LEFT,
    }

    /** One event, at a time of the clock it is given. */
    static final class Entry {
        final long at;
        final Event event;
        final int value;

        Entry(long at, Event event, int value) {
            this.at = at;
            this.event = event;
            this.value = value;
        }
    }

    /** Where its timers stand, for the app to show. */
    static final class Preview {
        State state;
        /** Whether the link is connected and the bike accepted the key, whoever connected it. */
        boolean connected;
        Boolean locked;
        boolean lockHeld;
        /** Near the bike, before connecting: the advertising's median, and for how long it has been heard near. */
        Double nearDbm;
        long nearForMs;
        /** Connected: the connection signal's median over the far time, and whether readings cover all of it. */
        Double signalDbm;
        boolean signalSettled;
        /** Connected: the connection signal's latest reading; null before the first. */
        Integer signalNowDbm;
        /** Since the bike last reported movement; null if it has not since the service started. */
        Long movedAgoMs;
        /** How long the ride guard still holds a lock back. */
        long guardLeftMs;
        /** How long until a bike standing still near is let go. */
        long parkedLeftMs;
        /** The bike's advertising as last heard, and how long ago; null before it was heard. */
        Integer heardDbm;
        Long heardAgoMs;
        /** The bike's lock as last known, also after the connection ended; null if never known. */
        Boolean lastLocked;
        /** Near the bike, its signal strong enough: how long until it connects; null otherwise. */
        Long connectInMs;
        /** Connected, the rider leaving: how long until it locks or lets go; null otherwise. */
        Long leaveInMs;
        /** The connection dropped: how long it still waits for it to come back; null otherwise. */
        Long dropLeftMs;
    }

    /** How many events the history keeps. */
    static final int HISTORY = 30;

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
    /** Whether the link is connected and the bike accepted the key, whoever connected it. */
    private boolean linkReady;
    /** The bike's lock as last read or notified; null when not known on this connection. */
    private Boolean locked;
    /** Whether the rider locked the bike in the app, and has neither unlocked it there nor left it since. */
    private boolean lockHeld;
    /** When the bike last reported movement; long before anything, until it does. */
    private long lastMoved = Long.MIN_VALUE / 2;
    /** When the current state began: for CONNECTED, when it took the connection, from which the parked time counts. */
    private long since;
    private long scanModeSince = Long.MIN_VALUE / 2;
    private boolean leavingParked;
    /**
     * When the connection dropped by itself, while it waits for it to come back: within the away time, a connection
     * carries on as before the drop; null otherwise. Whether the bike may then have been unlocked, and when the
     * connection had begun, from which the parked time goes on counting.
     */
    private Long droppedAt;
    private boolean droppedUnlocked;
    private long droppedSince;
    /** Whether the pause came from the bike standing near: it then ends by itself once the rider has left. */
    private boolean pausedParked;
    /** When the bike was last heard above the far threshold, during a pause for standing near. */
    private long lastNear;
    private final ArrayDeque<Reading> readings = new ArrayDeque<>();
    /** Whether the wait for the ride guard was put in the history, until the signal is strong again. */
    private boolean waitLogged;
    /**
     * Whether the signal of this connection was above the far threshold: only then does a weak signal mean that the rider
     * left, so that a connection the app made from afar is not let go at once.
     */
    private boolean nearSeen;
    /**
     * Whether a connection the app made, with auto-unlock on, still waits for the rider to be near to unlock the bike
     * once: a connection made from afar, or with the app open next to the bike, unlocks as one auto-connect made.
     */
    private boolean unlockPending;
    private final ArrayDeque<Entry> history = new ArrayDeque<>();
    /** The bike's advertising as last heard, for the preview. */
    private Integer heardDbm;
    private long heardAt;
    /** The bike's lock as last known, kept after the connection ends, for the preview. */
    private Boolean lastLocked;
    /** Since when the connection's signal reads below the far threshold, for the preview; null while above. */
    private Long weakSince;

    AutoConnect(Actions actions, Settings settings) {
        this.actions = actions;
        this.settings = settings;
    }

    State state() {
        return state;
    }

    /** The events kept, newest first. */
    List<Entry> history() {
        List<Entry> list = new ArrayList<>(history);
        java.util.Collections.reverse(list);
        return list;
    }

    private void log(Event event, long now, int value) {
        history.add(new Entry(now, event, value));
        while (history.size() > HISTORY) history.poll();
    }

    /** Where its timers stand as of {@code now}. */
    Preview preview(long now) {
        Preview preview = new Preview();
        preview.state = state;
        preview.connected = linkReady;
        preview.locked = locked;
        preview.lockHeld = lockHeld;
        if (state == State.NEAR) {
            preview.nearDbm = readings.isEmpty() ? null : median();
            preview.nearForMs = now - since;
        }
        if (state == State.CONNECTED) {
            long from = since;
            preview.signalDbm = readings.isEmpty() ? null : median();
            preview.signalNowDbm = readings.isEmpty() ? null : readings.peekLast().rssi;
            preview.signalSettled = now - from >= settings.farMs;
            preview.parkedLeftMs = Math.max(0, settings.parkedMs - (now - Math.max(lastMoved, from)));
        }
        if (lastMoved > Long.MIN_VALUE / 2) preview.movedAgoMs = now - lastMoved;
        preview.guardLeftMs = Math.max(0, settings.rideGuardMs - (now - lastMoved));
        if (heardDbm != null) {
            preview.heardDbm = heardDbm;
            preview.heardAgoMs = now - heardAt;
        }
        preview.lastLocked = locked != null ? locked : lastLocked;
        if (state == State.NEAR && !readings.isEmpty() && median() > settings.nearDbm) {
            preview.connectInMs = Math.max(0, settings.nearMs - (now - since));
        }
        if (state == State.LEAVING) {
            preview.leaveInMs = 0L;
        } else if (state == State.CONNECTED && nearSeen && weakSince != null) {
            preview.leaveInMs = Math.max(Math.max(0, settings.farMs - (now - weakSince)), preview.guardLeftMs);
        }
        if (droppedAt != null) preview.dropLeftMs = Math.max(0, settings.awayMs - (now - droppedAt));
        return preview;
    }

    void start(long now) {
        if (state != State.OFF && state != State.PAUSED) return;
        settle(now);
    }

    /** Stops looking and deciding; the connection, if any, is left to the app. */
    void stop() {
        if (state == State.IDLE || state == State.NEAR) actions.stopScan();
        state = State.OFF;
        droppedAt = null;
    }

    /** After a pause: the app asked to connect, or was opened. */
    void resume(long now) {
        if (state != State.PAUSED) return;
        if (pausedParked) actions.stopScan();
        pausedParked = false;
        settle(now);
    }

    /** The rider disconnected in the app: auto-connect waits until they connect again. */
    void userDisconnected(long now) {
        if (state == State.OFF) return;
        droppedAt = null;
        if (state == State.IDLE || state == State.NEAR || pausedParked) actions.stopScan();
        state = State.PAUSED;
        pausedParked = false;
        log(Event.PAUSED_BY_RIDER, now, 0);
        actions.status(Status.PAUSED);
    }

    /** Where it stands now, from whether the link is ready. */
    private void settle(long now) {
        State before = state;
        if (linkReady) {
            if (before != State.CONNECTED) {
                if (before == State.IDLE || before == State.NEAR) actions.stopScan();
                state = State.CONNECTED;
                since = now;
                readings.clear();
                weakSince = null;
            }
            actions.status(Status.CONNECTED);
        } else {
            if (before != State.IDLE) look(droppedAt != null, now);
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
        heardDbm = rssi;
        heardAt = now;
        if (droppedAt != null && (state == State.IDLE || state == State.NEAR) && rssi >= settings.farDbm) {
            // The connection dropped a moment ago: it connects again at once, with the rider still in reach.
            actions.stopScan();
            state = State.CONNECTING;
            log(Event.CONNECTING, now, rssi);
            actions.connect();
            return;
        }
        if (state == State.PAUSED && pausedParked && rssi >= settings.farDbm) lastNear = now;
        if (state == State.IDLE && rssi > settings.nearDbm) look(true, now);
        if (state == State.NEAR) readings.add(new Reading(now, rssi));
    }

    /** The link is connected and the bike accepted the key. */
    void linkUp(long now) {
        linkReady = true;
        if (droppedAt != null && (state == State.IDLE || state == State.NEAR || state == State.CONNECTING)) {
            // Back within the away time: as before the drop, neither an arrival nor a new connection of the app.
            droppedAt = null;
            log(Event.RECONNECTED, now, 0);
            settle(now);
            since = droppedSince;
            return;
        }
        if (state == State.IDLE || state == State.NEAR) {
            // The app connected: held as auto-connect's own, which lets go once the rider has been near and left.
            nearSeen = false;
            unlockPending = settings.autoLock && settings.autoUnlock;
            log(Event.APP_CONNECTED, now, 0);
            settle(now);
        }
        if (state == State.CONNECTING) {
            nearSeen = true;
            unlockPending = false;
            settle(now);
            if (settings.autoLock && settings.autoUnlock && !Boolean.FALSE.equals(locked)) {
                if (lockHeld) {
                    log(Event.UNLOCK_HELD, now, 0);
                } else {
                    log(Event.UNLOCKED_ON_ARRIVAL, now, 0);
                    actions.unlock();
                }
            }
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
                // It may be a moment out of reach, as with the phone in a pocket behind the rider's body: it waits
                // for the away time before it warns or takes the rider to have left.
                droppedAt = now;
                droppedUnlocked = settings.autoLock && !wasLocked;
                droppedSince = since;
                log(Event.LINK_LOST, now, (int) (settings.awayMs / 1000));
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
                    log(Event.PAUSED_PARKED, now, 0);
                    actions.scan(false);
                    actions.status(Status.PAUSED);
                    actions.alert(Alert.PAUSED_PARKED);
                } else {
                    settle(now);
                }
                break;
            default:
                break;
        }
    }

    /** The connection's signal strength. */
    void rssi(int rssi, long now) {
        if (state == State.CONNECTED) readings.add(new Reading(now, rssi));
        if (rssi >= settings.farDbm) weakSince = null;
        else if (weakSince == null) weakSince = now;
    }

    /** The bike reported speed or power. */
    void moved(long now) {
        lastMoved = now;
        // A pause for standing near ends once the bike is ridden again, as on a connection the app made.
        if (state == State.PAUSED && pausedParked) resume(now);
    }

    /** The rider locked or unlocked the bike in the app: a lock by hand holds against auto-unlock until the rider left. */
    void setLockHeld(boolean held) {
        lockHeld = held;
    }

    /** The bike's lock, as read or notified. */
    void lockState(boolean locked) {
        this.locked = locked;
        lastLocked = locked;
    }

    void lockDone(boolean ok, long now) {
        if (state != State.LEAVING) return;
        log(ok ? Event.LOCKED : Event.LOCK_FAILED, now, 0);
        if (!ok) actions.alert(Alert.MAY_BE_UNLOCKED);
        actions.disconnect();
    }

    /** Called about twice a second while it runs. */
    void tick(long now) {
        if (droppedAt != null && now - droppedAt >= settings.awayMs) {
            droppedAt = null;
            log(droppedUnlocked ? Event.LINK_LOST_UNLOCKED : Event.LINK_GONE, now, 0);
            if (droppedUnlocked) actions.alert(Alert.MAY_BE_UNLOCKED);
            actions.linkGone();
            if (state == State.NEAR) look(false, now);
        }
        if (state == State.PAUSED && pausedParked && now - lastNear >= settings.awayMs) {
            // The rider left the bike: auto-connect looks for it again, slowly, as before the pause.
            pausedParked = false;
            log(Event.RIDER_LEFT, now, 0);
            endLockHeld();
            look(false, now);
            actions.status(Status.LOOKING);
            return;
        }
        if (state == State.NEAR) {
            dropBefore(now - settings.nearMs);
            if (now - since >= settings.nearMs && median() > settings.nearDbm) {
                actions.stopScan();
                state = State.CONNECTING;
                log(Event.CONNECTING, now, (int) Math.round(median()));
                actions.connect();
            } else if (droppedAt == null && now - since >= settings.nearMs && now - scanModeSince >= settings.scanModeMs) {
                look(false, now);
            }
        } else if (state == State.CONNECTED) {
            actions.readRssi();
            dropBefore(now - settings.farMs);
            // The ride guard counts only movement the bike reported, so that a connection just made locks as soon as
            // the signal says the rider left; the parked time counts from the connection at the earliest.
            boolean moving = now - lastMoved < settings.rideGuardMs;
            boolean settled = now - since >= settings.farMs && !readings.isEmpty();
            if (settled && median() >= settings.farDbm) nearSeen = true;
            if (unlockPending && settled && locked != null && median() > settings.nearDbm) {
                unlockPending = false;
                if (locked) {
                    if (lockHeld) {
                        log(Event.UNLOCK_HELD, now, 0);
                    } else {
                        log(Event.UNLOCKED_ON_ARRIVAL, now, 0);
                        actions.unlock();
                    }
                }
            }
            boolean weak = settled && nearSeen && median() < settings.farDbm;
            boolean parked = now - Math.max(lastMoved, since) >= settings.parkedMs;
            if (parked) {
                leave(true, now, (int) (settings.parkedMs / 60_000));
            } else if (weak && !moving) {
                leave(false, now, (int) Math.round(median()));
            } else if (weak && !waitLogged) {
                waitLogged = true;
                log(Event.WAITING_MOVED, now, (int) ((now - lastMoved) / 1000));
            }
            if (!weak) waitLogged = false;
        }
    }

    /** @param value what the history says with it: the signal's median in dBm, or the minutes parked */
    private void leave(boolean parked, long now, int value) {
        state = State.LEAVING;
        leavingParked = parked;
        waitLogged = false;
        boolean lock = settings.autoLock && !Boolean.TRUE.equals(locked);
        boolean alreadyLocked = settings.autoLock && !lock;
        if (parked) {
            log(lock ? Event.LOCKING_PARKED : alreadyLocked ? Event.LEFT_LOCKED_PARKED : Event.LEAVING_PARKED, now, value);
        } else {
            log(lock ? Event.LOCKING_AWAY : alreadyLocked ? Event.LEFT_LOCKED_AWAY : Event.LEAVING_AWAY, now, value);
        }
        // Leaving because the signal says the rider walked away, not for standing near: the next arrival unlocks.
        if (!parked) endLockHeld();
        if (lock) actions.lock();
        else actions.disconnect();
    }

    private void endLockHeld() {
        if (!lockHeld) return;
        lockHeld = false;
        actions.lockHeldEnded();
    }

    private void dropBefore(long time) {
        while (!readings.isEmpty() && readings.peek().at < time) readings.poll();
    }

    /** The median of the readings kept, the mean of the middle two for an even number; or the lowest possible value. */
    private double median() {
        if (readings.isEmpty()) return Integer.MIN_VALUE;
        int[] values = new int[readings.size()];
        int i = 0;
        for (Reading reading : readings) values[i++] = reading.rssi;
        java.util.Arrays.sort(values);
        int middle = values.length / 2;
        return values.length % 2 == 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2.0;
    }

}
