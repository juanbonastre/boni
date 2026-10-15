# AGENTS.md - rules for AI assistants working on this repo

Boni is Juan's own client/server app. Design and decisions live in his Obsidian vault (`proyectos/boni.md`, read it through
vault-mcp) and in `docs/arquitectura.md` here. The vault's own rules (`AGENTS.md` of the vault) apply to anything written there.

## Principles
- **Boni does not know Obsidian exists.** It reads and writes data only through MCP servers. vault-mcp is the first source.
  Vault-specific knowledge (paths, note formats of `registros/finanzas/`) stays inside one adapter
  (`server/boni/sources/finanzas.py`).
- **Clients have no business logic and no data access.** They render what the server describes (screens, forms, charts)
  and queue captures while offline. Permissions, validation and every write happen in the server.
- **One definition of "spending"**: Juan's share, without refunds, internal transfers, investments or loan payments
  (same as `tools/finanzas.py` in the `gastos-app` repo and the vault's `registros/finanzas/README.md`).
  It lives in `server/boni/stats/spending.py`; change it there and in those two places together.
- **The contract lives in `api/`.** The server's Pydantic models (`server/boni/contract.py`) are the source; `api/schema/`
  is generated from them (`python -m boni.contract --write`) and a test fails if they drift. `api/examples/` are parsed by
  both server and client tests. Change contract, server and clients in the same PR. Additive changes only within `/api/v1`;
  clients must ignore unknown fields and show a placeholder for unknown component types.

## Design
- **Look and interaction follow Boni Calendar**, which is the reference app for every Boni client (desktop, widgets, Android).
  Tokens, patterns and interaction rules: `docs/design-guide.md` in the `juanbonastre/boni-calendar` repo (vault note
  `wiki/temas/guia-de-diseno-boni.md`). Read it before touching any UI and match it; a deviation needs a written reason here.
  Server-described screens must be renderable with those tokens, so do not add colours or styles on the server side.

## Language
- Code, comments, this file and `api/` in English.
- What Juan reads in Spanish: `README.md`, `docs/`, UI labels sent by the server. Accents and n-tilde are fine there and the
  UI uses correct Spanish (Juan, 2026-10-15; same as Boni Calendar). Labels already written without accents are fixed when touched.
- Keep ASCII (no accents or n-tilde) only in file and folder names and in keys that tools match literally: ids, API field names,
  category paths, statuses, tags.

## Secrets
- Never commit tokens, passwords or keys. The server reads them from environment variables (see `server/README.md`);
  device tokens are stored hashed in SQLite. Client config lives in the user's config folder, never in the repo.
- Don't write secrets in the vault either; write where they live (Vaultwarden entry name).

## Building and testing
- Server: `cd server && uv venv -p 3.12 && uv pip install -e '.[dev]' && pytest` (tests use an in-process fake vault-mcp
  built with the real MCP SDK; no network). Lint: `ruff check`.
- Clients: `cd clients && gradle test` (JDK 17+). `gradle :desktop:run` starts the app; `gradle :desktop:screenshots`
  renders PNGs of charts and widgets with sample data (CI uploads them as an artifact).
- CI: one workflow per part (`server.yml`, `clients.yml`), each runs only when its folder or `api/` changes.

## Workflow
- Small PRs; tests for pure logic (server modules, chart math, queue, contract parsing).
- Document every change in the vault as you go: `proyectos/boni.md` (log line), and for NAS deployment
  `wiki/infra/` (follow `wiki/infra/CLAUDE.md`) and its `_meta/changelog.md`. Steps Juan has to run go in the chat,
  not in notes.
