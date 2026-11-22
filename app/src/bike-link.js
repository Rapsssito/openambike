// The link to the bike while the app shows its tabs: it connects with the saved key, keeps the connection as
// src/connection.js does, and says where it stands, so that the tabs stay on screen whether the bike is connected or
// not. The screens read and command the bike through its view, which stands for whichever session is live, keeps the
// last values when there is none, and fails a command with InterruptedError while disconnected.
import { AuthenticationError, bikeById, chooseBike, SCAN_TIMEOUT_MS, scanForBikes } from './ble/bike.js';
import { keepConnected } from './connection.js';
import { createSession, emptyState, InterruptedError } from './session.js';

/** @typedef {import('./ble/bike.js').Bike} Bike */
/** @typedef {import('./ble/bike.js').BleClientLike} BleClientLike */
/** @typedef {import('./ble/bike.js').FoundBike} FoundBike */
/** @typedef {import('./session.js').Session} Session */
/** @typedef {import('./session.js').BikeState} BikeState */

/**
 * Where the link stands: `idle` waits for the rider to connect, as after "Disconnect" or in a browser, which needs a
 * tap to open its chooser; `connecting` goes through its steps (0 connect, 1 check the key, 2 read the bike);
 * `reconnecting` after the link dropped, by itself; `searching` lists the bikes nearby (Android); `failed` with the
 * error; `refused` once the bike did not accept the saved key.
 * @typedef {object} LinkStatus
 * @property {'idle' | 'connecting' | 'connected' | 'reconnecting' | 'searching' | 'failed' | 'refused'} phase
 * @property {number} [step] while connecting
 * @property {unknown} [error] why it failed
 * @property {string} [message] why it is idle, in the rider's words
 * @property {FoundBike[]} [found] the bikes found by the search; with `failed`, none was found
 * @property {boolean} [done] while searching, whether the search has ended
 */

/** The bike as the screens see it: the live session's state and commands, or the last values with none. */
export function createBikeView() {
    /** @type {Session | null} */
    let session = null;
    let state = emptyState();
    /** @type {Set<(state: BikeState) => void>} */
    const listeners = new Set();
    /** @type {(() => void) | null} */
    let unsubscribe = null;
    /** @param {BikeState} next */
    const forward = (next) => {
        state = next;
        for (const listener of listeners) listener(state);
    };
    const live = () => {
        if (!session) throw new InterruptedError();
        return session;
    };
    return {
        /** @returns {BikeState} */
        get state() {
            return state;
        },
        /**
         * @param {(state: BikeState) => void} listener called on every change
         * @returns {() => void} removes the listener
         */
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        /** @param {Session} next a started session, whose values it shows from now on */
        attach(next) {
            if (unsubscribe) unsubscribe();
            session = next;
            unsubscribe = next.onChange(forward);
            forward(next.state);
        },
        /** Keeps the last values, no longer live. */
        detach() {
            if (unsubscribe) unsubscribe();
            unsubscribe = null;
            session = null;
            if (state.connected) forward({ ...state, connected: false });
        },
        /** @param {number} mode */
        setAssistMode: async (mode) => live().setAssistMode(mode),
        /** @param {boolean} on */
        setLights: async (on) => live().setLights(on),
        /** @param {boolean} locked */
        setLocked: async (locked) => live().setLocked(locked),
        /** @param {boolean} on */
        setGnss: async (on) => live().setGnss(on),
        /** @param {boolean} on */
        setGsm: async (on) => live().setGsm(on),
        /** @param {import('./ble/protocol.js').AssistSetting} mode1 @param {import('./ble/protocol.js').AssistSetting} mode2 */
        changeAssistLevels: async (mode1, mode2) => live().changeAssistLevels(mode1, mode2),
        restart: async () => live().restart(),
        sleep: async () => live().sleep(),
        calibrateTorqueSensor: async () => live().calibrateTorqueSensor(),
    };
}

/** @typedef {ReturnType<typeof createBikeView>} BikeView */

/**
 * @param {object} options
 * @param {BleClientLike} options.client
 * @param {boolean} options.native on Android, the bike is reached by its address; in a browser, through its chooser
 * @param {() => Promise<string | null>} options.loadKey the saved owner key
 * @param {() => string | null} options.loadBikeId the bike connected last (Android)
 * @param {(id: string | null) => void} options.saveBikeId
 * @param {(bike: Bike, key: string) => void} [options.onConnected] called on each connection the rider or the app asked
 *     for, not on the reconnections after a drop
 * @param {number[]} [options.delays] between attempts to reconnect after a drop
 */
export function createBikeLink({ client, native, loadKey, loadBikeId, saveBikeId, onConnected, delays }) {
    const view = createBikeView();
    /** @type {LinkStatus} */
    let status = { phase: 'idle' };
    /** @type {Set<(status: LinkStatus) => void>} */
    const listeners = new Set();
    /** @type {{ bike: Bike, session: Session, keep: { stop: () => void } } | null} */
    let current = null;
    /** Counts the rider's requests, so that an attempt overtaken by a newer one, or by "Disconnect", is dropped. */
    let attempt = 0;
    /** @type {(() => void) | null} */
    let stopSearch = null;

    /** @param {LinkStatus} next */
    const set = (next) => {
        status = next;
        for (const listener of listeners) listener(status);
    };

    const endSearch = () => {
        const stop = stopSearch;
        stopSearch = null;
        if (stop) stop();
    };

    /** Ends the connection, if any, keeping the last values on screen. */
    async function drop() {
        const ending = current;
        current = null;
        view.detach();
        if (!ending) return;
        ending.keep.stop();
        await ending.session.stop();
        await ending.bike.disconnect().catch(() => undefined);
    }

    /**
     * Takes a bike connected and authenticated, starts its session and keeps it connected.
     * @param {Bike} bike
     * @param {string} key the owner key the bike accepted
     */
    async function adopt(bike, key) {
        const session = createSession(bike);
        await session.start();
        const keep = keepConnected({
            bike,
            session,
            key,
            delays,
            onGiveUp: async () => {
                if (current?.session !== session) return;
                await drop();
                set({ phase: 'refused' });
            },
        });
        current = { bike, session, keep };
        // A drop shows as reconnecting, until the session starts again.
        session.onChange((state) => {
            if (current?.session !== session) return;
            const phase = state.connected ? 'connected' : 'reconnecting';
            if (status.phase !== phase) set({ phase });
        });
        view.attach(session);
        set({ phase: 'connected' });
        if (onConnected) onConnected(bike, key);
    }

    /**
     * Connects to the bike `getBike` gives with the saved key, step by step.
     * @param {() => Promise<Bike>} getBike
     */
    async function run(getBike) {
        endSearch();
        const mine = ++attempt;
        await drop();
        const key = await loadKey().catch(() => null);
        if (mine !== attempt) return;
        if (key === null) return set({ phase: 'refused' });
        let step = 0;
        set({ phase: 'connecting', step });
        /** @type {Bike | null} */
        let bike = null;
        try {
            bike = await getBike();
            await bike.connect();
            if (mine !== attempt) throw new InterruptedError();
            set({ phase: 'connecting', step: ++step });
            await bike.authenticate(key);
            if (mine !== attempt) throw new InterruptedError();
            if (native) saveBikeId(bike.deviceId);
            set({ phase: 'connecting', step: ++step });
            await adopt(bike, key);
        } catch (error) {
            if (bike && current?.bike !== bike) await bike.disconnect().catch(() => undefined);
            if (mine !== attempt) return;
            set(error instanceof AuthenticationError ? { phase: 'refused' } : { phase: 'failed', step, error });
        }
    }

    return {
        view,

        /** @returns {LinkStatus} */
        get status() {
            return status;
        },

        /**
         * @param {(status: LinkStatus) => void} listener called on every change
         * @returns {() => void} removes the listener
         */
        onStatus(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        adopt,

        /** Connects to the bike connected last, or, on Android with none known, searches for one. */
        connect() {
            const known = native ? loadBikeId() : null;
            if (!native) return run(() => chooseBike(client, { native }));
            if (known) return run(() => bikeById(client, known));
            return this.search();
        },

        /** Lists the bikes nearby, on Android, for the rider to choose one. */
        async search() {
            endSearch();
            const mine = ++attempt;
            await drop();
            /** @type {FoundBike[]} */
            const found = [];
            set({ phase: 'searching', found });
            try {
                const stopScan = await scanForBikes(client, (bike) => {
                    if (mine !== attempt || found.some(({ deviceId }) => deviceId === bike.deviceId)) return;
                    found.push(bike);
                    set({ phase: 'searching', found: [...found] });
                });
                const timer = setTimeout(() => {
                    endSearch();
                    if (mine !== attempt) return;
                    set(found.length === 0 ? { phase: 'failed', found } : { phase: 'searching', found, done: true });
                }, SCAN_TIMEOUT_MS);
                stopSearch = () => {
                    clearTimeout(timer);
                    stopScan().catch(() => undefined);
                };
                if (mine !== attempt) endSearch();
            } catch (error) {
                if (mine === attempt) set({ phase: 'failed', error });
            }
        },

        /** @param {FoundBike} found a bike of the search, which is connected to from now on */
        choose(found) {
            return run(() => bikeById(client, found.deviceId));
        },

        /**
         * Ends the connection, or the attempt, and waits for the rider to connect again.
         * @param {string} [message] why, in the rider's words
         */
        async disconnect(message) {
            endSearch();
            attempt++;
            await drop();
            set({ phase: 'idle', message });
        },
    };
}

/** @typedef {ReturnType<typeof createBikeLink>} BikeLink */
