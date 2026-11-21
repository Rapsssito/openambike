# Instructions for AI agents

What everyone needs to know is in the files for people: [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [docs/](docs/), [app/README.md](app/README.md), [app/DEVELOPMENT.md](app/DEVELOPMENT.md) and [reverse-engineering/README.md](reverse-engineering/README.md). The `AGENTS.md` files add only how an agent works, and point to those files rather than repeat them. "The owner" is the person you work for, who owns the bike you may talk to.

## Read before writing

Read [CONTRIBUTING.md](CONTRIBUTING.md), then what this table names for the paths your change touches. Where it names sections, read those sections, not the whole file.

| If your change touches | Read before writing |
| --- | --- |
| `app/` | [app/AGENTS.md](app/AGENTS.md) and what it names |
| `reverse-engineering/`, the official app, a capture, a decompiled file | [reverse-engineering/AGENTS.md](reverse-engineering/AGENTS.md) and what it names |
| Code that reads or writes the bike, `docs/protocol.md`, a UUID, a command, a frame format | [docs/protocol.md](docs/protocol.md): "How this file is edited", "Scope", and the sections of the values concerned; [reverse-engineering/README.md](reverse-engineering/README.md), "Evidence" |
| Anything sent to the bike, a key, a token, a serial number, a capture kept or quoted | [docs/safety.md](docs/safety.md), the whole of it |
| `package.json`, `requirements.txt`, a tool's configuration, an installed tool | [reverse-engineering/README.md](reverse-engineering/README.md), "Requirements"; for a library of the app, [app/DEVELOPMENT.md](app/DEVELOPMENT.md), "Libraries and licences" |
| `README.md`, `CONTRIBUTING.md`, the name, an icon, a release | [docs/safety.md](docs/safety.md), "Name and trademark" |

Read [docs/roadmap.md](docs/roadmap.md) when a task depends on what exists or on a choice not yet made.

## Stop and ask the owner

- When the specification is silent, ambiguous or seems wrong: the specification changes first, then the code. Never fill a gap in the protocol with a guess.
- Before the first time any command is sent to the real bike, and before any probe ([docs/safety.md](docs/safety.md), "Testing on the real bike" and "Probing").
- Before a legal doubt goes any further ([docs/safety.md](docs/safety.md), "Legal basis").
- Before committing, unless asked to; never on `main` without being asked.
- Before delegating to another agent. Delegation is one level deep, and the brief names the rows of the table above for the paths the delegated agent will touch.

Ask in rounds, each question with a recommended option and why; if one is not understood, rephrase it around the concrete case. A question left open goes to [docs/roadmap.md](docs/roadmap.md), "Open questions".

## Working

- Search with `rg`.
- While working, run only the tests of the files touched; before a commit, the checks of [CONTRIBUTING.md](CONTRIBUTING.md), "Checks and commits", and scan the staged diff for the owner key in `reverse-engineering/private/keys/`, without printing it.
- Anything may be installed where you run; a tool the project needs every time is added as [CONTRIBUTING.md](CONTRIBUTING.md), "Checks and commits", says.
- Never print private data ([docs/safety.md](docs/safety.md), "Private data"), even from a file you may read.
- A rule about how to work on this repository goes in a file of the repository (a file for people if it binds everyone, an `AGENTS.md` if only agents), never only in an agent's memory.
- End commit messages with the attribution line your tool asks for, if any.

## Before finishing

For each kind of file the change touched, read again what its row of the table names. The final message says which files were read for which paths.
