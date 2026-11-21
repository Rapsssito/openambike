# Safety, privacy and legal limits

What the project never does, how private data is kept, and how the name is used. These limits bind the app, the tools, the documentation and everyone who works on them. "The owner" here means the owner of the bike a command is sent to.

## Legal basis

The project exists for interoperability: making an Ampler e-bike its owner already has work with software other than the manufacturer's. In the European Union, Directive 2009/24/EC, article 6, allows decompiling a program to obtain the information needed for interoperability with another program, by a person who has the right to use it, limited to the parts needed for that purpose. The owner is not a lawyer and neither is any agent; in doubt about a use, ask the owner before going on.

What follows from it:

- The analysis of the official app is limited to what interoperability with the bike needs: its BLE protocol, its authentication and its dependence on Ampler's servers.
- Nothing of Ampler's is redistributed: no code, no decompiled text, no images, icons, sounds, fonts or other resources, no keys embedded in the app. The project publishes only its own code and the specification of the protocol, written in its own words.
- The information obtained is used only for this project.

## What the project never does

- **Firmware updates (OTA).** A failed or wrong update can leave the bike unusable. The app and the tools never write firmware, even when the protocol for it is known; the specification may describe it as read-only knowledge.
- **Changes to legal limits.** The assist speed limit (25 km/h for pedelecs in the EU) and the motor's rated power are never raised, even when the protocol exposes them, and the speed pedelec settings are never written. The settings of the two assist modes (`docs/protocol.md`, "Assist levels") are written only as the official app writes them: 6 bytes, assist speed from 10 to 25 km/h and assist amount from 40 to 100 %, where 25 km/h and 100 % are the bike's own maxima, so no value can go beyond them.
- **Commands without evidence.** No command is sent to the real bike unless `docs/protocol.md` documents it with evidence: a capture of the official app sending it, or the official app's code building it (3.0.9 or 3.1.7) even when no screen of the app sends it. A command backed only by code is first sent with the bike on a stand. A command is not found by sending the bike values the official app does not send, except in a probe the owner approves (see "Probing").
- **Factory motor calibration.** `01` to `…81d2` is documented in `docs/protocol.md` for others to study, but the app and the tools never send it: it is a procedure for service technicians that spins the rear wheel, and what it changes in the motor's parameters is unknown.
- **Disabling theft protection silently.** The bike is unlocked only by the rider's choice: an action in the app, or auto-unlock, a setting of the app that the rider turns on, off by default and explained beside it, that unlocks the bike when auto-connect connects to it because the phone came next to it. Nothing else unlocks it, and the app never turns auto-unlock on by itself.

## Testing on the real bike

- The owner approves the first time each command is sent to the bike.
- Tests that may engage the motor are done with the bike on a stand, rear wheel off the ground.
- The official app is closed while the container or the app under test is connected: the bike accepts one connection at a time.
- Before any test that could change the bike's state, the current values (assist level, lights, lock, settings) are written down so they can be restored.

## Probing

The owner may approve sending a value no evidence documents, to find out what a characteristic does. Each probe:

- Is approved by the owner for one characteristic and the exact values to send, before it is sent.
- Targets a characteristic whose name, properties or matching IoT state field suggest what it does, and starts from the value it returns when read, which is written down first and restored afterwards.
- Never targets: the SMP firmware service and `…81c9` (firmware updates), `…81c3` (factory reset), `…81a0` (auth, the owner key), `…81d2` (calibrations) with any value but the documented `00`, `…81a4` with values beyond its documented ranges, or anything that may write the speed pedelec settings, `…81b7` included (`docs/protocol.md`, "GATT map").
- Is done with the bike on a stand if it may engage the motor.
- Is written into `docs/protocol.md` as "Test on the bike", with what was sent, what the bike did and the owner's approval, whatever the result.

## Private data

Private data means: keys and tokens of the bike or of an Ampler account, serial numbers, MAC addresses, account e-mails and passwords, GPS positions, and raw captures (HCI logs, HTTPS traffic, app backups), which contain all of these.

- It lives only in `reverse-engineering/private/`, which git ignores.
- A capture or value quoted in `docs/` or in a test is anonymised first: MAC addresses become `AA:BB:CC:DD:EE:FF`, serial numbers `SERIAL`, keys and tokens a run of `00` of the same length, positions are removed. The bytes that matter for the protocol stay unchanged.
- The bike's key is backed up outside the phone and the container (an encrypted export the owner keeps), so that losing one device does not lose control of the bike.

## Name and trademark

AMPLER is a registered trademark of Ampler Bikes OÜ. The project's name, OpenAMBike, does not contain it.

- The name of the app, its application ID (`io.github.rapsssito.openambike`), its icon and its repository never contain "Ampler" nor Ampler's logo, colours or app icon.
- "Ampler" is used only to say what the project is compatible with, as in the project's description.
- Every public description (the README, a release, an app store listing) states: "Unofficial, open-source companion app for Ampler e-bikes. Not affiliated with or endorsed by Ampler Bikes OÜ."
