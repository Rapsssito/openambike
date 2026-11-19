# Instructions for AI agents: reverse engineering

For agents working in `reverse-engineering/`, on the official app, on a capture or on the specification. Read the root [AGENTS.md](../AGENTS.md) first. The method and the tools are in [README.md](README.md); this file adds only how an agent works.

## Read before writing

- [README.md](README.md), the whole of it, and [docs/safety.md](../docs/safety.md), the whole of it.
- For the tools in `tools/`, also [docs/protocol.md](../docs/protocol.md).

## Working

- Never run a binary, script or native library taken from the official app, on the computer or in a container; only analyse it. The official app runs only on the phone ([README.md](README.md), "The official Android app").
- Nothing from `decompiled/` is copied into `app/`, `tools/` or `docs/`: code, strings, images, icons or keys. Name a class or method as evidence; never quote its code.
- `apk/`, `decompiled/` and `private/` are read as needed but never staged; anything written from them to the repository is anonymised first ([docs/safety.md](../docs/safety.md), "Private data").
- Run the tools that print captured bytes with their private bytes masked (the default of `tools/sniff_parse.py`), and never print the owner key, a serial number, a MAC address, a position or the IoT state's private fields. `tools/owner_key.py` prints the key by design: never let its output reach you; to check it, compare its output with `private/keys/owner-key.txt` inside the shell, printing only whether they match.
- Every finding written into [docs/protocol.md](../docs/protocol.md) names its evidence; a finding from code alone says "not yet confirmed by a capture". Writing it follows [docs/protocol.md](../docs/protocol.md), "How this file is edited".
- A tool that writes to the bike asks for a typed confirmation before each write, sends only what the specification documents, and is added to the tools table of [README.md](README.md).
