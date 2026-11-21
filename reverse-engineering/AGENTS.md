# Instructions for AI agents: reverse engineering

For agents working in `reverse-engineering/`, on the official app, on a capture or on the specification, after the root [AGENTS.md](../AGENTS.md).

## Read before writing

From [README.md](README.md): "What is here", "The official Android app" and "Evidence" always, then the section of the method you use. [docs/safety.md](../docs/safety.md), the whole of it.

## Working

- Never run a binary, script or native library taken from the official app, on the computer or in a container; only analyse it.
- Nothing from `decompiled/` is copied into `app/`, `tools/` or `docs/`: code, strings, images, icons or keys. Name a class or method as evidence; never quote its code.
- `apk/`, `decompiled/` and `private/` are read as needed but never staged; anything written from them to the repository is anonymised first ([docs/safety.md](../docs/safety.md), "Private data").
- Run the tools that print captured bytes with their private bytes masked (the default of `tools/sniff_parse.py`), and never print the owner key, a serial number, a MAC address, a position or the IoT state's private fields. `tools/owner_key.py` prints the key by design: never let its output reach you; to check it, compare its output with `private/keys/owner-key.txt` inside the shell, printing only whether they match.
- A finding written into [docs/protocol.md](../docs/protocol.md) names its evidence; one from code alone says "not yet confirmed by a capture".
- A tool that writes to the bike asks for a typed confirmation before each write, sends only what the specification documents, and is added to the tools table of [README.md](README.md).
