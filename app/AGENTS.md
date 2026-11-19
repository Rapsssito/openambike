# Instructions for AI agents: the app

For agents changing `app/`. Read the root [AGENTS.md](../AGENTS.md) first. Everything about the app itself is in [README.md](README.md); this file adds only how an agent works on it.

## Read before writing

- [README.md](README.md), the whole of it, and [docs/protocol.md](../docs/protocol.md) for any code that reads or writes the bike.
- [docs/safety.md](../docs/safety.md) before adding a screen or control that sends anything to the bike.

## Working

- A screen or control exists only for what the specification documents. If a screen needs something the specification lacks, stop and ask the owner; never add the protocol code first.
- Protocol code stays in `src/ble/protocol.js` as pure functions, each tested against anonymised frames that name their capture. Screens never talk to the bike directly: they read the session's state and call its commands.
- Every text the interface shows is in each file of `src/i18n/`, with the same keys.
- Screens compose the elements of `src/pages/ui.js`; a new kind of element is added there, not styled inside a screen.
- Screenshots taken to look at the design follow README.md, "Design": low resolution, kept out of the repository.
- After changing the app, offer the owner the commands to try it (README.md, "Running"), and say which commands to the bike the change can send.
