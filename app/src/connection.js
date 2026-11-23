// Keeps a session going while the app is open: when the bike's link drops, the session pauses, keeping what it knew,
// and the app connects again, checks the key and starts the session anew, retrying until it succeeds. Only a refused
// key, or being stopped, ends it.
import { AuthenticationError } from './ble/bike.js';

/** Waits before each attempt to reconnect; the last one repeats. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000];

/**
 * @param {object} options
 * @param {import('./ble/bike.js').Bike} options.bike connected and authenticated
 * @param {import('./session.js').Session} options.session started
 * @param {string} options.key the owner key the bike accepted
 * @param {(error: unknown) => void} options.onGiveUp called if the bike refuses the key on reconnecting
 * @param {(error: unknown) => void} [options.onAttemptFailed] called on each attempt that failed, before the next
 * @param {number[]} [options.delays]
 * @returns {{ stop: () => void }} stops reconnecting, before a disconnection that the app asks for
 */
export function keepConnected({ bike, session, key, onGiveUp, onAttemptFailed, delays = RECONNECT_DELAYS_MS }) {
    let stopped = false;
    let reconnecting = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    /** @type {() => void} */
    let wake = () => undefined;

    /** @param {number} ms */
    const wait = (ms) =>
        new Promise((resolve) => {
            wake = () => resolve(undefined);
            timer = setTimeout(resolve, ms);
        });

    async function reconnect() {
        if (reconnecting || stopped) return;
        reconnecting = true;
        await session.pause();
        for (let attempt = 0; !stopped; attempt++) {
            await wait(delays[Math.min(attempt, delays.length - 1)]);
            if (stopped) break;
            try {
                await bike.connect();
                await bike.authenticate(key);
                await session.start();
                break;
            } catch (error) {
                if (error instanceof AuthenticationError) {
                    stopped = true;
                    onGiveUp(error);
                    break;
                }
                if (onAttemptFailed) onAttemptFailed(error);
                await bike.disconnect().catch(() => undefined);
            }
        }
        reconnecting = false;
    }

    bike.onDisconnect(() => {
        reconnect().catch(() => undefined);
    });

    return {
        stop() {
            stopped = true;
            if (timer !== null) clearTimeout(timer);
            wake();
        },
    };
}
