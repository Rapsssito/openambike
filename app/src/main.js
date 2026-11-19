// Starts the app: Ionic's components, the language, and the screens. Before a connection the connect screen shows;
// while connected, the tabs over one session; when the bike disconnects, the connect screen again.
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
import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

import { pickLanguage, setLanguage, t } from './i18n/i18n.js';
import { connectPage } from './pages/connect.js';
import { tabsPage } from './pages/tabs.js';
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
const keyStore = native
    ? createNativeKeyStore(SecureStorage)
    : createWebKeyStore(indexedDbRecords(indexedDB), crypto.subtle);
const app = document.querySelector('ion-app');

/** @param {string} [message] */
function showConnect(message) {
    app?.replaceChildren(
        connectPage({ client: BleClient, native, bluetoothAvailable, keyStore, message, onConnected })
    );
}

/** @param {import('./ble/bike.js').Bike} bike */
async function onConnected(bike) {
    const session = createSession(bike);
    let ended = false;
    /** @param {string} [message] */
    const end = async (message) => {
        if (ended) return;
        ended = true;
        await session.stop();
        showConnect(message);
    };
    bike.onDisconnect(() => end(t('home.disconnected')));
    await session.start();
    app?.replaceChildren(
        tabsPage({
            session,
            keyStore,
            onDisconnect: async () => {
                await end();
                await bike.disconnect().catch(() => undefined);
            },
        })
    );
}

showConnect();
