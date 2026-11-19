# Reverse engineering

How the bike's BLE protocol was found, and how to find more of it: analysing the official Android app, capturing its traffic with the bike, and testing on a bike from a computer. Everything here concerns the official app for Android; its iOS version is not analysed, and capturing on an iPhone has not been tried. What is found is written into [docs/protocol.md](../docs/protocol.md); the limits of all of it are in [docs/safety.md](../docs/safety.md).

## Contents

- [What is here](#what-is-here)
- [Requirements](#requirements)
- [Tools](#tools)
- [The official Android app](#the-official-android-app)
- [Recognising the framework](#recognising-the-framework)
- [Static analysis](#static-analysis)
- [Captures with the official app](#captures-with-the-official-app)
- [Dynamic analysis](#dynamic-analysis)
- [Evidence](#evidence)

## What is here

| Path | What it holds | In git |
| --- | --- | --- |
| `README.md` | This file: the method | Yes |
| `requirements.txt` | The Python packages, with their versions | Yes |
| `tools/` | Python scripts that read captures and talk to a bike from a computer | Yes |
| `apk/` | The official Android app, as an APK or an XAPK, which you supply | No |
| `decompiled/` | What the decompilers write from them | No |
| `private/` | Captures (`private/captures/<name>/`), the owner key (`private/keys/owner-key.txt`), notes and screenshots: private data ([docs/safety.md](../docs/safety.md), "Private data") | No |

Git ignores `apk/`, `decompiled/` and `private/`: the official app is Ampler's, and the captures hold keys, serial numbers and addresses. The commands below run from this folder.

## Requirements

Each kind of work needs only its own tools.

| Work | Needs |
| --- | --- |
| Reading captures | Python 3 (`tools/sniff_parse.py` and `tools/owner_key.py` need nothing beyond its standard library); optionally `tshark` or Wireshark |
| Talking to the bike from a computer | A computer with Bluetooth LE, Python 3 and the packages of `requirements.txt` (`bleak`). `tools/pair.py` pairs through BlueZ, so it runs only on Linux; `tools/scan.py` and `tools/cli.py` use `bleak`, which also supports macOS and Windows, but have been tested only on Linux. How the bike pairs with macOS or Windows: **Unknown**. |
| Analysing the official app | JDK 21, [jadx](https://github.com/skylot/jadx), [apktool](https://apktool.org/), and for its Flutter code [blutter](https://github.com/worawit/blutter) with its build dependencies; `androguard` from `requirements.txt` |
| Captures and dynamic analysis with a phone | An Android phone with developer options, `adb` (Android platform-tools); `frida-tools` and `mitmproxy` from `requirements.txt` |

The Python packages install into a virtual environment: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

## Tools

| Command | What it does |
| --- | --- |
| `unzip -o apk/<file>.xapk -d decompiled/xapk` | Extract an XAPK: base APK, split APKs and `manifest.json` |
| `jadx -d decompiled/jadx <base>.apk [<split>.apk]` | Decompile the APK; with an XAPK, the base APK together with the split that holds the native libraries (`config.arm64_v8a.apk`) |
| `apktool d <base>.apk -o decompiled/apktool` | Decode the manifest, resources and smali of the APK, or of the base APK of an XAPK |
| `unzip -o <apk-with-libs>.apk 'lib/*' -d decompiled/native` | Extract the native libraries, where the Flutter app's compiled Dart code is (`libapp.so`): from the APK itself, or from the ABI split of an XAPK |
| `python /opt/blutter/blutter.py decompiled/native/lib/arm64-v8a decompiled/blutter` | Recover the Dart classes, functions and objects of `libapp.so` |
| `tshark -r <btsnoop_hci.log> -Y btatt -T fields -e frame.time -e btatt.opcode -e btatt.handle -e btatt.value` | List the ATT reads, writes and notifications of a Bluetooth capture |
| `python tools/owner_key.py <bugreport.zip or btsnoop_hci.log>` | Print the owner key the bike accepted in a capture of the official app connecting ([docs/owner-key.md](../docs/owner-key.md)) |
| `python tools/sniff_parse.py private/captures/<capture>/btsnoop_hci.log` | List a capture's ATT reads, writes and notifications with time, direction, handle and UUID (`--map` for the GATT map, `--uuid` to filter, `--hide` to mask the bytes of a UUID; auth and IoT state bytes are masked unless `--show-private`) |
| `bluetoothctl list` | Check that the container sees the host's Bluetooth adapter |
| `python tools/scan.py` | Find the bike, connect, and list its GATT services and characteristics; reads, writes and subscribes to nothing (`--list` scans only) |
| `python tools/pair.py` | Pair this computer with the bike: asks for the 6-digit code the bike shows; reads, writes and subscribes to nothing (`--remove ADDR` removes the bond) |
| `python tools/cli.py status` | Authenticate with the owner key in `private/keys/` and read the bike's values. Other subcommands send the documented commands, each after a typed confirmation: `live`, `iot`, `assist`, `lights`, `lock`, `unlock`, `gnss`, `gsm`, `levels`, `restart`, `sleep`, and `calibrate` for the torque sensor. |
| `adb connect <ip>:<port>` | Connect the phone over wireless debugging (pair once first with `adb pair`) |

The bike accepts one connection at a time: close the official app before using `scan.py`, `pair.py` or `cli.py`.

## The official Android app

The official app is kept in `apk/`, in whichever form it was obtained:

- **An APK**: one file holding everything, the code (`classes*.dex`), the manifest, the resources and the native libraries (`lib/<abi>/*.so`). jadx and apktool read it directly. It is installed with `adb install`.
- **An XAPK**, as some download sites offer it, or the **split APKs** pulled from a phone (`adb shell pm path com.amplerbikes.mobile` lists them, `adb pull` copies each). The app is then split in parts, described below.

An XAPK is a ZIP holding:

- `<package>.apk`: the base APK, with `classes*.dex`, the manifest and the main resources.
- `config.<abi>.apk` (such as `config.arm64_v8a.apk`): split APKs holding the native libraries, `lib/<abi>/*.so`. Libraries that reveal the framework (`libflutter.so`, `libapp.so`, `libhermes.so`) are here, not in the base APK.
- `config.<language>.apk` and `config.<density>.apk`: language and screen resources, rarely relevant.
- `manifest.json`: package name, version, list of splits and ABIs.
- Sometimes `Android/obb/…`: extra data.

It is extracted to `decompiled/xapk/`. The base APK goes to apktool alone; jadx gets the base APK together with the split of the ABI. The native libraries are extracted to `decompiled/native/` for analysis with Ghidra or the framework's own tool. Renaming an XAPK to `.apk` does not make it installable; split APKs are installed on a phone together, with `adb install-multiple`.

Nothing taken from the official app is ever run on a computer or in a container, only analysed: it is a program of unknown behaviour, and a development computer holds the bike's key and reaches its Bluetooth. The official app runs only on the phone.

## Recognising the framework

| If the APK holds | The app is | Tool beyond jadx |
| --- | --- | --- |
| Its logic in `classes*.dex`, in Java or Kotlin | Native | None |
| `lib/<abi>/libflutter.so` and `libapp.so` | Flutter | `blutter` (worawit/blutter) to recover Dart symbols |
| `assets/index.android.bundle` | React Native | `hermes-dec` if it is Hermes bytecode; a formatter if it is plain JavaScript |
| `assemblies/*.dll` or `libmonodroid.so` | Xamarin or .NET MAUI | ILSpy on the extracted DLLs |
| `assets/www/` or `assets/apps/` | Cordova, Ionic or uni-app | None: the JavaScript is read directly |

The official Ampler app is a Flutter app ([docs/protocol.md](../docs/protocol.md), "Scope").

## Static analysis

What is searched for, in the decompiled sources:

- **UUIDs**: `rg -i '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' decompiled/`.
- **BLE calls**: `BluetoothGatt`, `writeCharacteristic`, `setCharacteristicNotification`, `onCharacteristicChanged`, `requestMtu`, `createBond`, and libraries such as RxAndroidBle, Nordic's Android BLE Library, `flutter_blue`, `flutter_reactive_ble` or `react-native-ble-plx`.
- **Cryptography and integrity**: `Cipher`, `AES`, `SecretKeySpec`, `Mac`, `HMAC`, `ECDH`, `CRC`, `checksum`, `nonce`, `challenge`, `sessionKey`.
- **Server**: base URLs and endpoints about bikes, keys, tokens, sharing, firmware; what the app fetches from the server before or while it connects to the bike.
- **Bike models and generations**: names of models, firmware versions, branches of code by generation.
- **Manifest**: permissions, services, `allowBackup`, network security configuration (certificate pinning).

The first question for a bike whose maker is gone is whether its BLE authentication needs anything from the maker's server, and if so, what and where the phone keeps it. For a second-generation Ampler it needs only the owner key, which the phone sends as is ([docs/protocol.md](../docs/protocol.md), "Dependence on Ampler's servers").

Nothing found in the decompiled sources is copied into the repository: the specification names a class or method as evidence, in its own words, and never reproduces its code ([docs/safety.md](../docs/safety.md), "Legal basis").

## Captures with the official app

A capture shows the real bytes that the analysis predicts. It must be made while the official app still works for the bike.

1. On the phone, enable Developer options, then "Bluetooth HCI snoop log". Turn Bluetooth off and on.
2. Open the official app and do one action at a time, writing down the time of each: connect, every assist level, lights on and off, lock, unlock, each setting the app offers, riding for a minute with live data on screen.
3. Get the log with `adb bugreport private/captures/bugreport-<name>.zip`; `btsnoop_hci.log` is inside, under `FS/data/misc/bluetooth/logs/` or a similar path depending on the phone.
4. Keep the notes of times and actions next to the capture, in `private/captures/<name>/`.

Installing an older version of the official app, such as an XAPK's, means uninstalling the newer one first, which deletes the app's data and the owner key it keeps. Back up that data and keep the newer app's APKs in `apk/` first (`adb shell pm path com.amplerbikes.mobile` lists them, `adb pull` copies each).

Also, while the official app works:

- Back up the app's data if the phone allows it (root, or `adb backup` if the manifest has `allowBackup="true"`): a key received from the server may be in its `shared_prefs` or a local database.
- Capture the app's HTTPS traffic with mitmproxy, using Frida to bypass certificate pinning if the app has it, to see what the server hands out.
- Take screenshots of the app's information screens: serial number, firmware version, settings.

All of it goes to `private/`. To share a capture, remove the private data first ([docs/safety.md](../docs/safety.md), "Private data").

## Dynamic analysis

- Frida hooks on the functions found in the static analysis (encryption, frame building, key handling) log the plain text and keys the app uses. `frida-server` on the phone must be the same version as `frida --version` in the container.
- nRF Connect, on the phone, shows which characteristics can be read without authentication.
- With the official app closed, the tools above reproduce a documented read or command from a computer to confirm it ([docs/safety.md](../docs/safety.md), "Testing on the real bike").

## Evidence

Every statement in [docs/protocol.md](../docs/protocol.md) names its evidence, of one of these kinds:

- **Capture**: the capture's name in `private/captures/` and the frame or time, with the anonymised bytes quoted.
- **Code**: the decompiled class and method that builds or parses it, by name only.
- **Test on the bike**: what was sent, what the bike did, and the bike owner's approval.

A statement backed only by code is marked "not yet confirmed by a capture". A statement with no evidence is not written; the gap is marked as unknown instead.
