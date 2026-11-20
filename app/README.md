# The app

OpenAMBike's app controls an Ampler e-bike over Bluetooth Low Energy, as [docs/protocol.md](../docs/protocol.md) specifies, with no server, account or internet connection. It is an Ionic and Capacitor app built for Android and for the web.

The web build runs in browsers with Web Bluetooth: Chrome and Edge, on desktop and on Android, but not Firefox, nor Safari on iOS. It is a progressive web app that can be installed and works offline. The code stays cross-platform, so that someone with a Mac and an Apple developer account can add an iOS build; iOS is not built or tested.

## Contents

- [Running](#running)
- [Screens](#screens)
- [Stack](#stack)
- [Structure](#structure)
- [Design](#design)
- [Permissions](#permissions)
- [Build and release](#build-and-release)
- [Libraries and licences](#libraries-and-licences)

## Running

You need Node 26 and, for Android, JDK 21 and the Android SDK with `platforms;android-36` and `build-tools;36.0.0`. Android Studio is not needed: the APK is built with Gradle on the command line and tried on a real phone. Run `npm install` once at the root of the repository, then, from the root:

| Command | What it does |
| --- | --- |
| `npm run dev --workspace=app` | Serve the app at http://localhost:8100; open it in Chrome or Edge on a computer with Bluetooth |
| `npm run build --workspace=app` | Build the web app into `app/dist/` |
| `npm run build --workspace=app && cd app && npx cap sync android && cd android && ./gradlew assembleDebug` | Build a debug APK |
| `adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk` | Install the debug APK on a phone connected to ADB |
| `cd app && npx cap run android` | Build, install and start the debug app on a phone connected to ADB |

The bike accepts one connection at a time: close the official app first. On Android, the first connection asks for the 6-digit code the bike shows, to pair. Then type the owner key once, or read it from a bug report ([docs/owner-key.md](../docs/owner-key.md) shows how to get it); the app keeps it on the device.

## Screens

- **Connect:** the owner key, typed once per device (with a button that shows it) or kept from before, and the connection shown step by step: connect, check the key, read the bike. Under the key, "Read from a bug report" fills it in from an Android bug report (the `.zip`, or a `btsnoop_hci.log` on its own), and "How do I get my key?" opens [docs/owner-key.md](https://github.com/Rapsssito/openambike/blob/main/docs/owner-key.md) in the system's browser.
- Once connected, four tabs, each with the connection status in its header:
  - **Bike:** the battery's charge as a ring with the range; speed, motor and rider power; the assist mode (off, mode 1, mode 2); lights and lock as large tiles; odometer and range.
  - **Assist:** the assist speed (10 to 25 km/h) and assist amount (40 to 100 %) of each of the two modes, read from the bike and written back as [docs/protocol.md](../docs/protocol.md), "Commands sent to the bike", says for the assist levels. Each mode is saved on its own and marked while not saved.
  - **Battery:** every battery value the specification documents (charge, voltage, current and whether it charges, power, pack temperatures, absolute state of charge, battery firmware status), live while connected.
  - **More:** bike information (firmware, motor controller firmware, battery serial number); settings (GPS, mobile network, units); maintenance (restart, sleep, torque sensor calibration, each confirmed first); the encrypted export and import of the key; forgetting the key; disconnecting. The factory motor calibration is not offered ([docs/safety.md](../docs/safety.md)).

A screen or control exists only for what the specification documents.

## Stack

- JavaScript, not TypeScript: ES modules with types written in JSDoc and checked by `tsc` (`checkJs`, `strict`), so that every file runs as written and is still type-checked.
- Ionic's web components (`@ionic/core`) used directly as custom elements, with no UI framework; pages and state are plain modules. Vite bundles the web build, and Capacitor wraps it for Android.
- npm, with a root `package.json` that holds the tools (TypeScript, oxlint, oxfmt, Jest, husky, commitlint, semantic-release and its plugins) and `app/` as an npm workspace that holds the app's own dependencies. Versions are exact (`.npmrc`); Node's version is the one `.nvmrc` names.
- Interface in English and Spanish, every text in translation files, so that other owners can add their languages.
- BLE through `@capacitor-community/bluetooth-le`, which uses Android's Bluetooth in the Android build and Web Bluetooth in the web build. Whether the bike's passkey pairing works through Web Bluetooth on each system: **Unknown**.
- Nothing native that the web build cannot do: a feature that needs a platform API checks for it and is hidden where it is missing.
- The owner key is typed or imported once per device and kept there; it is saved only after the bike accepts it. On Android, it is kept in the Android Keystore (AES-GCM) through `@aparajita/capacitor-secure-storage`. In the web build, it is kept in the origin's IndexedDB, encrypted with AES-GCM under a non-extractable Web Crypto key kept beside it. The browser's storage never holds the owner key as plain text, and the encryption key cannot be read out, though code running on the app's own origin could still use it. No passphrase is asked to connect.
- The encrypted export, for a backup or another device, is a JSON text with the format name `openambike-owner-key`, version 1, and the owner key encrypted with AES-GCM, with its salt and IV. The AES key is derived from a passphrase of at least 8 characters with PBKDF2-SHA-256 and 600 000 iterations.
- Package identifier: `org.openambike.app`. Display name: OpenAMBike.

## Structure

- `src/ble/protocol.js`: encoding and decoding of the bike's values, pure functions with no BLE or UI dependency, so that tests run on captured frames alone. Its tests use anonymised frames from captures, each naming the capture it comes from.
- `src/ble/bike.js`: scanning, connection, authentication, a queue that sends one request at a time, and subscription to notifications.
- `src/session.js`: a connected bike and everything known about it, read at the start and kept live by the bike's notifications. Screens read its state and call its commands; they never talk to the bike directly.
- `src/storage/key-store.js`: where the owner key is kept on this device, as "Stack" says.
- `src/storage/key-export.js`: the encrypted export and import, so that the key can be moved to a new phone or kept as a backup.
- `src/bug-report/`: the owner key read from an Android bug report, as `reverse-engineering/tools/owner_key.py` reads it: `zip.js` takes the snoop logs out of the `.zip` with the browser's own `DecompressionStream`, reading only the parts it needs; `owner-key.js` finds in them the key the bike answered `owner ok` to. Everything stays in memory on the device, and only the key is kept, once the bike accepts it. It is offered wherever `DecompressionStream` exists.
- `src/pages/`: one module per screen, built from the elements of `ui.js`.
- `src/i18n/`: the translation files, one per language, with the same keys.
- `src/test-support/`: a fake Bluetooth client that behaves like the bike, for the tests.
- `scripts/release.js`: what a release adds to semantic-release: the Android version, and the texts of the release page and of `CHANGELOG.md` beside the changes, as "Build and release" says.
- `android/`: the Android project Capacitor generates, with the app's permissions and backup rules.

## Design

The app aims to be attractive and easy, built from a few simple, reusable interface elements.

- Ionic's iOS look on every platform, so that the app looks the same on Android and in a browser. The app's own palette, defined once in `src/theme.css` for light and dark, follows the system's dark mode. Nothing of Ampler's look is used ([docs/safety.md](../docs/safety.md), "Name and trademark").
- What a rider uses most comes first and largest: battery, speed, assist mode, lights and lock are on the first tab, as large tiles one tap away.
- Each screen has at most one primary action. A change to the bike that is hard to undo (restart, sleep, calibration, forgetting the key) is confirmed first, with a sentence on what it does.
- Every value shows its unit, and a state is shown by text or an icon as well as by colour. Touch targets are at least 44 px. Texts are short and come from the translation files.
- The reusable elements live in `src/pages/ui.js` (card, section, gauge, stat, toggle tile, choice, value row, action row, dialogs and messages); screens compose them and add no styling of their own beyond layout.
- Screenshots taken to review the design are low-resolution: a phone-size viewport of 360 × 720 at 1× scale, saved as JPEG.

## Permissions

- **Android 12 and later:** `BLUETOOTH_SCAN` (with `neverForLocation`) and `BLUETOOTH_CONNECT`.
- **Earlier versions:** `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION`, limited to them with `maxSdkVersion` 30, and the legacy `BLUETOOTH` and `BLUETOOTH_ADMIN`. The declarations follow the Bluetooth plugin's README.
- **No `INTERNET` permission:** the app talks to no server. The link to the owner key guide opens in the system's browser, not in the app.
- **Android backup is off:** `allowBackup` is false, and the data extraction rules exclude everything. The stored key never reaches a cloud backup or another device except through the app's own encrypted export.

## Build and release

- The web build is served over HTTPS, since Web Bluetooth needs a secure context; `localhost` counts as one.
- Releases are made by [semantic-release](https://semantic-release.gitbook.io/) (`release.config.js`), which `.github/workflows/release.yml` runs after the checks when it is started by hand on `main` (the Actions tab, "Release", "Run workflow"). The Conventional Commits since the last release decide the version: `fix` makes a patch release, `feat` a minor one, a breaking change a major one, and other types none.
- A release writes its version to `android/app/version.properties` (`versionName` the version, `versionCode` major × 1 000 000 + minor × 1 000 + patch, from `scripts/release.js`), builds the signed APK, adds the release notes to the top of `CHANGELOG.md` at the root, commits both files as `chore(release): <version>`, tags the commit `v<version>`, and attaches `OpenAMBike-<version>.apk` to a [GitHub release](https://github.com/Rapsssito/openambike/releases). The release page lists the changes, then says that the app is unofficial ([docs/safety.md](../docs/safety.md), "Name and trademark") and how to install it; `CHANGELOG.md` says it once, under its title, above every release's changes.
- The APK is signed with the project's own key, which never enters the repository. The build reads it from `OPENAMBIKE_KEYSTORE` (the keystore's path), `OPENAMBIKE_KEYSTORE_PASSWORD`, `OPENAMBIKE_SIGNING_ALIAS` and `OPENAMBIKE_KEY_PASSWORD`; without them, `./gradlew assembleRelease` builds an unsigned APK. The workflow takes them from the repository's secrets `ANDROID_KEYSTORE_BASE64` (the keystore in base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, and refuses to release without them. No variable that holds something public, such as the alias, has `key`, `token`, `password` or `secret` in its name: semantic-release hides the values of those variables in everything it writes, the release notes included. Every release is signed with the same key, so that each installs over the last: losing the key means that owners have to uninstall the app, and with it the stored owner key, to install a new one.
- The Android build has nothing F-Droid refuses: no Google services, and no dependency metadata in the APK (`dependenciesInfo`).

## Libraries and licences

Before a library is added to the app, its licence is read at its source and must be compatible with the app's licence, AGPL-3.0. A library that phones home, shows ads or tracks usage is not used.
