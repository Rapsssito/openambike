# Changelog

Unofficial, open-source companion app for Ampler e-bikes. Not affiliated with or endorsed by Ampler Bikes OÜ.

# [2.0.0](https://github.com/Rapsssito/openambike/compare/v1.1.1...v2.0.0) (2026-11-23)

* feat(app)!: decide auto-lock without the app, and show what it decides in Activity ([b295bbd](https://github.com/Rapsssito/openambike/commit/b295bbdb285dacac62abc21a2b1ea69cd3754a44))
* feat(app)!: show and copy the owner key in Settings, drop the encrypted export and import ([253195f](https://github.com/Rapsssito/openambike/commit/253195f31f4a66ad051bc6a1f3e489433b049235))
* fix(app)!: use the application ID io.github.rapsssito.openambike, which F-Droid accepts ([6ff0621](https://github.com/Rapsssito/openambike/commit/6ff06211e7b54473888f11c9a47b9951f6f83e74))

### Bug Fixes

* **app:** let the app connect as it opens, and list the connection's steps in the link card ([bba52a5](https://github.com/Rapsssito/openambike/commit/bba52a507a9f2c222cbc846268c96507821113cb))
* **app:** never create a notification channel with no name, which crashed the service ([3e86cd7](https://github.com/Rapsssito/openambike/commit/3e86cd784ed461d7384460c25efc57102be3c2d7))

### Features

* **app:** drop the auto-connect switch, which auto-lock and auto-ride now turn on ([41671f8](https://github.com/Rapsssito/openambike/commit/41671f88682f784f914f2215ad0e93ac644e1517))
* **app:** indent the automatic options under the one each depends on, with shorter info ([b3c219f](https://github.com/Rapsssito/openambike/commit/b3c219fed61fc493c08347bb2b3f3d362a2baf3a))
* **app:** open on the tabs once a bike is linked, blurring what needs it while disconnected ([db3ec9d](https://github.com/Rapsssito/openambike/commit/db3ec9d549c1dbc93c13f83cf76a2bba74280a59))
* **app:** open Settings without a bike, renamed from More ([3c4ffa4](https://github.com/Rapsssito/openambike/commit/3c4ffa49615eec9c6deb170332354adb5efdfb7c))
* **app:** show a ride's time and distance in its notification, with a button to pause or resume ([8892ee5](https://github.com/Rapsssito/openambike/commit/8892ee53278805ead822d7441955cd750003445c))
* **app:** show auto-connect's activity, decide on the signal's median, lock right after connecting ([1829a36](https://github.com/Rapsssito/openambike/commit/1829a360d9bc070fd284b884c5a6a42d15a9a91d))
* **app:** start auto-ride on pedalling, wait a minute for dropped links, end hand locks on leaving ([648fd6e](https://github.com/Rapsssito/openambike/commit/648fd6e37d39dbca7b8e6c0e6f539a7050321fb4))

### BREAKING CHANGES

* opening the app no longer takes over from auto-connect, and the
  thresholds changed.
* the app has a new identifier, so it does not install over version 1.1.1
  or earlier. In the old app, export the key (More, "Export the key") and any rides to keep,
  install the new version, import the key (More, "Import a key"), then uninstall the old app.
* the encrypted export and import of the owner key are gone, and an
  exported key can no longer be imported; copy the key from Settings instead.

## [1.1.1](https://github.com/Rapsssito/openambike/compare/v1.1.0...v1.1.1) (2026-11-21)

### Bug Fixes

* **release:** publish F-Droid's listing and each release's changes for it ([597d7aa](https://github.com/Rapsssito/openambike/commit/597d7aac4e27e8020c7a10e089749c1a6764e900))

# [1.1.0](https://github.com/Rapsssito/openambike/compare/v1.0.0...v1.1.0) (2026-11-21)

### Features

* **app:** auto-connect, auto-lock, rides and auto-ride, through the app's own native service ([ec95799](https://github.com/Rapsssito/openambike/commit/ec95799f1015e191408c49c87389e3a68c793e26))

# 1.0.0 (2026-11-20)

### Features

* **app:** read the owner key from a bug report, and release signed APKs ([09b02ac](https://github.com/Rapsssito/openambike/commit/09b02ac459ac915dc4ed1d0d707f38dc7f6fc265))
* open BLE specification, app and tools for Ampler e-bikes ([550ee8f](https://github.com/Rapsssito/openambike/commit/550ee8f8fea8ccd766f3e2878999f9c790fa55ca))
