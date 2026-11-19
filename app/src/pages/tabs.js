// The connected app: four tabs over one session, each page re-rendered whenever the bike's state changes, with the
// connection status in every header.
import { batteryFull, bicycle, ellipsisHorizontal, speedometer } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { loadUnits, saveUnits } from '../preferences.js';
import { assistPage } from './assist.js';
import { batteryPage } from './battery.js';
import { dashboardPage } from './dashboard.js';
import { morePage } from './more.js';
import { el, icon, statusBadge } from './ui.js';

/** @typedef {import('../session.js').Session} Session */
/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */

/**
 * @param {{ session: Session, keyStore: KeyStore, onDisconnect: () => void }} options
 * @returns {HTMLElement}
 */
export function tabsPage({ session, keyStore, onDisconnect }) {
    let units = loadUnits();
    const getUnits = () => units;
    const status = statusBadge(t('common.connected'));
    const pages = [
        {
            tab: 'bike',
            iconName: bicycle,
            label: t('tabs.bike'),
            page: dashboardPage(session, getUnits, status.element),
        },
        {
            tab: 'assist',
            iconName: speedometer,
            label: t('tabs.assist'),
            page: assistPage(session, getUnits, status.element),
        },
        { tab: 'battery', iconName: batteryFull, label: t('tabs.battery'), page: batteryPage(session, status.element) },
        {
            tab: 'more',
            iconName: ellipsisHorizontal,
            label: t('tabs.more'),
            page: morePage({
                session,
                keyStore,
                units: getUnits,
                setUnits: (next) => {
                    units = next;
                    saveUnits(next);
                    renderAll();
                },
                onDisconnect,
                status: status.element,
            }),
        },
    ];
    let lastPulse = 0;
    const renderAll = () => {
        for (const { page } of pages) page.render(session.state);
        const now = Date.now();
        if (now - lastPulse > 900) {
            lastPulse = now;
            status.pulse();
        }
    };
    session.onChange(renderAll);

    const tabBar = el(
        'ion-tab-bar',
        { slot: 'bottom', 'selected-tab': 'bike' },
        pages.map(({ tab, iconName, label }) =>
            el('ion-tab-button', { tab }, [icon(iconName), el('ion-label', {}, [label])])
        )
    );
    const tabs = el('ion-tabs', {}, [...pages.map(({ tab, page }) => el('ion-tab', { tab }, [page.element])), tabBar]);
    customElements
        .whenDefined('ion-tabs')
        .then(() => /** @type {HTMLElement & { componentOnReady: () => Promise<void> }} */ (tabs).componentOnReady())
        .then(() => /** @type {HTMLElement & { select: (tab: string) => Promise<boolean> }} */ (tabs).select('bike'))
        .catch(() => undefined);
    return tabs;
}
