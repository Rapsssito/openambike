import { createBackStack } from './back-stack.js';

/** The native side of Android's back button: told whether the app handles it, it says when it is pressed. */
function fakeNative() {
    /** @type {((data: object) => void)[]} */
    const listeners = [];
    return {
        handled: false,
        plugin: {
            setBackHandled: async (/** @type {{ handled: boolean }} */ { handled }) => {
                native.handled = handled;
            },
            addListener: async (/** @type {string} */ _event, /** @type {(data: object) => void} */ listener) => {
                listeners.push(listener);
                return { remove: async () => undefined };
            },
        },
        /** The rider presses the back button; only when the app said it handles it does it reach the app. */
        pressBack() {
            if (native.handled) for (const listener of listeners) listener({});
        },
    };
}
const native = fakeNative();

describe('the back button and the overlays', () => {
    beforeEach(() => {
        native.handled = false;
    });

    test('back closes the overlay on top, and nothing else', async () => {
        const stack = createBackStack();
        await stack.connect(native.plugin);
        const closed = /** @type {string[]} */ ([]);
        stack.add(() => closed.push('first'));
        stack.add(() => closed.push('second'));
        native.pressBack();
        expect(closed).toEqual(['second']);
        native.pressBack();
        expect(closed).toEqual(['second', 'first']);
    });

    test('while an overlay is open the app handles the back button, and otherwise Android does', async () => {
        const stack = createBackStack();
        await stack.connect(native.plugin);
        expect(native.handled).toBe(false);
        const releaseFirst = stack.add(() => undefined);
        const releaseSecond = stack.add(() => undefined);
        expect(native.handled).toBe(true);
        releaseSecond();
        expect(native.handled).toBe(true);
        releaseFirst();
        expect(native.handled).toBe(false);
        // The rider's back with nothing open is Android's: it reaches no overlay.
        native.pressBack();
    });

    test('an overlay that closed by itself is not closed again by back', async () => {
        const stack = createBackStack();
        await stack.connect(native.plugin);
        const closed = /** @type {string[]} */ ([]);
        stack.add(() => closed.push('first'));
        const release = stack.add(() => closed.push('second'));
        release();
        native.pressBack();
        expect(closed).toEqual(['first']);
    });

    test('an overlay closed by back, which then releases itself, leaves the stack once', async () => {
        const stack = createBackStack();
        await stack.connect(native.plugin);
        const closed = /** @type {string[]} */ ([]);
        stack.add(() => closed.push('first'));
        /** @type {() => void} */
        const release = stack.add(() => {
            closed.push('second');
            release();
        });
        native.pressBack();
        native.pressBack();
        expect(closed).toEqual(['second', 'first']);
    });

    test('in the web app, with no native side, overlays open and close as usual', () => {
        const stack = createBackStack();
        const release = stack.add(() => undefined);
        release();
    });
});
