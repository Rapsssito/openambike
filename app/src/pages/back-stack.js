// The overlays (sheets, the ride screen, the map over the whole screen, dialogs) close with Android's back button, as
// the rider expects, instead of leaving the app. While one is open the app's native plugin hands the back button to the
// app, which closes the one on top; with none open Android handles it as before.

/**
 * The part of the native plugin this uses.
 * @typedef {object} BackPlugin
 * @property {(options: { handled: boolean }) => Promise<void>} setBackHandled
 * @property {(event: 'backButton', listener: () => void) => Promise<unknown>} addListener
 */

export function createBackStack() {
    /** The overlays open, the newest last, each with how to close it. */
    /** @type {{ close: () => void }[]} */
    const open = [];
    /** @type {BackPlugin | null} */
    let native = null;

    /** Tells the native side whether the app has an overlay for the back button. */
    function tell() {
        native?.setBackHandled({ handled: open.length > 0 }).catch(() => undefined);
    }

    return {
        /**
         * Starts listening to the back button of the Android app.
         * @param {BackPlugin} plugin
         */
        async connect(plugin) {
            native = plugin;
            await plugin.addListener('backButton', () => {
                // It closes, and with it leaves the stack once it releases itself.
                const top = open.pop();
                tell();
                top?.close();
            });
            tell();
        },
        /**
         * An overlay opened.
         * @param {() => void} close closes it, as the back button asks
         * @returns {() => void} to call once it is closed, however it was
         */
        add(close) {
            const entry = { close };
            open.push(entry);
            tell();
            return () => {
                const index = open.indexOf(entry);
                if (index < 0) return;
                open.splice(index, 1);
                tell();
            };
        },
    };
}

/** The app's stack, which `main.js` connects to the native back button. */
export const backStack = createBackStack();

/**
 * Closes an overlay with the back button.
 * @param {() => void} close closes it
 * @returns {() => void} to call once it is closed
 */
export function closeOnBack(close) {
    return backStack.add(close);
}
