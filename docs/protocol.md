# Ampler e-bike BLE protocol

The specification of how a phone talks to an Ampler e-bike over Bluetooth Low Energy. The app and the tools implement it, and if they disagree with it, this file wins.

## How this file is edited

- Every statement names its evidence, as `reverse-engineering/README.md`, "Evidence", says. A statement backed only by code says "not yet confirmed by a capture".
- What is not known is written as **Unknown**, in the section where it belongs; it is never guessed. A question that needs a decision goes to `docs/roadmap.md`, "Open questions".
- Bytes are written in hexadecimal, separated by spaces (`0a 1f 00`). Multi-byte values say their byte order.
- A capture is named by its folder in `reverse-engineering/private/captures/`, and means the `btsnoop_hci.log` in it.
- Quoted bytes are anonymised as `docs/safety.md`, "Private data", says.
- The code of the official app is named, never reproduced.
- Differences between generations or firmware versions are written next to the statement they change, and gathered in "Differences by generation".

## Scope

This specification is written from:

- A Stellar of 2022, with bike firmware 3.9.0 and battery firmware 143, the latest versions for it; G2 by the official app's rule (see "Differences by generation").
- The official Android app `com.amplerbikes.mobile`, version 3.0.9 (version code 662), a Flutter app built with Dart 3.10.8. Its compiled Dart code, `libapp.so`, holds the BLE logic; the Java code holds the Flutter plugins.
- The official Android app version 3.1.7 (version code 672), the one on the owner's phone, built with Dart 3.12.0. It no longer shows the battery's voltage and the other diagnostics values, yet decodes them as 3.0.9 does: `BikeDiagnosticsService` and `DiagnosticsMetricsPage` are unchanged in their byte offsets and scale factors, and the route `diagnostics_metrics` still opens the page, but `AdvancedBikeOptionsPage`, which in 3.0.9 holds the entry "Diagnostics metrics" leading to it, no longer holds it, so no screen leads to the page (code: `MoreScreen` and `AdvancedBikeOptionsPage` of both versions). Its 64-bit ARM build comes from the owner's phone; its 32-bit build is also in an XAPK, with the same base APK.

Other models, generations and firmware versions: **Unknown**.

## Advertising

The Stellar of 2022 advertises with legacy connectable, scannable, undirected advertising from a random address, which stays the same from one connection to the next (test on the bike: the owner's phone, by the owner), and gives its name, `AMPLER3`, only in the scan response, so a scanner sees the name only when scanning actively (capture: `official-317`, extended advertising reports at 14:49:38 CET; test on the bike: an active scan from a computer, which also received manufacturer data with company identifier `0x0a00` and 11 bytes). It advertises only while no device is connected (test on the bike: no advertising while the owner's phone was connected). It goes on advertising while switched off, whether with its button or by itself, and stops only once sent to sleep (see "Sleep" in "Commands sent to the bike"), until the charger wakes it (test on the bike: the app's signal test, by the owner). Heard by the owner's Android phone in its fast scan mode, it gives about 8 advertisements a second, and these signal strengths, each the average of 5 seconds: −59 dBm with the phone in hand next to the bike, −66 dBm with the phone in a pocket about 1 m away, −74 dBm at 2 m, −80 dBm behind a closed door or a wall, and −94 dBm at 20 m (test on the bike: the app's signal test, [app/DEVELOPMENT.md](../app/DEVELOPMENT.md), "Connect"). They depend on the phone; with other phones: **Unknown**. A bonded computer also received the advertised service UUIDs: `1800`, `1801`, the SMP service `8d53dc1d-…`, and `…81a0`, `…81a1`, `…81c0` and `…81d0` (test on the bike: `reverse-engineering/tools/scan.py`). What the manufacturer data holds, and whether other bikes advertise the same name: **Unknown**. The official app 3.0.9 finds its bike by an identifier, not by this name (code: `BluetoothScanner`); what that identifier is: **Unknown**.

## GATT map

The services and characteristics of the Stellar of 2022 with firmware 3.9.0, as its discovery in the capture lists them, with the names the official app gives them. Apart from the SMP service, every UUID has the form `fa5b81xx-9b7b-452e-9a46-0a3313cbab03`, written `…81xx` in this file. Handles are given as found on this bike; a client finds them by discovery, never by number. The bike also has the standard GAP (`0x1800`) and GATT (`0x1801`) services. Whether other bikes and firmware versions have the same map: **Unknown**.

Every row is backed by the discovery in capture `official-317`, and every value given as "Read:" by a test on the bike: a read with `reverse-engineering/tools/cli.py`'s connection after authentication.

The characteristics marked "not named by the official app" appear nowhere in the code of 3.0.9 or 3.1.7, as UUIDs or as fragments of them, except `…81d8`: `BluetoothCharacteristicsDiscoverer._discoverG2Characteristics` looks it up next to auth and keeps it, and no read, write or subscription to it was found. The capture holds no traffic on any of them (capture: `official-317`; code: both versions searched). What they are can only be learnt from the bike.

| Service | Characteristic | Properties; handle on this bike | Purpose | Evidence besides discovery |
| --- | --- | --- | --- | --- |
| `…81a0` |  |  | Service the app names "auth" | Code: `BluetoothConstants.authServiceUUID` |
| `…81a0` | `…81a0` | read, write, notify, indicate; `0x0012` | Auth | Code: `BluetoothConstants.authServiceUUID` |
| `…81a0` | `…81d8` | read, notify, indicate; `0x0015` | Not named by the official app. Read: 1 byte, `01`. Meaning: **Unknown** |  |
| `…81a1` |  |  | Service the app names "bike" | Code: `BluetoothConstants.bikeServiceUUID` |
| `…81a1` | `…81a2` | read, write, notify, indicate; `0x0019` | GNSS enabled | Code: `BluetoothConstants.gnssEnabledUUID` |
| `…81a1` | `…81a3` | read, write, notify, indicate; `0x001c` | Assist mode | Code: `BluetoothConstants.assistModeUUID` |
| `…81a1` | `…81a4` | read, write, notify, indicate; `0x001f` | Assist levels | Code: `BluetoothConstants.assistLevelsUUID` |
| `…81a1` | `…81b7` | read, write, notify, indicate; `0x0022` | Not named by the official app. Read: 4 bytes, `00 00 00 00`. Meaning: **Unknown**. It sits right after assist levels, and the IoT state's four speed pedelec fields (spede_max_speed, spede_max_power, spede_gain, spedelec_mode) also read 0; it may be the speed pedelec settings, so it is never written (`docs/safety.md`) |  |
| `…81a1` | `…81a5` | read, write, notify, indicate; `0x0025` | Lights control | Code: `BluetoothConstants.lightsControlUUID` |
| `…81a1` | `…81a6` | read, notify, indicate; `0x0028` | Battery: voltage, current, charge (see "Data read from the bike") | Code: `BluetoothConstants.batteryUUID` |
| `…81a1` | `…81a7` | read; `0x002b` | Firmware version | Code: `BluetoothConstants.firmwareVersionUUID` |
| `…81a1` | `…81a8` | read, write, notify, indicate; `0x002d` | Lock control | Code: `BluetoothConstants.lockControlUUID` |
| `…81a1` | `…81a9` | read, notify, indicate; `0x0030` | Not named by the official app. Read: 12 bytes, all `00` with the bike standing. Meaning: **Unknown** |  |
| `…81a1` | `…81aa` | read; `0x0033` | Not named by the official app. Read: 8 bytes; bytes 0–3, unsigned 32-bit, equal boot_counter of the IoT state (158 at both); bytes 4–7 read 4, which key_version of the IoT state also reads. That they are those fields is not yet confirmed by a change |  |
| `…81a1` | `…81ab` | read; `0x0035` | Errors; named by 3.0.9 only | Code: `BluetoothConstants.errorsUUID` of 3.0.9 |
| `…81a1` | `…81ac` | read, notify, indicate; `0x0037` | Battery extended: pack temperatures (see "Data read from the bike") | Code: `BluetoothConstants.batteryExtendedUUID` |
| `…81a1` | `…81ad` | read, write, notify, indicate; `0x003a` | GSM enabled | Code: `BluetoothConstants.gsmEnabledUUID` |
| `…81a1` | `…81ae` | read, write, notify, indicate; `0x003d` | Not named by the official app. Read: 1 byte, `00`. Meaning: **Unknown**; candidates are the IoT state's settings that read false or 0 (lights_automatic_enabled, screen_setting, speedometer) |  |
| `…81a1` | `…81af` | read, notify, indicate; `0x0040` | ASI faults; named by 3.1.7 only | Code: `BluetoothConstants.asiFaultsUUID` of 3.1.7 |
| `…81a1` | `…81b0` | read, notify, indicate; `0x0043` | ASI metrics: odometer, speed, power (see "Data read from the bike") | Code: `BluetoothConstants.asiMetricsUUID` |
| `…81a1` | `…81b2` | write; `0x0046` | Reset | Code: `BluetoothConstants.resetUUID` |
| `…81a1` | `…81b1` | read, notify, indicate; `0x0048` | Range | Code: `BluetoothConstants.rangeUUID` |
| `…81a1` | `…81b3` | read; `0x004b` | Not named by the official app. Read: 8 bytes, the same as the first 8 bytes of the manufacturer data in the advertising; an identifier of the bike, so private, quoted only anonymised. Meaning: **Unknown** |  |
| `…81a1` | `…81b4` | read, notify, indicate; `0x004d` | Not named by the official app. Read: 2 bytes, `00 00`. Meaning: **Unknown** |  |
| `…81a1` | `…81b5` | write, notify, indicate; `0x0050` | Recaps | Code: `BluetoothConstants.recapsUUID` |
| `…81a1` | `…81b6` | write; `0x0053` | Time synchronisation; named by 3.1.7 only | Code: `BluetoothConstants.timeSyncUUID` of 3.1.7 |
| `…81c0` |  |  | Service the app names "owner" | Code: `BluetoothConstants.ownerServiceUUID` |
| `…81c0` | `…81c2` | read, write; `0x0056` | Not named by the official app. Read: 0 bytes. Meaning: **Unknown** |  |
| `…81c0` | `…81c3` | write; `0x0058` | Factory reset | Code: `BluetoothConstants.factoryResetUUID` |
| `…81c0` | `…81c4` | read, write, notify, indicate; `0x005a` | State management | Code: `BluetoothConstants.stateManagementUUID` |
| `…81c0` | `…81c5` | read; `0x005d` | Not named by the official app. Read: 8 bytes, all `00`. Meaning: **Unknown** |  |
| `…81c0` | `…81c6` | read, notify, indicate; `0x005f` | Not named by the official app. Read: ASCII `0 UNK NO OPERATOR`, with GSM off; probably the mobile network's state (no operator). Meaning: **Unknown** |  |
| `…81c0` | `…81d2` | write; `0x0062` | Motor calibration | Code: `BluetoothConstants.motorCalibrationUUID` |
| `…81c0` | `…81c7` | write, notify, indicate; `0x0064` | IoT state | Code: `BluetoothConstants.iotStateUUID` |
| `…81c0` | `…81c8` | read, notify, indicate; `0x0067` | Battery management system firmware status | Code: `BluetoothConstants.bmsFwStatusUUID` |
| `…81c0` | `…81c9` | read, write, notify, indicate; `0x0069` | Battery management system firmware update progress; read-only knowledge (`docs/safety.md`) | Code: `BluetoothConstants.bmsOtaProgressUUID` |
| `…81c0` | `…81ca` | read, notify, indicate; `0x006c` | Not named by the official app. Read: 0 bytes. Meaning: **Unknown** |  |
| `…81c0` | `…81cb` | read, write, notify, indicate; `0x006e` | Not named by the official app. Read: ASCII `Not started`. What it reports: **Unknown** |  |
| `…81c0` | `…81cc` | read, notify, indicate; `0x0071` | Not named by the official app. Read: ASCII `1.325`, which is asi_bl_version (the motor controller's bootloader) of the IoT state |  |
| `…81c0` | `…81cd` | read, notify, indicate; `0x0073` | Not named by the official app. Read: ASCII `6.026`, which is asi_version (the motor controller's firmware) of the IoT state |  |
| `…81c0` | `…81ce` | read, notify, indicate; `0x0075` | Not named by the official app. Read: ASCII `1`, which asi_param_version of the IoT state also reads; not yet confirmed by a change |  |
| `…81c0` | `…81cf` | read, notify, indicate; `0x0077` | Not named by the official app. Read: ASCII `0`. Meaning: **Unknown** |  |
| `…81d0` |  |  | Service; purpose **Unknown** |  |
| `…81d0` | `…81d3` | read; `0x007a` | Not named by the official app. Read: the bike answers with an error (Unlikely Error) and drops the connection. Meaning: **Unknown** |  |
| `…81d0` | `…81d4` | read, write, notify, indicate; `0x007c` | Not named by the official app. Read: refused (Read Not Permitted). Meaning: **Unknown** |  |
| `…81d0` | `…81d5` | write; `0x007f` | **Unknown**; not named by the official app |  |
| `…81d0` | `…81d6` | write, notify, indicate; `0x0081` | **Unknown**; not named by the official app |  |
| `…81d0` | `…81d7` | write, notify, indicate; `0x0084` | **Unknown**; not named by the official app |  |
| `8d53dc1d-1db7-4cd3-868b-8a527460aa84` |  |  | Firmware management service of the SMP protocol (mcumgr), which the official app uses for firmware updates through `mcumgr_flutter`; never used (`docs/safety.md`) |  |
| `8d53dc1d-1db7-4cd3-868b-8a527460aa84` | `da2e7828-fbce-4e01-ae9e-261174997c48` | write-no-rsp, notify; `0x0088` | SMP requests and responses; never used |  |

## Connection and authentication

The link: on each connection the phone, already bonded with the bike, starts LE encryption with its stored key; the capture holds no Security Manager pairing (capture: `official-317`, four LE Enable Encryption commands and no SMP packets). The bond is made once, when the bike is set up: the owner remembers the bike showing a pairing code on its display, which is Bluetooth passkey pairing. Removing that bond is done in the phone's Bluetooth settings, and is needed after a factory reset before pairing again (code: the confirmation texts of `MainPage` and `SystemMaintenancePage`, not yet confirmed by a capture). A computer that is not bonded with the bike can connect, but the bike disconnects during service discovery, before any read. After bonding, the same computer connects and discovers every service (test on the bike: `reverse-engineering/tools/scan.py` from the container before and after `reverse-engineering/tools/pair.py`). Bonding is passkey entry: the bike shows a 6-digit code on its display and the other device types it (test on the bike: `reverse-engineering/tools/pair.py`, with the owner reading the code). The bike keeps both bonds: after the computer bonded, the owner's phone still connected with the official app (test on the bike). How many bonds it keeps: **Unknown**.

Authentication, on a G2 bike:

1. The phone enables notifications on `…81a0` auth (0x0012).
2. The phone writes the owner key to `…81a0`: 28 bytes of printable ASCII text, anonymised here as `00 00 … 00` (28 bytes).
3. The bike notifies the ASCII text `owner ok` (`6f 77 6e 65 72 20 6f 6b`). Any other answer, or none, is a failure for the app.

Evidence: capture `official-317`, 14:49:41, 14:51:38 and 14:52:16 CET: the three writes are the same 28 bytes, each answered by `owner ok`. Code: `BluetoothAuthenticator._authenticateG2` and `_performG2InitialPairing`. Test on the bike: `reverse-engineering/tools/cli.py status` from a bonded computer, with no official app connected and no server involved, wrote the owner key from `reverse-engineering/private/keys/`, received `owner ok`, then read every value of "Data read from the bike" with the decoding given there (owner's approval).

The owner key:

- It is the user identifier (UID) of the owner's Firebase account, a 28-character text. The first time the official app connects to a bike, with no key cached, it writes the signed-in user's UID as UTF-8 (`_performG2InitialPairing`, after `FirebaseAuth.currentUser`); on success it caches it (`CacheService.setAuthData`) and writes the cached value on every later connection (`_authenticateG2`, `CacheService.getAuthData`). If the cached key is refused or not answered, the app falls back to writing the UID again.
- The bike reports the same 28 bytes as "owner_key" in the IoT state (capture: `official-317`, all three IoT states).
- It is the whole of the access: the official app's bike sharing hands the same key to another person by QR code, and its own text warns that the bike cannot tell the two apart (code: `ShareBikeDialog`).
- How a bike with no owner learns its key, whether it accepts any key while it has none, and whether a factory reset (`…81c3`) clears it: **Unknown**.

The key is private data (`docs/safety.md`): it is kept only in `reverse-engineering/private/` and in the app's key storage, and quoted only anonymised.

On a G1 bike, the app uses `_authenticateG1` and `_performG1InitialPairing`; their frames: **Unknown**.

## Dependence on Ampler's servers

Authenticating with the bike needs only the owner key, a fixed 28-character text that the phone sends as is: no challenge, no server call, nothing that changes between connections (capture: the same bytes on all three connections; code: `_authenticateG2` reads the key from the app's cache). Ampler's servers, through the Firebase account, supply the key only once, when the bike is first paired; once the key is known, connecting, locking, unlocking and every command in "Commands sent to the bike" work without them. The key of the owner's bike is known: it is in the capture and in the IoT state, kept in `reverse-engineering/private/`.

Whether the server also sends the key to the bike (over GSM) at setup, and what else the app sends to the server (the IoT state, trips, state reports): **Unknown**.

## Frame format

Each command and value has its own characteristic: the phone writes the value alone, with no common header, length, identifier or checksum, and the bike notifies or returns the value the same way. Some commands are ASCII text (capture: `official-317`). Nothing is encrypted at the application level, auth included; the link itself is encrypted by Bluetooth bonding (see "Connection and authentication").

## Commands sent to the bike

| Command | Characteristic | Bytes | Effect | Evidence |
| --- | --- | --- | --- | --- |
| Assist mode | `…81a3` assist mode (0x001c) | 1 byte: the mode number, `00` for no assist, `01` and `02` for the owner's two modes | The bike switches mode and notifies 4 bytes, the mode in byte 0 and `00 00 00` after it; it returns the same 4 bytes when read. The meaning of bytes 1–3: **Unknown** | Capture: `official-317`, 14:49:42–14:49:45 CET, with the owner's notes of each action: `02`, `00`, `01`; test on the bike: `reverse-engineering/tools/cli.py assist 2`, then `assist 1`, each read back as set (owner's approval) |
| Lights | `…81a5` lights control (0x0025) | 2 bytes: `01 01` turns the lights on, `01 00` off | The bike notifies 2 bytes, `0a 01` on and `0a 00` off, 0.3 to 0.7 s after the write; a read within that time still returns the old state (capture: `official-317`, 14:49:47, a read 0.18 s after `01 01` returned `0a 00`; test on the bike: `reverse-engineering/tools/cli.py lights off` and `on`, a read right after each returned the old state and a read seconds later the new one). The meaning of byte 0 of the write (`01`) and of the reply (`0a`, which equals "lights_intensity" in the IoT state): **Unknown**. While the battery charges, the lights cannot be changed: the owner saw the command leave the lights as they were with the charger attached (test on the bike: owner's observation). What the bike answers to the write then: **Unknown** | Capture: `official-317`, 14:49:46–14:49:47 CET, with the owner's notes of each action; code: `BikeControlService.sendLightsCommand`, which always writes `01` as byte 0 on a G2 bike. Probe on the bike: `02 01` was accepted, the bike answered `0a 01` as for `01 01`, and the owner saw no change in the lights, twice; then `01 01` was restored (owner's approval) |
| Lock | `…81a8` lock control (0x002d) | 1 byte: `01` locks, `00` unlocks | The bike notifies the same byte. Locked, the bike neither turns on nor assists from its physical button, and its display shows a lock symbol when the button is pressed. Locked while switched on, riding included, it only stops assisting: it can still be pedalled, and nothing else changes | Capture: `official-317`, 14:49:49–14:49:50 CET, with the owner's notes of each action; test on the bike: `reverse-engineering/tools/cli.py lock`, the owner saw the lock symbol on pressing the button, then `unlock`, each read back as set (owner's approval); test on the bike: locked from the app while switched on, standing and while riding, by the owner |
| GNSS | `…81a2` GNSS enabled (0x0019) | 1 byte: `01` on, `00` off | The bike notifies the same byte. Whether the GNSS still serves anything without Ampler's servers: **Unknown** | Capture: `official-317`, 14:50:51–14:50:52 CET, with the owner's notes of each action |
| GSM | `…81ad` GSM enabled (0x003a) | 1 byte: `01` on, `00` off | The bike notifies the same byte. Whether the GSM still serves anything without Ampler's servers: **Unknown** | Capture: `official-317`, 14:50:52–14:50:53 CET, with the owner's notes of each action |
| Restart firmware | `…81b2` reset (0x0046) | ASCII `reset` (`72 65 73 65 74`) | The bike restarts within 4 seconds and keeps its settings: the app rediscovers the services, authenticates again and reads lights, lock, assist mode, GNSS and GSM unchanged | Capture: `official-317`, 14:51:32 CET, with the owner's notes of each action; the official app labels it "Restart firmware"; test on the bike: `reverse-engineering/tools/cli.py restart`, after which the bike reconnected and authenticated within 10 s with every setting unchanged (owner's approval) |
| Sleep | `…81c4` state management (0x005a) | ASCII `shutdown` (`73 68 75 74 64 6f 77 6e`) | The bike turns off all its electronics, GSM and GNSS included, and only attaching the charger turns it on again; plugged in for a few seconds, the charger woke it | Capture: `official-317`, 14:51:45, woken at 14:52:16 CET, with the owner's notes of each action; the official app labels it "Set Bike to Sleep" |
| Assist levels | `…81a4` assist levels (0x001f) | 6 bytes: assist speed, power and gain of the first mode (normal), then the same of the second mode (boost). Speed byte = (km/h − 10) × 17, so `00` is 10 km/h and `ff` 25 km/h. Power byte and gain byte = (percent − 40) × 255 / 60, so `00` is 40 % and `ff` 100 %. The app rounds and keeps each byte between `00` and `ff`, and its "assist amount" sets power and gain to the same percent (they differ by 1 through rounding: `2b 2a` is 50 %). Read, the characteristic returns 8 bytes: these 6, then `00 00`, which the app does not write; their meaning: **Unknown** | The bike stores the values and returns them when read. In the capture: `ff 2b 2a ff 95 95` (both 25 km/h; 50 % and 75 %) changed to `77 80 7f ff 95 95` (17 km/h and 70 % on the first mode), `ff ff ff ff 95 95` (25 km/h and 100 %), back to the start, then `ff 2b 2a ff 80 7f` (70 % on the second mode). The same values appear as normal_max_speed, normal_max_power, normal_gain, boost_max_speed, boost_max_power and boost_gain in the IoT state | Code: `AssistLevels._speedToByte`, `_percentToPowerByte`, `_percentToGainByte`, `toByteArray` and their inverses (3.1.7). Capture: `official-317`, 14:50:10–14:50:35 CET, with the owner's notes of each action; test on the bike: `reverse-engineering/tools/cli.py levels 2 25 60` wrote `ff 2b 2a ff 55 55` and `levels 2 25 70` wrote `ff 2b 2a ff 80 7f`, each read back as written (owner's approval) |
| Torque sensor calibration | `…81d2` motor calibration (0x0062) | 1 byte: `00` on a G2 bike | Recalibrates the torque sensor's signal; the official app labels it "Calibrate Sensor" and presents it as improving the bike's responsiveness, with no warning about the wheel. In the capture, nothing but the periodic data followed for 20 s. How the bike reports the result: **Unknown** | Capture: `official-317`, 14:51:11 CET, with the owner's notes of each action; code: `BikeControlService.calibrateSensor`, which writes `00` on a G2 bike (`03` to `340d1548-a89e-4d4e-9078-06d21096ea36` on a G1 bike), and the texts of `SystemMaintenancePage` |
| Motor calibration | `…81d2` motor calibration (0x0062) | 1 byte: `01` on a G2 bike | Factory motor calibration, during which the motor spins the rear wheel; the official app presents it as being for service technicians, warns that the wheel will spin, and shows it only when Ampler's server marks the bike with "isFactoryCalibrationEnabled". How long it lasts, what it changes in the motor's parameters and how the bike reports the result: **Unknown**. The project never sends it (`docs/safety.md`) | Code: `BikeControlService.calibrateMotor`, which writes `01` on a G2 bike (`04` to `340d1548-…` on a G1 bike), the texts of `SystemMaintenancePage` and `SystemMaintenanceProvider`; not yet confirmed by a capture |
| IoT state request | `…81c7` IoT state (0x0064) | 1 byte: `00` | The bike sends its state as JSON text (see "Data read from the bike") | Capture: `official-317`, sent by the app on each connection |
| Time synchronisation | `…81b6` time synchronisation (0x0053) | 8 bytes | Sent by the app right after auth on each connection; bytes 0–1 change between connections and bytes 2–7 stayed `fe 6a 00 00 80 04`. The format: **Unknown** | Capture: `official-317` |
| Recaps | `…81b5` recaps (0x0050) | 1 byte: `00` | Sent by the app on each connection after enabling its notifications; what it does: **Unknown** | Capture: `official-317` |

## Data read from the bike

Reads and notifications: battery, speed, assist level, lights, lock state, odometer, errors, firmware and serial number.

How the official app, in 3.0.9 and 3.1.7 alike, decodes these values on a G2 bike (see "Differences by generation"), and what the capture of the Stellar of 2022 shows. Multi-byte values are little-endian. Offsets count from 0. A notification shorter than the minimum length given is ignored by the app.

The captures quoted below were made with the official app 3.1.7 connected: `official-317` with the bike standing, and `ride-charge` during the last minute of a ride and the first minutes on the charger; the decoded values are the bike's at those moments.

| Data | Characteristic | Read or notify | Format | Evidence |
| --- | --- | --- | --- | --- |
| Battery voltage | `…81a6` battery | Notify, about once a second; 11 bytes on this bike, at least 8 for the app | Bytes 0–3, unsigned 32-bit, in millivolts | Code: `BikeDiagnosticsService._setupG2Notifications`, the listener on battery. Capture: `official-317`: `fa c7 00 00 3a 00 4a 64 77 03 00` gives 51.194 V |
| Battery current | `…81a6` battery | As above | Bytes 4–5, signed 16-bit, in milliamperes; positive while the battery discharges, negative while it charges. Standing, 0 to +66 mA; riding, up to +915 mA; on the charger, −2 891 to −2 899 mA, with the voltage rising from 50.98 V to 52.69 V | Code: as above. Capture: `official-317`: `3a 00` gives +58 mA standing. Capture: `ride-charge`, 18:00:10 CET riding (+915 mA) and from 18:01:38 CET on the charger (−2 891 mA) |
| Battery charge | `…81a6` battery | As above | Byte 6, unsigned, in percent | Code: as above. Capture: `official-317`: `4a` in the frame above gives 74 % |
| Absolute state of charge | `…81a6` battery | As above | Bytes 7–10, unsigned 32-bit, track "absolute_soc" of the IoT state (227 172 and 227 168 at the same moment; 227 355 and 227 353 after the bike woke from sleep). They fall while the battery discharges and rise while it charges: on the charger they rose by 3 072 in 70 s at 2.9 A and about 52.5 V, about 2.96 Wh, which is consistent with a unit of one milliwatt-hour, and the owner confirms that unit: the energy left in the battery, in milliwatt-hours. 227 172 at a charge of 74 % gives about 307 Wh when full, against the 336 Wh the battery is rated for (see "Battery capacity by model"). The official app does not use these bytes | Capture: `official-317`. Capture: `ride-charge`, 18:01:46 to 18:02:56 CET. Test on the bike: `reverse-engineering/tools/cli.py status` |
| Battery pack temperatures | `…81ac` battery extended | Read every 10 seconds by the app while connected; 12 bytes on this bike, at least 6 for the app | Bytes 2–3 and 4–5, signed 16-bit, in tenths of a degree Celsius, one per battery pack; the app shows their mean | Code: `BikeDiagnosticsService._updateTemperatureFromBytes`. Capture: `official-317`: `51 00 e1 00 e9 00 ff ff 00 00 8f 00` gives 22.5 °C and 23.3 °C |
| Battery cycles | `…81ac` battery extended | As above | Bytes 0–1, unsigned 16-bit: the battery's charge cycles, which the official app labels "Cycles". The capture reads 81 (`51 00`); not yet confirmed against the count the official app shows | Code: `BikeControlService.readBatteryExtendedInfo` of 3.0.9 and 3.1.7, which builds this value from bytes 0–1 and returns it as the cycles, and the label in `BatteryInfoCard`. Capture: `official-317` |
| Rest of battery extended | `…81ac` battery extended | As above | Bytes 6–7 read `ff ff` and bytes 8–9 `00 00`. Bytes 10–11, unsigned 16-bit, read 143 (`8f 00`), which is the battery firmware version the official app shows for this bike; the official app reads them as that version, which is not yet confirmed by a bike with another one. The meaning of the other bytes: **Unknown** | Capture: `official-317`. Code: `BikeControlService.readBatteryExtendedInfo` of 3.0.9 and 3.1.7, which builds the battery firmware version from bytes 10–11 |
| Odometer | `…81b0` ASI metrics | Notify, and read by the app; 12 bytes | Bytes 0–3, unsigned 32-bit, in hundredths of a kilometre | Code: `BikeDiagnosticsService._setupG2Notifications`, the listener on ASI metrics. Capture: `official-317`: `4f c2 05 00 00 00 00 00 00 00 00 00` gives 3774.23 km; test on the bike: `reverse-engineering/tools/cli.py live` received no ASI metrics notification in 20 s with the bike standing, while battery notified 18 times |
| Speed | `…81b0` ASI metrics | As above | Bytes 6–7, unsigned 16-bit, in tenths of a km/h | Code: as above. Capture: `ride-charge`, riding from 18:00:01 CET: 0 to 14.5 km/h while the odometer rose from 3774.25 to 3774.38 km |
| Motor power | `…81b0` ASI metrics | As above | Bytes 4–5, unsigned 16-bit, in watts; the official app shows it as "Motor Power" | Code: `BikeDiagnosticsService._setupG2Notifications` and `_emitAllMetrics`. Capture: `ride-charge`, riding: 0 to 46 W, non-zero while the motor assisted; at 18:00:18 CET it read 41 W while the battery gave 0.915 A at 50.6 V (46 W) |
| Rider power | `…81b0` ASI metrics | As above | Bytes 8–9 times bytes 10–11, both unsigned 16-bit, divided by 9.5488, in watts; the official app shows it as "User Power". 9.5488 is the factor between torque in N·m times rotational speed in rpm and power in W, so the two values are probably the rider's torque and cadence; which is which, and their units: **Unknown**. Riding, they read up to 55 and 27 (about 150 W); one frame read 991 in bytes 8–9 with 0 in bytes 10–11 | Code: as above. Capture: `ride-charge`, riding |
| Range | `…81b1` range | Notify and read; 1 byte | Unsigned, in kilometres; the capture shows 0, 35, 48, 56 and 64, changing as the official app was used; the IoT state's "range" read 64 at each connection, and later both read 63 (test on the bike: `reverse-engineering/tools/cli.py status` and `iot`), so the two carry the same value. The official app reads all the bytes as one unsigned little-endian integer, with no scale, and takes it as kilometres: it logs it with "km" and shows the range as "~" and the value in km; not yet confirmed by a capture against the official app's screen | Capture: `official-317`. Code: `BluetoothNotificationsHandler._setupRangeNotifications`, which reads range, decodes it with `BikeDataParsers.parseG2Range` and keeps it as the bike's range, and `BatteryIndicatorWidget`, which shows it in km (3.1.7) |
| Firmware version | `…81a7` firmware version (0x002b) | Read | ASCII, ended by `00`: the version, then two commit identifiers, separated by spaces (`v3.9.0 1e774d1c f551786850`) | Capture: `official-317` |
| Battery firmware status | `…81c8` battery management system firmware status (0x0067) | Read | ASCII; read `Up to date` | Capture: `official-317` |
| IoT state | `…81c7` IoT state (0x0064) | Notify, after the request `00` (see "Commands sent to the bike") | JSON text split over notifications of up to 50 bytes, followed by a notification `EOM`. Objects and fields: "version" (fw_version, fw_commit, zephyr_commit, modem_fw_version, asi_version, asi_param_version, asi_bl_version, gnss_version, key_version, command_version, odometer_version); "settings" (assist_mode, normal_max_speed, normal_max_power, normal_gain, boost_max_speed, boost_max_power, boost_gain, spede_max_speed, spede_max_power, spede_gain, lock, lights_intensity, lights_mode, lights_automatic_enabled, screen_setting, gnss_enabled, gsm_enabled, version, spedelec_mode, speedometer, c3x_soc, c3x_power, c3x_vbus); "battery" (charge, relative_soc_smoothed, relative_soc_raw, absolute_soc, charge_estimate, charging, hw_version, sw_version, range, serial_number); "dynamic_data" (boot_counter, odometer in hundredths of a kilometre, automatic_shutdown_counter, manual_shutdown_counter); "gnss_last_fix" (latitude, longitude); "bike_data" (bike_state, access, assist_allowed, owner_key); "timezone" (timezone_offset, valid). It holds the serial number, the last position and the owner key: never quoted unanonymised. The meaning of the fields beyond their names and the values above: **Unknown** | Capture: `official-317`, three times |

## Battery capacity by model

The battery's rated capacity, which the bike does not report: the app compares the energy the battery holds when full, from the absolute state of charge, with it. The bike's model is not known over Bluetooth either: the official app asks Ampler's server for it, with the model, year, generation and colour (code: `BikeInfoService`, the query `bikeInfoV2`), so the app measures against the 336 Wh that every model below is rated for, which the rider can change.

| Model | Years | Rated capacity | Evidence |
| --- | --- | --- | --- |
| Stellar | 2022 | 336 Wh, 48 V | The owner of the Stellar of 2022 this specification is written from; Ampler's support page "[What is the battery range, capacity & life cycle?](https://support.amplerbikes.com/en/support/solutions/articles/43000546162)" |
| Axel, Juna | From 2022 | 336 Wh, 48 V | Launch coverage of both models ([road.cc](https://road.cc/content/news/ampler-releases-two-lightweight-urban-e-bikes-290913)); Ampler's support page, as above |
| Curt, Curt Anyroad, Hawk, Stellar, Axel TD | Other years | 336 Wh, 48 V | Ampler's support page, as above, which gives 336 Wh for Ampler's e-bikes without naming a model; not confirmed for each model |

Other models, and whether any battery differs: **Unknown**.

## Read-only values

Values the protocol exposes but the project never writes (`docs/safety.md`): firmware updates, and the speed pedelec settings (spede_max_speed, spede_max_power, spede_gain and spedelec_mode in the IoT state; where they are written: **Unknown**). The assist speed and power of the two modes are written only within the bike's own maxima (see "Assist levels" in "Commands sent to the bike").

| Value            | Characteristic                                                 | Format     | Evidence |
| ---------------- | -------------------------------------------------------------- | ---------- | -------- |
| Firmware updates | SMP service `8d53dc1d-1db7-4cd3-868b-8a527460aa84` and `…81c9` | Never used |          |

## Differences by generation

The official app 3.0.9 treats a bike as G1 when it finds the service `340d1528-a89e-4d4e-9078-06d21096ea36`, and as G2 otherwise (code: `BikeCharacteristicsManager.isG1Bike`; not yet confirmed by a capture). It reads battery and diagnostics data differently on each; "Data read from the bike" describes G2. How it reads them on a G1 bike: **Unknown**. The Stellar of 2022 has no such service, so the app treats it as G2 (capture: `official-317`, discovery).
