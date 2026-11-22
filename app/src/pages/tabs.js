// The app once a bike is linked: four tabs, and a fifth for rides on Android, whether the bike is connected or not. The
// tabs that need the bike (Bike, Assist, Battery) are blurred while it is not connected, under a card that says where
// the link stands and what to do; Rides and Settings work without it. The connection status in every header opens the
// same card in a sheet, with "Disconnect".
import { batteryFull, bicycle, map, settings, speedometer } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { loadBikeId, loadUnits, saveUnits } from '../preferences.js';
import { assistPage } from './assist.js';
import { batteryPage } from './battery.js';
import { dashboardPage } from './dashboard.js';
import { linkCard } from './link-card.js';
import { ridesPage } from './rides.js';
import { settingsPage } from './settings.js';
import { showRoute } from '../rides/route-map.js';
import { el, icon, openSheet, statusBadge } from './ui.js';

/** @typedef {import('../bike-link.js').BikeLink} BikeLink */
/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */

/**
 * The status in the headers, in a word or two.
 * @param {import('../bike-link.js').LinkStatus} linkStatus
 */
function badgeText({ phase }) {
    if (phase === 'connected') return t('common.connected');
    if (phase === 'reconnecting') return t('common.reconnecting');
    if (phase === 'connecting' || phase === 'searching') return t('common.connecting');
    return t('common.disconnected');
}

/**
 * @param {object} options
 * @param {BikeLink} options.link
 * @param {boolean} options.native
 * @param {KeyStore} options.keyStore
 * @param {() => void} options.onDisconnect the rider chose to disconnect
 * @param {() => void} options.onSleep the bike was sent to sleep
 * @param {() => void} options.onForget the key was removed from this device
 * @param {() => void} options.onOtherKey after a refused key, the rider chose to use another
 * @param {import('../auto-connect.js').AutoConnect | null} [options.autoConnect]
 * @param {import('../rides/rides.js').Rides | null} [options.rides]
 * @returns {HTMLElement}
 */
export function tabsPage({
    link,
    native,
    keyStore,
    onDisconnect,
    onSleep,
    onForget,
    onOtherKey,
    autoConnect = null,
    rides = null,
}) {
    const bike = link.view;
    let units = loadUnits();
    const getUnits = () => units;
    const status = statusBadge(badgeText(link.status));
    const settingsTab = settingsPage({
        keyStore,
        units: getUnits,
        setUnits: (next) => {
            units = next;
            saveUnits(next);
            renderAll();
        },
        onForget,
        status: status.element,
        autoConnect,
        bikeAddress: native ? loadBikeId : () => null,
    });
    /** @type {{ tab: string, iconName: string, label: string, page: { element: HTMLElement, render: (state: import('../session.js').BikeState) => void }, needsBike: boolean }[]} */
    const pages = [
        {
            tab: 'bike',
            iconName: bicycle,
            label: t('tabs.bike'),
            page: dashboardPage(bike, getUnits, status.element, {
                // A lock pressed by hand holds against auto-unlock (app/DEVELOPMENT.md, "Auto-connect").
                onLockPressed: (locked) => autoConnect?.lockPressed(locked).catch(() => undefined),
                onSleep,
            }),
            needsBike: true,
        },
        {
            tab: 'assist',
            iconName: speedometer,
            label: t('tabs.assist'),
            page: assistPage(bike, getUnits, status.element),
            needsBike: true,
        },
        {
            tab: 'battery',
            iconName: batteryFull,
            label: t('tabs.battery'),
            page: batteryPage(bike, status.element),
            needsBike: true,
        },
        // Rides only where the app's native service records them: on Android.
        ...(rides
            ? [
                  {
                      tab: 'rides',
                      iconName: map,
                      label: t('tabs.rides'),
                      page: ridesPage({ rides, units: getUnits, status: status.element, showRoute }),
                      needsBike: false,
                  },
              ]
            : []),
        { tab: 'more', iconName: settings, label: t('tabs.more'), page: settingsTab, needsBike: false },
    ];

    // Over each tab that needs the bike, the card, shown while it is not connected; the last values stay under it.
    const cardOptions = { link, native, onOtherKey };
    for (const { page, needsBike } of pages) {
        if (!needsBike) continue;
        const { element } = linkCard(cardOptions);
        element.setAttribute('slot', 'fixed');
        page.element.querySelector('ion-content')?.append(element);
    }

    let lastPulse = 0;
    const renderAll = () => {
        for (const { page } of pages) page.render(bike.state);
        const now = Date.now();
        if (bike.state.connected && now - lastPulse > 900) {
            lastPulse = now;
            status.pulse();
        }
    };
    /** @param {import('../bike-link.js').LinkStatus} linkStatus */
    const showLink = (linkStatus) => {
        const connected = linkStatus.phase === 'connected';
        tabs.classList.toggle('offline', !connected);
        tabs.classList.toggle('unlinked', !connected);
        status.set(badgeText(linkStatus), !connected);
    };

    // The status in a header opens the card in a sheet, with "Disconnect", which says whether auto-lock and auto-ride
    // pause.
    const openLink = async () => {
        const sheetCard = linkCard({
            ...cardOptions,
            onDisconnect: () => {
                sheet?.dismiss().catch(() => false);
                onDisconnect();
            },
            disconnectLabel: async () => {
                const enabled = await autoConnect?.status().then(
                    (current) => current.enabled,
                    () => false
                );
                return t(enabled ? 'more.disconnectPause' : 'more.disconnect');
            },
        });
        /** @type {{ dismiss: () => Promise<boolean> } | null} */
        let sheet = null;
        sheet = await openSheet(t('link.title'), [sheetCard.element], () => sheetCard.stop());
    };

    const tabBar = el(
        'ion-tab-bar',
        { slot: 'bottom', 'selected-tab': 'bike' },
        pages.map(({ tab, iconName, label }) =>
            el('ion-tab-button', { tab }, [icon(iconName), el('ion-label', {}, [label])])
        )
    );
    const tabs = el('ion-tabs', {}, [...pages.map(({ tab, page }) => el('ion-tab', { tab }, [page.element])), tabBar]);
    // The headers hold copies of the status, so a tap on any of them is caught here.
    tabs.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('.status-badge')) openLink();
    });
    bike.onChange(renderAll);
    link.onStatus(showLink);
    renderAll();
    showLink(link.status);
    customElements
        .whenDefined('ion-tabs')
        .then(() => /** @type {HTMLElement & { componentOnReady: () => Promise<void> }} */ (tabs).componentOnReady())
        .then(() => /** @type {HTMLElement & { select: (tab: string) => Promise<boolean> }} */ (tabs).select('bike'))
        .catch(() => undefined);
    return tabs;
}
