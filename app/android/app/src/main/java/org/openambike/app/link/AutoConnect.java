package org.openambike.app.link;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * Auto-connect's decisions, with no Android code, so that they can be tested on their own: when to look for the bike,
 * when to connect, when to lock, and when to let go (docs/roadmap.md, "Auto-connect, auto-lock and rides"). It is told
 * what happens, with the time, and answers through {@link Actions}; it is called on one thread only.
 *
 * <p>With the app on screen, it stands aside and the app connects as it always does. In the background, it connects
 * once the median of the bike's signal has been above the near threshold for a while, and once connected, lets go when
 * the median of the connection's signal falls below the far threshold, or when the bike has not moved for long. The
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

    /** What it did or decided, for the history the app shows; the texts are the app's. */
    enum Event {
        /** The median of the bike's signal was above the near threshold: it connects; value, the median in dBm. */
        CONNECTING,
        /** The app left the screen: it took the app's connection over. */
        TOOK_OVER,
        /** Auto-unlock unlocked the bike, which came near. */
        UNLOCKED_ON_ARRIVAL,
        /** Auto-unlock did not unlock it: the rider's own lock holds. */
        UNLOCK_HELD,
        /** The signal says the rider left, but the bike moved lately: it waits; value, seconds since it moved. */
        WAITING_MOVED,
        /** The rider left: it locks, then lets go; value, the signal's median in dBm. */
        LOCKING_AWAY,
        /** The rider left: it lets go, the bike being locked already or auto-lock off; value, as above. */
        LEAVING_AWAY,
        /** The bike stood still near for long: it locks, then lets go and pauses; value, in minutes. */
        LOCKING_PARKED,
        /** As above, the bike being locked already or auto-lock off. */
        LEAVING_PARKED,
        LOCKED,
        LOCK_FAILED,
        /** The connection dropped by itself. */
        LINK_LOST,
        /** The connection dropped with auto-lock on and the bike not known to be locked. */
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

    /**
     * Where its timers stand, for the app to show: also while the app is on screen and holds the connection, when it
     * only reads the signal and decides nothing, so that the rider sees what it would do.
     */
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
    private boolean foreground;
    /** Whether the link is connected and the bike accepted the key, whoever connected it. */
    private boolean linkReady;
    /** The bike's lock as last read or notified; null when not known on this connection. */
    private Boolean locked;
    /** Whether the rider locked the bike in the app, and has not unlocked it there since. */
    private boolean lockHeld;
    /** When the bike last reported movement; long before anything, until it does. */
    private long lastMoved = Long.MIN_VALUE / 2;
    /** When the current state began: for CONNECTED, when it took the connection, from which the parked time counts. */
    private long since;
    private long scanModeSince = Long.MIN_VALUE / 2;
    private boolean leavingParked;
    /** Whether the pause came from the bike standing near: it then ends by itself once the rider has left. */
    private boolean pausedParked;
    /** When the bike was last heard above the far threshold, during a pause for standing near. */
    private long lastNear;
    private final ArrayDeque<Reading> readings = new ArrayDeque<>();
    /** When the link was last connected and accepted, whoever connected it. */
    private long linkSince;
    /** Whether the wait for the ride guard was put in the history, until the signal is strong again. */
    private boolean waitLogged;
    /** Set while a connection it made itself settles, which is no takeover of the app's. */
    private boolean arriving;
    private final ArrayDeque<Entry> history = new ArrayDeque<>();

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
        boolean holding = state == State.CONNECTED || (state == State.APP && linkReady);
        if (holding) {
            long from = state == State.CONNECTED ? since : linkSince;
            preview.signalDbm = readings.isEmpty() ? null : median();
            preview.signalNowDbm = readings.isEmpty() ? null : readings.peekLast().rssi;
            preview.signalSettled = now - from >= settings.farMs;
            preview.parkedLeftMs = Math.max(0, settings.parkedMs - (now - Math.max(lastMoved, from)));
        }
        if (lastMoved > Long.MIN_VALUE / 2) preview.movedAgoMs = now - lastMoved;
        preview.guardLeftMs = Math.max(0, settings.rideGuardMs - (now - lastMoved));
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
        if (state == State.IDLE || state == State.NEAR || pausedParked) actions.stopScan();
        state = State.PAUSED;
        pausedParked = false;
        log(Event.PAUSED_BY_RIDER, now, 0);
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
            if (before == State.IDLE || before == State.NEAR) {
                actions.stopScan();
                readings.clear();
            }
            state = State.APP;
            actions.status(linkReady ? Status.CONNECTED : Status.LOOKING);
        } else if (linkReady) {
            if (before != State.CONNECTED) {
                if (before == State.APP && !arriving) log(Event.TOOK_OVER, now, 0);
                state = State.CONNECTED;
                since = now;
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
        linkSince = now;
        if (state == State.APP) {
            readings.clear();
            actions.status(Status.CONNECTED);
        }
        if (state == State.CONNECTING) {
            state = State.APP;
            arriving = true;
            settle(now);
            arriving = false;
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
                boolean mayBeUnlocked = settings.autoLock && !wasLocked;
                log(mayBeUnlocked ? Event.LINK_LOST_UNLOCKED : Event.LINK_LOST, now, 0);
                if (mayBeUnlocked) actions.alert(Alert.MAY_BE_UNLOCKED);
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
            case APP:
                actions.status(Status.LOOKING);
                break;
            default:
                break;
        }
    }

    /** The connection's signal strength. */
    void rssi(int rssi, long now) {
        if (state == State.CONNECTED || (state == State.APP && linkReady)) readings.add(new Reading(now, rssi));
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

    void lockDone(boolean ok, long now) {
        if (state != State.LEAVING) return;
        log(ok ? Event.LOCKED : Event.LOCK_FAILED, now, 0);
        if (!ok) actions.alert(Alert.MAY_BE_UNLOCKED);
        actions.disconnect();
    }

    /** Called about twice a second while it runs. */
    void tick(long now) {
        if (state == State.PAUSED && pausedParked && now - lastNear >= settings.awayMs) {
            // The rider left the bike: auto-connect looks for it again, slowly, as before the pause.
            pausedParked = false;
            log(Event.RIDER_LEFT, now, 0);
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
            } else if (now - since >= settings.nearMs && now - scanModeSince >= settings.scanModeMs) {
                look(false, now);
            }
        } else if (state == State.CONNECTED) {
            actions.readRssi();
            dropBefore(now - settings.farMs);
            // The ride guard counts only movement the bike reported, so that a connection just made locks as soon as
            // the signal says the rider left; the parked time counts from the connection at the earliest.
            boolean moving = now - lastMoved < settings.rideGuardMs;
            boolean weak = now - since >= settings.farMs && !readings.isEmpty() && median() < settings.farDbm;
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
        } else if (state == State.APP && linkReady) {
            // Only read, for the preview the app shows: with the app on screen, it decides nothing.
            actions.readRssi();
            dropBefore(now - settings.farMs);
        }
    }

    /** @param value what the history says with it: the signal's median in dBm, or the minutes parked */
    private void leave(boolean parked, long now, int value) {
        state = State.LEAVING;
        leavingParked = parked;
        waitLogged = false;
        boolean lock = settings.autoLock && !Boolean.TRUE.equals(locked);
        if (parked) log(lock ? Event.LOCKING_PARKED : Event.LEAVING_PARKED, now, value);
        else log(lock ? Event.LOCKING_AWAY : Event.LEAVING_AWAY, now, value);
        if (lock) actions.lock();
        else actions.disconnect();
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
