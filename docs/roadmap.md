# Roadmap

What is left to find out and to build, highest priority first, and the questions still open. Whatever the documentation describes and this file does not list is done. An item is one line, added where it belongs, and deleted in the commit that finishes it; a section is deleted when it is empty.

## 1. Whether a bike with no owner needs a real owner key

Today the app works only for an owner who still has the key the official app wrote to the bike, the UID of their Ampler account ([protocol.md](protocol.md), "Connection and authentication"). If a bike with no owner yet accepts any 28 characters as its owner key, an owner who never had that key can still take the bike over.

- From the official app's first pairing (`_performG2InitialPairing`, and `_performG1InitialPairing` on G1 bikes), find out how a bike with no owner learns its key: whether it accepts whatever the first phone writes, or checks it against something Ampler gave it, at the factory or over its mobile network.
- Find out what leaves a bike with no owner: a new bike, a bike Ampler's service released, or something else. The factory reset (`…81c3`) is never sent to find out ([safety.md](safety.md), "Probing").
- If the code leaves it open, test the first pairing with a different key on a bike that has no owner, with its owner's approval.

## 2. The meaning of the rest of the characteristics

- The characteristics the official app does not name ([protocol.md](protocol.md), "GATT map"): what each holds, from its properties, its values while riding and charging, and the matching IoT state fields, through probes the owner approves within [safety.md](safety.md), "Probing".
- The formats of ASI faults (`…81af`) and time synchronisation (`…81b6`), from the official app 3.1.7, which uses them.
- The bytes of battery, battery extended and ASI metrics that [protocol.md](protocol.md) marks as unknown: the rider's torque and cadence, the battery's cycles, and the rest.
- The meaning of the lights bytes, from screenshots of the official app's lights settings next to the values the bike reports at the same time, while the official app still works.
- Each action noted during the captures matched with its frames, confirming or correcting [protocol.md](protocol.md).

## 3. Other generations and models

- Build and sign a release APK.
- Publish the repository, after checking that nothing of Ampler's and no private data is in its history, and the signed APKs as releases; consider F-Droid.
- Link the app's connect screen to [owner-key.md](owner-key.md) at its published address, as "How do I get my key?".
- Read the owner key from a bug report inside the app, on the connect screen, so that no computer is needed: open the `.zip` with the browser's own decompression, with no new library, find the key the bike accepted as `reverse-engineering/tools/owner_key.py` does, and keep everything on the device.
- Ask owners of other Ampler models and generations to try the app and to send captures of the official app, and write what differs into [protocol.md](protocol.md), "Differences by generation".
- How the official app 3.0.9 authenticates with and reads the battery of a G1 bike, from its code, to be confirmed by a G1 owner's capture.

## 4. Ampler's server

- Capture the official app's HTTPS traffic with Ampler's server while it still answers, to learn what the app sends it (the IoT state, trips, state reports) and whether the server sends the bike anything ([protocol.md](protocol.md), "Dependence on Ampler's servers").

## Open questions

Questions that need a decision before work can go on. Each is deleted once answered, and its answer written where it belongs.

None at the moment.
