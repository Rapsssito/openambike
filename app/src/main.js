// Starts the app: Ionic's components, the language, and the screens. The connect screen shows only until a bike is
// linked: no key saved, or, on Android, no bike known. Then the tabs show, connected or not, with the link to the bike
// and its state in them; the connect screen shows again only when the rider forgets the key or chooses another.
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
import { createBikeLink } from './bike-link.js';
import { loadBikeId, saveBikeId } from './preferences.js';
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
 * The first screen, until a bike is linked.
 * @param {string} [message]
 */
function showConnect(message) {
    app?.replaceChildren(
        connectPage({
            client,
            native,
            bluetoothAvailable,
            keyStore,
            message,
            onConnected: async (bike, key) => {
                const link = newLink();
                await link.adopt(bike, key);
                showTabs(link);
            },
        })
    );
}

/**
 * Auto-connect, if on, runs with the texts of now and the key the bike just accepted. Turned on again by a restored
 * backup with auto-ride, it asks at once for location "all the time", which a backup does not bring back.
 * @param {import('./ble/bike.js').Bike} bike
 * @param {string} key the owner key the bike accepted
 */
function onConnected(bike, key) {
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
}

/** A link to the bike with the saved key. A refused key turns auto-connect off, so that it never tries it again. */
function newLink() {
    const link = createBikeLink({
        client,
        native,
        loadKey: () => keyStore.load(),
        loadBikeId,
        saveBikeId,
        onConnected,
        onRiderConnect: async () => {
            await autoConnect?.riderConnecting();
        },
    });
    link.onStatus(({ phase }) => {
        if (phase === 'refused') autoConnect?.disable().catch(() => undefined);
    });
    return link;
}

/**
 * The tabs, whether the bike is connected or not.
 * @param {import('./bike-link.js').BikeLink} link
 */
function showTabs(link) {
    /**
     * Leaves the tabs for the connect screen, with the key gone: auto-connect turns off.
     * @param {string} [message]
     */
    const unlink = async (message) => {
        await autoConnect?.disable().catch(() => undefined);
        await link.disconnect();
        showConnect(message);
    };
    app?.replaceChildren(
        tabsPage({
            link,
            native,
            keyStore,
            // Auto-connect, if on, pauses until the rider connects again, and the card says so.
            onDisconnect: async () => {
                const paused = await autoConnect?.status().then(
                    (status) => status.enabled,
                    () => false
                );
                await autoConnect?.pause().catch(() => undefined);
                await link.disconnect(paused ? t('home.autoConnectPaused') : undefined);
            },
            onSleep: async () => {
                await autoConnect?.pause().catch(() => undefined);
                await link.disconnect(t('home.asleep'));
            },
            onForget: () => unlink(t('more.forgotten')),
            onOtherKey: async () => {
                const header = t('home.otherKey');
                const message = t('home.otherKeyConfirm');
                if (!(await confirmAction({ header, message, confirm: header, danger: true }))) return;
                await keyStore.remove().catch(() => undefined);
                await unlink();
            },
            autoConnect,
            rides,
        })
    );
}

/** The tabs once a bike is linked, connecting at once on Android; the connect screen otherwise. */
async function start() {
    const key = await keyStore.load().catch(() => null);
    if (key === null || (native && loadBikeId() === null)) return showConnect();
    const link = newLink();
    showTabs(link);
    // A browser opens its chooser only from a tap, so there the card's "Connect" starts the connection.
    if (native && bluetoothAvailable) link.connect();
}

// Auto-connect left on alone by an earlier version turns off, as no switch shows it any more.
autoConnect?.turnOffAlone().catch(() => undefined);
start();
