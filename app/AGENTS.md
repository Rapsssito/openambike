# Instructions for AI agents: the app

For agents changing `app/`, after the root [AGENTS.md](../AGENTS.md).

## Read before writing

From [DEVELOPMENT.md](DEVELOPMENT.md): "Stack", "Structure" and "Design" always; in "Screens", the subsection of what you change; "Permissions", "Build and release" or "Libraries and licences" when the change touches them. [README.md](README.md) when the change affects installing, connecting, troubleshooting or privacy, which it describes in the rider's words.

## Working

- If a screen needs something the specification lacks, stop and ask the owner; never add the protocol code first.
- Every text the interface shows is in each file of `src/i18n/`, with the same keys.
- Never take a screenshot without asking the owner first, each time. Allowed screenshots follow [DEVELOPMENT.md](DEVELOPMENT.md), "Design", and stay out of the repository.
- After changing the app, offer the owner the commands to try it ([DEVELOPMENT.md](DEVELOPMENT.md), "Running"), and say which commands to the bike the change can send.
