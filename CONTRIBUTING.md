# Contributing

How to contribute to OpenAMBike: what helps most, the rules every change follows, and the checks before a commit.

## Contents

- [What helps most](#what-helps-most)
- [Ground rules](#ground-rules)
- [Setting up](#setting-up)
- [Checks and commits](#checks-and-commits)
- [Writing documentation](#writing-documentation)
- [AI agents](#ai-agents)

## What helps most

- **Captures from other bikes.** The specification is written from one Stellar of 2022 (second generation, firmware 3.9.0). A Bluetooth capture of the official app talking to another model, generation or firmware shows what differs. How to make one is in [reverse-engineering/README.md](reverse-engineering/README.md), "Captures with the official app"; remove the private data before sharing it ([docs/safety.md](docs/safety.md), "Private data"), then describe it in an [issue](https://github.com/Rapsssito/openambike/issues).
- **Filling the unknowns.** Every gap in [docs/protocol.md](docs/protocol.md) is marked **Unknown**, and [docs/roadmap.md](docs/roadmap.md) lists what is left to find.
- **The app.** Bugs, translations (one JSON file per language in `app/src/i18n/`) and screens for what the specification documents. See [app/README.md](app/README.md).

## Ground rules

- **The specification comes first.** [docs/protocol.md](docs/protocol.md) is the reference: the app and the tools implement it, and if they disagree, the specification wins. A change to the protocol changes the specification first, with its evidence ([reverse-engineering/README.md](reverse-engineering/README.md), "Evidence"), then the code. A gap is written as **Unknown**, never guessed.
- **Safety limits.** No firmware updates, no assist speed above 25 km/h or motor power above the bike's maximum, no speed pedelec settings, and no command the specification does not document with evidence: [docs/safety.md](docs/safety.md).
- **Nothing of Ampler's.** No code, text, images, icons or keys from the official app are copied into the repository; the app, the tools and the specification are written in the project's own words. The specification may name a class or method of the official app as evidence, never reproduce it.
- **No private data in git.** Keys, serial numbers, MAC addresses, positions and raw captures stay in `reverse-engineering/private/`, which git ignores along with `reverse-engineering/apk/` and `reverse-engineering/decompiled/`. A value quoted in the specification or a test is anonymised first.

## Setting up

Get the code with `git clone https://github.com/Rapsssito/openambike.git`; changes come as pull requests to that repository.

The app needs Node 26 (the version `.nvmrc` names); building for Android also needs JDK 21 and the Android SDK. Reverse engineering needs more tools, listed in [reverse-engineering/README.md](reverse-engineering/README.md), "Requirements".

From the root of the repository:

| Command | What it does |
| --- | --- |
| `npm install` | Install the tools and the app's dependencies, and the commit-message hook |
| `npm test` | Unit tests of the app, including the protocol code against captured frames (`npm test -- <path>` for one file) |
| `npm run checkjs` | Type-check every JavaScript file with `tsc` and its JSDoc types |
| `npm run lint` | Lint with oxlint and check the formatting with oxfmt (`npm run lint:fix` fixes both) |
| `npm run ci-checks` | Type check, lint and every test, as before a commit |

The app's own commands are in [app/README.md](app/README.md); the reverse-engineering tools' in [reverse-engineering/README.md](reverse-engineering/README.md).

## Checks and commits

- `npm run ci-checks` passes before every commit.
- `git status` shows nothing from `reverse-engineering/apk/`, `reverse-engineering/decompiled/` or `reverse-engineering/private/`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`, `docs: …`); the commit-msg hook checks them. The commits merged into `main` since the last release decide the version of the next one, made by hand: `fix` a patch, `feat` a minor version, a breaking change a major one ([app/README.md](app/README.md), "Build and release").
- A library added to the app has its licence read at its source first, and must be compatible with AGPL-3.0 ([app/README.md](app/README.md), "Libraries and licences").
- A tool the project starts to need is added to the requirements of its part (an `npm` dependency, `reverse-engineering/requirements.txt`, or the README's list of tools). How each contributor installs the tools, on the computer or in a container of their own, stays out of the repository: git ignores `.devcontainer/`.

## Writing documentation

- A paragraph or a list item is one line in Markdown, never wrapped by hand. A file meant to be read through opens with a table of contents.
- Documentation describes the system as it is, not how it got there: no build diaries or dates of deciding. What is left to do goes in [docs/roadmap.md](docs/roadmap.md).
- Code, tests and scripts never read Markdown files: what a check needs is written in the code.
- Files for people (`README.md`, this file, `docs/`) explain; files for AI agents (`AGENTS.md`) instruct, and point to the files for people rather than repeat them. A rule that binds everyone goes in a file for people.

## AI agents

The repository is written to be worked on by people and AI coding agents alike. Agents start from [AGENTS.md](AGENTS.md), which tells them what to read for each part of the repository and when to stop and ask. Nothing depends on one agent tool's own files or hooks.
