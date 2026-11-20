# OpenAMBike

Unofficial, open-source companion app for Ampler e-bikes. Not affiliated with or endorsed by Ampler Bikes OÜ.

Source code, issues and releases: <https://github.com/Rapsssito/openambike>.

## Contents

- [Why it exists](#why-it-exists)
- [Where to start](#where-to-start)
- [What works](#what-works)
- [What it never does](#what-it-never-does)
- [Repository layout](#repository-layout)
- [Licence](#licence)

## Why it exists

Ampler Bikes OÜ went bankrupt, and its e-bikes depend on its app and its servers for locking, assist settings and live data. OpenAMBike keeps them usable without either:

- **An open specification** of the bikes' Bluetooth Low Energy (BLE) protocol, [docs/protocol.md](docs/protocol.md), written from captures of the official app's traffic, from analysis of the official app, and from tests on a real bike.
- **An app** built on that specification, for Android and for the web (Chrome or Edge), that talks to the bike directly and needs no server, no account and no internet connection.

All the app needs is your bike's **owner key**: a fixed 28-character text that the official app wrote to the bike when it was first paired. [docs/owner-key.md](docs/owner-key.md) shows how to get it from your phone while the official app still connects to your bike; the app can read it from the phone's bug report.

## Where to start

- **You own an Ampler and want to keep using it:** get your owner key first, while the official app still works ([docs/owner-key.md](docs/owner-key.md)). Then read [What works](#what-works) and [app/README.md](app/README.md); install the APK of the latest [release](https://github.com/Rapsssito/openambike/releases), or build the app from source (`git clone https://github.com/Rapsssito/openambike.git`).
- **You want to learn the protocol, or extend it to another bike or firmware:** read [docs/protocol.md](docs/protocol.md), then [reverse-engineering/README.md](reverse-engineering/README.md) for how it was found and the tools that talk to a bike from a computer. Captures from other models and generations are the most useful contribution.
- **You want to improve the app:** read [app/README.md](app/README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

Before sending anything to a bike, read [docs/safety.md](docs/safety.md).

## What works

Tested on a Stellar of 2022 (second generation, firmware 3.9.0):

- Connecting and authenticating with the owner key.
- Live battery data (charge, voltage, current, power, pack temperatures), speed, motor and rider power, odometer and range.
- Assist mode, lights and lock.
- The assist speed (10 to 25 km/h) and assist amount (40 to 100 %) of each of the two assist modes.
- GPS and mobile network on or off, restart, sleep and torque sensor calibration.

Other models, generations and firmware versions are unknown: the specification says what has been seen on which bike. What is left to build is in [docs/roadmap.md](docs/roadmap.md).

## What it never does

- Update firmware.
- Raise the assist speed above 25 km/h or the motor power above the bike's own maximum, or enable speed pedelec settings.
- Send the bike a command the specification does not document with evidence.
- Send your data anywhere: the Android app does not even ask for internet access.

The reasons, and the legal basis of the project, are in [docs/safety.md](docs/safety.md).

## Repository layout

| Path | What it holds | Written for |
| --- | --- | --- |
| [docs/protocol.md](docs/protocol.md) | The BLE protocol specification, the project's reference: the app and the tools implement it | Everyone |
| [docs/safety.md](docs/safety.md) | What the project never does, private data, the legal basis, the name | Everyone |
| [docs/owner-key.md](docs/owner-key.md) | How to get your bike's owner key from your phone | Riders |
| [docs/roadmap.md](docs/roadmap.md) | What is left to find out and to build, by priority, and open questions | Everyone |
| [app/](app/) | The Ionic and Capacitor app, for Android and the web | App developers |
| [reverse-engineering/](reverse-engineering/) | How the protocol was found, the tools it needs, Python tools that talk to the bike | Protocol researchers |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute: checks, commits, private data | Contributors |
| `AGENTS.md` files | Instructions for AI coding agents working on the repository; people can skip them | AI agents |

Files for people are the `README.md` files, [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/](docs/). Files named `AGENTS.md` (at the root, in [app/](app/) and in [reverse-engineering/](reverse-engineering/)) hold only instructions for AI agents and point to the files for people for everything else.

## Licence

AGPL-3.0: see [LICENSE](LICENSE). Anyone who distributes a modified version, or lets people use it over a network, must publish its code under the same licence.

AMPLER is a registered trademark of Ampler Bikes OÜ, used here only to say what the project is compatible with.
