# Instructions for AI agents

This file is for AI coding agents. Everything a person needs to know is in the files for people: [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [docs/](docs/), [app/README.md](app/README.md) and [reverse-engineering/README.md](reverse-engineering/README.md). This file and the `AGENTS.md` of each area add only how an agent works: what to read first, when to stop and ask, and how to report. They never repeat the files for people; they point to them.

"The owner" is the person you work for, who owns the bike you may talk to.

## Read before writing

Read [docs/protocol.md](docs/protocol.md) and [CONTRIBUTING.md](CONTRIBUTING.md) first, then what this table names for the paths your change touches.

| If your change touches | Read before writing |
| --- | --- |
| `app/` | [app/AGENTS.md](app/AGENTS.md) and what it names |
| `reverse-engineering/`, the official app, a capture, a decompiled file | [reverse-engineering/AGENTS.md](reverse-engineering/AGENTS.md) and what it names |
| `docs/protocol.md`, a UUID, a command, a frame format | [docs/protocol.md](docs/protocol.md), "How this file is edited"; [reverse-engineering/README.md](reverse-engineering/README.md), "Evidence" |
| Anything sent to the bike, a key, a token, a serial number, a capture kept or quoted | [docs/safety.md](docs/safety.md) |
| `package.json`, `requirements.txt`, a tool's configuration, an installed tool | [reverse-engineering/README.md](reverse-engineering/README.md), "Requirements"; for a library of the app, [app/README.md](app/README.md), "Libraries and licences" |
| `README.md`, `CONTRIBUTING.md`, the name, an icon, a release | [docs/safety.md](docs/safety.md), "Name and trademark"; [CONTRIBUTING.md](CONTRIBUTING.md), "Writing documentation" |

What is left to find out and to build, by priority, and open questions, are in [docs/roadmap.md](docs/roadmap.md): read it when a task depends on what exists or on a choice not yet made.

## Stop and ask the owner

- When the specification is silent, ambiguous or seems wrong: the specification changes first, then the code. Never fill a gap in the protocol with a guess.
- Before the first time any command is sent to the real bike, and before any probe ([docs/safety.md](docs/safety.md), "Testing on the real bike" and "Probing").
- Before a legal doubt goes any further ([docs/safety.md](docs/safety.md), "Legal basis").
- Before committing, unless asked to; and never on `main` without being asked.
- Before delegating to another agent. Delegation is one level deep, and the brief names the rows of the table above for the paths the delegated agent will touch.

Questions go to the owner in rounds, each with a recommended option and the reason for it; if one is not understood, rephrase it around the concrete case. A question left open goes to [docs/roadmap.md](docs/roadmap.md), "Open questions".

## Working

- Search with `rg`, not `grep -r` or `find … | xargs grep`.
- While working, run only the tests of the files touched; before a commit, the checks of [CONTRIBUTING.md](CONTRIBUTING.md), "Checks and commits". Also scan the staged diff for the owner key in `reverse-engineering/private/keys/` and never print it.
- Never print private data ([docs/safety.md](docs/safety.md), "Private data") in your output, even from a file you are allowed to read.
- Anything may be installed where you run; a tool the project needs every time is added as [CONTRIBUTING.md](CONTRIBUTING.md), "Checks and commits", says.
- A rule about how to work on this repository is written in a file of the repository: in a file for people if it binds everyone, in an `AGENTS.md` if it binds only agents. Never only in an agent's memory, which a reset loses.
- End commit messages with the attribution line your tool asks for, if any.

## Before finishing

List the kinds of file the change touched, find the row of the table above for each, and read again the files it names. The final message says which files were read for which paths, so that a skipped one is seen.
