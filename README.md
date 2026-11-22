<p align="center"><img src="app/public/icon.svg" alt="OpenAMBike icon" width="128" height="128"></p>

<h1 align="center">OpenAMBike</h1>

<p align="center">Keep using your Ampler e-bike after Ampler: a free app that talks to the bike directly, with no account and no servers of its own.</p>

Unofficial, open-source companion app for Ampler e-bikes. Not affiliated with or endorsed by Ampler Bikes OÜ.

## Contents

- [Why it exists](#why-it-exists)
- [What the app does](#what-the-app-does)
- [Get started](#get-started)
- [Which bikes it works with](#which-bikes-it-works-with)
- [What it never does](#what-it-never-does)
- [Help and feedback](#help-and-feedback)
- [For developers and researchers](#for-developers-and-researchers)
- [Licence](#licence)

## Why it exists

Ampler Bikes OÜ went bankrupt, and its e-bikes depend on its app and its servers for locking, assist settings and live data. OpenAMBike is an app for Android and for the Chrome and Edge browsers that does the same over Bluetooth, straight to the bike, so that it keeps working whatever happens to Ampler's servers.

## What the app does

- **Lock and unlock** your bike, and turn its **lights** on and off.
- **Choose the assist mode:** off, mode 1 or mode 2.
- **See your ride live:** speed, the motor's power and your own pedalling power, range and odometer, in a view that switches by itself when you start riding.
- **Tune the assist** of each mode: up to what speed the motor helps (10 to 25 km/h) and how much (40 to 100 %).
- **Check the battery:** charge, voltage, current and power, temperatures, charge cycles, and an estimate of its health.
- **Turn the bike's GPS and mobile network** on or off, and **restart** it, send it to **sleep** or **calibrate** its torque sensor.
- **Reconnect by itself** when the connection drops, and connect at once each time you open it.
- **Connect, lock and record by itself** on Android: auto-connect connects when you are next to the bike, even with the app closed, auto-lock locks it when you walk away, and auto-ride records your ride from when you set off.
- **Record your rides** on Android, with or without the bike connected: time, distance, speed, the motor's and your power, and the route on a map, kept on your phone and exported as GPX to other apps.
- **See and copy your key,** like a Wi-Fi password, to keep it somewhere safe or use it on another phone.
- In **English and Spanish.**

## Get started

1. **Get your bike's owner key, while the official Ampler app still connects to your bike.** The key is a secret text of 28 characters, and OpenAMBike needs it to connect. [Getting your owner key](docs/owner-key.md) shows how, step by step, with an Android phone. Do this first: once the official app stops working, there is no known way to get the key.
2. **Install the app.** On an Android phone, download `OpenAMBike-<version>.apk` from the newest [release](https://github.com/Rapsssito/openambike/releases) and open it; [the app's guide](app/README.md#install-it-on-an-android-phone) walks through each screen of the installation. On a computer, the app runs in Chrome or Edge: see [Use it in a browser on a computer](app/README.md#use-it-in-a-browser-on-a-computer).
3. **Connect.** Close the official app, open OpenAMBike, give it your key, and choose your bike: [Connect to your bike for the first time](app/README.md#connect-to-your-bike-for-the-first-time).

## Which bikes it works with

The app is tested on a Stellar of 2022 (second generation, firmware 3.9.0). Other models, generations and firmware versions have not been tried yet: if you try one, tell us how it went in an [issue](https://github.com/Rapsssito/openambike/issues).

## What it never does

- Update the bike's firmware.
- Raise the assist speed above 25 km/h or the motor power above the bike's own maximum, or enable speed pedelec settings.
- Send the bike a command that has not been documented and tested.
- Send your data anywhere. The only thing the Android app downloads is the map of a ride you open, from OpenFreeMap; that tells OpenFreeMap your IP address and the area shown, nothing else.

The reasons, and the legal basis of the project, are in [docs/safety.md](docs/safety.md).

## Help and feedback

Something does not work, or you would like something added? See [When something goes wrong](app/README.md#when-something-goes-wrong), then open an [issue](https://github.com/Rapsssito/openambike/issues). Never post your owner key or a bug report file publicly.

## For developers and researchers

OpenAMBike is also an open specification of the bikes' Bluetooth Low Energy (BLE) protocol, written from captures of the official app's traffic, from analysis of the official app, and from tests on a real bike. The app is built on it.

- **Learn the protocol, or extend it to another bike or firmware:** read [docs/protocol.md](docs/protocol.md), then [reverse-engineering/README.md](reverse-engineering/README.md) for how it was found and the Python tools that talk to a bike from a computer. Captures from other models and generations are the most useful contribution.
- **Improve the app:** read [app/DEVELOPMENT.md](app/DEVELOPMENT.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
- **What is left to find out and to build:** [docs/roadmap.md](docs/roadmap.md).

Before sending anything to a bike, read [docs/safety.md](docs/safety.md).

| Path | What it holds |
| --- | --- |
| [app/](app/) | The app, for Android and the web: [how to use it](app/README.md), [how to build it](app/DEVELOPMENT.md) |
| [docs/protocol.md](docs/protocol.md) | The BLE protocol specification, the project's reference: the app and the tools implement it |
| [docs/owner-key.md](docs/owner-key.md) | How to get your bike's owner key from your phone |
| [docs/safety.md](docs/safety.md) | What the project never does, private data, the legal basis, the name |
| [docs/roadmap.md](docs/roadmap.md) | What is left to find out and to build, by priority, and open questions |
| [reverse-engineering/](reverse-engineering/) | How the protocol was found, the tools it needs, Python tools that talk to the bike |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute: checks, commits, private data |
| `AGENTS.md` files | Instructions for AI coding agents working on the repository; people can skip them |

## Licence

AGPL-3.0: see [LICENSE](LICENSE). Anyone who distributes a modified version, or lets people use it over a network, must publish its code under the same licence.

AMPLER is a registered trademark of Ampler Bikes OÜ, used here only to say what the project is compatible with.
