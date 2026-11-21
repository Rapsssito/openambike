// Starts the app: Ionic's components, the language, and the screens. Before a connection the connect screen shows;
// while connected, the tabs over one session, which reconnects by itself when the link drops. The connect screen shows
// again only when the rider disconnects, sends the bike to sleep or forgets the key, or the bike refuses the key.
import '@ionic/core/css/core.css';
import '@ionic/core/css/normalize.css';
import '@ionic/core/css/structure.css';
import '@ionic/core/css/typography.css';
import '@ionic/core/css/padding.css';
import '@ionic/core/css/palettes/dark.system.css';
import './theme.css';

import { initialize } from '@ionic/core/components';
import { defineCustomElement as defineAlert } from '@ionic/core/components/ion-alert.js';
import { defineCustomElement as defineApp } from '@ionic/core/components/ion-app.js';
import { defineCustomElement as defineButton } from '@ionic/core/components/ion-button.js';
import { defineCustomElement as defineButtons } from '@ionic/core/components/ion-buttons.js';
import { defineCustomElement as defineContent } from '@ionic/core/components/ion-content.js';
import { defineCustomElement as defineHeader } from '@ionic/core/components/ion-header.js';
import { defineCustomElement as defineInput } from '@ionic/core/components/ion-input.js';
import { defineCustomElement as defineLabel } from '@ionic/core/components/ion-label.js';
import { defineCustomElement as defineRange } from '@ionic/core/components/ion-range.js';
import { defineCustomElement as defineSpinner } from '@ionic/core/components/ion-spinner.js';
import { defineCustomElement as defineTab } from '@ionic/core/components/ion-tab.js';
import { defineCustomElement as defineTabBar } from '@ionic/core/components/ion-tab-bar.js';
import { defineCustomElement as defineTabButton } from '@ionic/core/components/ion-tab-button.js';
import { defineCustomElement as defineTabs } from '@ionic/core/components/ion-tabs.js';
import { defineCustomElement as defineTextarea } from '@ionic/core/components/ion-textarea.js';
import { defineCustomElement as defineTitle } from '@ionic/core/components/ion-title.js';
import { defineCustomElement as defineToast } from '@ionic/core/components/ion-toast.js';
import { defineCustomElement as defineToggle } from '@ionic/core/components/ion-toggle.js';
import { defineCustomElement as defineToolbar } from '@ionic/core/components/ion-toolbar.js';
import { defineCustomElement as defineIcon } from 'ionicons/components/ion-icon.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

import { createAutoConnect } from './auto-connect.js';
import { createNativeClient } from './ble/native-client.js';
import { createRides } from './rides/rides.js';
import { pickLanguage, setLanguage, t } from './i18n/i18n.js';
import { connectPage } from './pages/connect.js';
import { tabsPage } from './pages/tabs.js';
import { confirmAction } from './pages/ui.js';
import { keepConnected } from './connection.js';
import { createSession } from './session.js';
import { createNativeKeyStore, createWebKeyStore, indexedDbRecords } from './storage/key-store.js';

// Ionic's iOS look on every platform, so that the app looks the same on Android and in a browser.
initialize({ mode: 'ios' });
for (const define of [
    defineAlert,
    defineApp,
    defineButton,
    defineButtons,
    defineContent,
    defineHeader,
    defineIcon,
    defineInput,
    defineLabel,
    defineRange,
    defineSpinner,
    defineTab,
    defineTabBar,
    defineTabButton,
    defineTabs,
    defineTextarea,
    defineTitle,
    defineToast,
    defineToggle,
    defineToolbar,
]) {
    define();
}

setLanguage(pickLanguage(navigator.languages));

const native = Capacitor.isNativePlatform();
const bluetoothAvailable = native || 'bluetooth' in navigator;
// On Android, the app's own plugin holds the link to the bike in a native service, which also runs auto-connect;
// elsewhere, the Bluetooth plugin, and no auto-connect.
const bikeLink =
    Capacitor.getPlatform() === 'android'
        ? /** @type {import('./ble/native-client.js').BikeLinkPlugin} */ (registerPlugin('BikeLink'))
        : null;
const client = bikeLink ? createNativeClient(bikeLink) : BleClient;
const autoConnect = bikeLink ? createAutoConnect(bikeLink) : null;
const rides = bikeLink ? createRides(bikeLink) : null;
const keyStore = native
    ? createNativeKeyStore(SecureStorage, bikeLink ?? undefined)
    : createWebKeyStore(indexedDbRecords(indexedDB), crypto.subtle);
const app = document.querySelector('ion-app');

/**
 * @param {string} [message]
 * @param {boolean} [autoConnect]
 */
function showConnect(message, autoConnect = true) {
    app?.replaceChildren(
        connectPage({ client, native, bluetoothAvailable, keyStore, message, autoConnect, onConnected })
    );
}

/**
 * @param {import('./ble/bike.js').Bike} bike
 * @param {string} key the owner key the bike accepted
 */
async function onConnected(bike, key) {
    const session = createSession(bike);
    await session.start();
    // Auto-connect, if on, runs with the texts of now and the key the bike just accepted. Turned on again by a restored
    // backup with auto-ride, it asks at once for location "all the time", which a backup does not bring back.
    autoConnect
        ?.refresh({ address: bike.deviceId, key })
        .then(async ({ restored, autoRide }) => {
            if (!restored || !autoRide || (await autoConnect.hasBackgroundLocation())) return;
            const header = t('more.autoRide');
            if (await confirmAction({ header, message: t('more.autoRideRestored'), confirm: t('more.allow') })) {
                await autoConnect.askBackgroundLocation();
            }
        })
        .catch(() => undefined);
    let ended = false;
    /**
     * Leaves the tabs for the connect screen, ending the connection. Auto-connect, if on, pauses until the rider
     * connects again; with the key forgotten or refused, it turns off, so that it never tries a key that does not work.
     * @param {string} [message]
     * @param {{ keyGone?: boolean }} [options]
     */
    const end = async (message, { keyGone = false } = {}) => {
        if (ended) return;
        ended = true;
        await (keyGone ? autoConnect?.disable() : autoConnect?.pause())?.catch(() => undefined);
        link.stop();
        await session.stop();
        await bike.disconnect().catch(() => undefined);
        showConnect(message, false);
    };
    const link = keepConnected({ bike, session, key, onGiveUp: () => end(t('error.refused'), { keyGone: true }) });
    app?.replaceChildren(
        tabsPage({
            session,
            keyStore,
            // With auto-connect on, the connect screen says that it waits until the rider connects again.
            onDisconnect: async () => {
                const paused = await autoConnect?.status().then(
                    (status) => status.enabled,
                    () => false
                );
                await end(paused ? t('home.autoConnectPaused') : undefined);
            },
            onSleep: () => end(t('home.asleep')),
            onForget: () => end(t('more.forgotten'), { keyGone: true }),
            autoConnect,
            rides,
        })
    );
}

showConnect();
