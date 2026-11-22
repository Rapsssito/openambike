// The steps of a connection as a list: each waiting, running, done (a tick) or failed.
import { checkmarkCircle, closeCircle, ellipseOutline } from 'ionicons/icons';

import { el, icon } from './ui.js';

/**
 * @param {string[]} labels
 */
export function steps(labels) {
    const items = labels.map((label) => {
        const mark = el('span', { class: 'step-mark' });
        return { mark, element: el('div', { class: 'step' }, [mark, el('span', {}, [label])]) };
    });
    const element = el(
        'div',
        { class: 'steps' },
        items.map((i) => i.element)
    );
    /**
     * @param {number} active the step running; steps before it are done
     * @param {boolean} [failed] whether the active step failed
     */
    const show = (active, failed = false) => {
        items.forEach(({ mark, element: step }, index) => {
            const state = index < active ? 'done' : index === active ? (failed ? 'failed' : 'active') : 'waiting';
            step.className = `step ${state}`;
            mark.replaceChildren(
                state === 'active'
                    ? el('ion-spinner', { name: 'crescent' })
                    : icon(state === 'done' ? checkmarkCircle : state === 'failed' ? closeCircle : ellipseOutline)
            );
        });
    };
    return { element, show };
}
