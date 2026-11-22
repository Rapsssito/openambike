// The connected app: four tabs over one session, and a fifth for rides on Android, each page re-rendered whenever the
// bike's state changes, with the connection status in every header.
import { batteryFull, bicycle, map, settings, speedometer } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { loadUnits, saveUnits } from '../preferences.js';
import { assistPage } from './assist.js';
import { batteryPage } from './battery.js';
import { dashboardPage } from './dashboard.js';
import { ridesPage } from './rides.js';
import { settingsPage } from './settings.js';
import { showRoute } from '../rides/route-map.js';
import { el, icon, statusBadge } from './ui.js';

/** @typedef {import('../session.js').Session} Session */
/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */

/**
 * @param {{ session: Session, keyStore: KeyStore, onDisconnect: () => void, onSleep: () => void, onForget: () => void, autoConnect?: import('../auto-connect.js').AutoConnect | null, rides?: import('../rides/rides.js').Rides | null }} options
 * @returns {HTMLElement}
 */
export function tabsPage({ session, keyStore, onDisconnect, onSleep, onForget, autoConnect = null, rides = null }) {
    let units = loadUnits();
    const getUnits = () => units;
    const status = statusBadge(t('common.connected'));
    const pages = [
        {
            tab: 'bike',
            iconName: bicycle,
            label: t('tabs.bike'),
            page: dashboardPage(session, getUnits, status.element, {
                // A lock pressed by hand holds against auto-unlock (app/DEVELOPMENT.md, "Auto-connect").
                onLockPressed: (locked) => autoConnect?.lockPressed(locked).catch(() => undefined),
            }),
        },
        {
            tab: 'assist',
            iconName: speedometer,
            label: t('tabs.assist'),
            page: assistPage(session, getUnits, status.element),
        },
        { tab: 'battery', iconName: batteryFull, label: t('tabs.battery'), page: batteryPage(session, status.element) },
        // Rides only where the app's native service records them: on Android.
        ...(rides
            ? [
                  {
                      tab: 'rides',
                      iconName: map,
                      label: t('tabs.rides'),
                      page: ridesPage({ rides, units: getUnits, status: status.element, showRoute }),
                  },
              ]
            : []),
        {
            tab: 'more',
            iconName: settings,
            label: t('tabs.more'),
            page: settingsPage({
                session,
                keyStore,
                units: getUnits,
                setUnits: (next) => {
                    units = next;
                    saveUnits(next);
                    session.onChange(renderAll);
                    renderAll();
                },
                onDisconnect,
                onSleep,
                onForget,
                status: status.element,
                autoConnect,
            }),
        },
    ];
    let lastPulse = 0;
    /** @type {boolean | null} */
    let wasConnected = null;
    const renderAll = () => {
        for (const { page } of pages) page.render(session.state);
        // While the bike reconnects, the values stay on screen and what would reach the bike is greyed out.
        const connected = session.state.connected;
        if (connected !== wasConnected) {
            wasConnected = connected;
            tabs.classList.toggle('offline', !connected);
            status.set(connected ? t('common.connected') : t('common.reconnecting'), !connected);
        }
        const now = Date.now();
        if (connected && now - lastPulse > 900) {
            lastPulse = now;
            status.pulse();
        }
    };
    const tabBar = el(
        'ion-tab-bar',
        { slot: 'bottom', 'selected-tab': 'bike' },
        pages.map(({ tab, iconName, label }) =>
            el('ion-tab-button', { tab }, [icon(iconName), el('ion-label', {}, [label])])
        )
    );
    const tabs = el('ion-tabs', {}, [...pages.map(({ tab, page }) => el('ion-tab', { tab }, [page.element])), tabBar]);
    session.onChange(renderAll);
    renderAll();
    customElements
        .whenDefined('ion-tabs')
        .then(() => /** @type {HTMLElement & { componentOnReady: () => Promise<void> }} */ (tabs).componentOnReady())
        .then(() => /** @type {HTMLElement & { select: (tab: string) => Promise<boolean> }} */ (tabs).select('bike'))
        .catch(() => undefined);
    return tabs;
}
