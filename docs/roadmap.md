# Roadmap

What is left to find out and to build, highest priority first, and the questions still open. Whatever the documentation describes and this file does not list is done. An item is one line, added where it belongs, and deleted in the commit that finishes it; a section is deleted when it is empty.

## 1. Whether a bike with no owner needs a real owner key

Today the app works only for an owner who still has the key the official app wrote to the bike, the UID of their Ampler account ([protocol.md](protocol.md), "Connection and authentication"). If a bike with no owner yet accepts any 28 characters as its owner key, an owner who never had that key can still take the bike over.

- From the official app's first pairing (`_performG2InitialPairing`, and `_performG1InitialPairing` on G1 bikes), find out how a bike with no owner learns its key: whether it accepts whatever the first phone writes, or checks it against something Ampler gave it, at the factory or over its mobile network.
- Find out what leaves a bike with no owner: a new bike, a bike Ampler's service released, or something else. The factory reset (`…81c3`) is never sent to find out ([safety.md](safety.md), "Probing").
- If the code leaves it open, test the first pairing with a different key on a bike that has no owner, with its owner's approval.

## 2. Auto-connect, auto-lock and rides

Features for Android, offered under More or in their own tab, with an (i) beside each option that says in a sentence or two what it does; auto-connect, auto-lock, auto-unlock, rides and auto-ride are built. The web app shows the automatic options greyed out, and pressing one says that they need the Android app. iOS can add them later behind the same options.

- Auto-connect, auto-lock and auto-unlock ([app/DEVELOPMENT.md](../app/DEVELOPMENT.md), "Auto-connect") tried on the owner's phone and bike: the far threshold (−80 dBm over 3 seconds) checked against the connection's signal strength, which More shows while auto-connect is on, as the owner walks away, so that the lock goes out before the link drops.
- Rides ([app/DEVELOPMENT.md](../app/DEVELOPMENT.md), "Tabs") tried on the owner's phone and bike: recording with the screen off and the app closed, the figures against the bike's own, the map, and the GPX export opened in OsmAnd or Organic Maps and uploaded to Strava.
- Auto-ride ([app/DEVELOPMENT.md](../app/DEVELOPMENT.md), "Auto-ride") tried on the owner's phone and bike: whether the bike's ASI metrics come often enough for 20 seconds of movement to be told from wheeling it out, and whether rides start and stop as it says with the app closed.
- Whether the bike's Bluetooth address stays the same from one day to the next, with the connect screen's signal test ([app/DEVELOPMENT.md](../app/DEVELOPMENT.md), "Connect"), so that auto-connect's scan can go on filtering on it; the answer goes into [protocol.md](protocol.md), "Advertising".

## 3. The meaning of the rest of the characteristics

- The characteristics the official app does not name ([protocol.md](protocol.md), "GATT map"): what each holds, from its properties, its values while riding and charging, and the matching IoT state fields, through probes the owner approves within [safety.md](safety.md), "Probing".
- The formats of ASI faults (`…81af`) and time synchronisation (`…81b6`), from the official app 3.1.7, which uses them.
- The bytes of battery, battery extended and ASI metrics that [protocol.md](protocol.md) marks as unknown: the rider's torque and cadence, and the rest.
- The meaning of the lights bytes, from screenshots of the official app's lights settings next to the values the bike reports at the same time, while the official app still works.
- Each action noted during the captures matched with its frames, confirming or correcting [protocol.md](protocol.md).
- What the bike notifies after a restart, a sleep or a torque sensor calibration, and after a lights write while it charges, so that the app confirms those commands as it confirms the settings; until then it only waits for the write ([app/DEVELOPMENT.md](../app/DEVELOPMENT.md), "Changes to the bike").

## 4. Other generations and models

- Submit the app's recipe to [fdroiddata](https://gitlab.com/fdroid/fdroiddata) ([app/DEVELOPMENT.md](../app/DEVELOPMENT.md), "Build and release"), add screenshots to F-Droid's listing, and once F-Droid publishes the app, say how to install it from F-Droid in [README.md](../README.md) and [app/README.md](../app/README.md).
- Ask owners of other Ampler models and generations to try the app and to send captures of the official app, and write what differs into [protocol.md](protocol.md), "Differences by generation".
- How the official app 3.0.9 authenticates with and reads the battery of a G1 bike, from its code, to be confirmed by a G1 owner's capture.

## 5. Ampler's server

- Capture the official app's HTTPS traffic with Ampler's server while it still answers, to learn what the app sends it (the IoT state, trips, state reports) and whether the server sends the bike anything ([protocol.md](protocol.md), "Dependence on Ampler's servers").

## Open questions

Questions that need a decision before work can go on. Each is deleted once answered, and its answer written where it belongs.

None at the moment.
