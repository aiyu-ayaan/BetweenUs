# BetweenUs

## Documentation & Architecture

Complete architecture specifications, guidelines, protocols, API catalogs, and developer notes are located in:

- [`development/claude.md`](development/claude.md) — Master architecture and AI developer reference
- [`development/devdocs/`](development/devdocs/) — Internal development specifications and implementation trackers
- [`development/Commit.md`](development/Commit.md) — Commit conventions and local git guidelines
- [`docs/`](docs/) — Full Docusaurus documentation suite (architecture, services, database, system design, security, deployment)
- [`README.md`](README.md) — Public repository overview and quick start

When working on this repository, please review and adhere to the guidelines and specifications detailed in `development/claude.md`.

---

## ⚠️ Critical Rule for AI Assistants: Never Push Code

**AI assistants must NEVER execute `git push` or push code/commits to remote repositories (`origin/master`, `origin/main`, etc.) under any circumstances.**

All commits must remain strictly **LOCAL** on the user's workspace. Pushing to remote repositories is exclusively reserved for the human repository owner.
