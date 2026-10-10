---
okf_version: "0.2"
---

# Files

- [Runtime Architecture](architecture.md) - Single-process runtime topology and lifecycle for NbkristQik — ordered startup of Turso schema init, self-registering bot handlers, and the Express API, plus component data flow and graceful shutdown.
- [Deployment and Operations](operations.md) - Build, lint, test, and deploy workflows for NbkristQik — pnpm scripts, environment variables, the local-build deploy script to the systemd service, CI workflows, and the Vitest test suites for backend and web.
- [Overview](overview.md) - NbkristQik is a Telegram bot and companion web apps letting college students check attendance and mid-term marks, with optional registration for instant commands, a live leaderboard, a service status page, and a private activity admin panel.
- [Quickstart](quickstart.md) - Entry point to the NbkristQik wiki — orientation, quick facts, a one-line index of every page, minimal local setup, and guided reading paths for contributors, operators, and API consumers.
- [Registration and Profile](registration.md) - Optional user registration — the registrations table, profile/register API endpoints with shared initData identity, registered-only /attendance /midmarks /bunk shortcuts, and the standalone Telegram Web App profile page.

# Directories

- [api](api/)
- [bot](bot/)
- [data](data/)
- [portal](portal/)
- [web](web/)
