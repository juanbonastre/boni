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

## Clients (apps/): the same architecture as Boni Calendar
- `apps/web/` (React 19 + Vite + zustand, TypeScript) is the whole client: `src/core/` is pure logic with unit tests
  (contract types and parsing, chart math, form logic, offline queue, chart repository, chart builder), `src/store.ts`
  the app state, `src/components/` the screens and the SVG charts, `src/i18n.ts` every text (Spanish first, English).
- Everything the UI needs from where it runs goes through `src/host.ts`: the desktop shell's bridge
  (`window.boniDesktop`) or, in a plain browser (dev, e2e), same-origin requests and localStorage. No `fetch` or
  `localStorage` elsewhere in UI code.
- `apps/desktop/` is the Electron shell: `main.cjs` owns the settings (`~/.config/boni/settings.json`, 0600, the same file
  and keys as the first Kotlin client), the device token (never sent to a page), every request to the server (the API has
  no CORS), the small files in `~/.local/share/boni/store/`, the tray, start at login (`autostart.cjs`) and the widget
  windows (`widgets.cjs`). One page per window: the main window, or one widget (`?widget=<id>&chart=<id>`). One page gets
  the minute ticks (the coordinator: main window, else the first widget) and sends the offline queue.
- **Desktop widgets** are windows of type "dock" kept below the others with `wmctrl -b add,below,sticky` (X11): just above
  the desktop background, below every window, they survive "show desktop" and clicks on the desktop, stay out of the
  taskbar and Alt+Tab, and are fully interactive (tested on Cinnamon's window manager, 2026-10-17). Dragging and resizing
  follow the real pointer (`screen.getCursorScreenPoint`), not page coordinates. Without wmctrl (or on Wayland) they are
  plain frameless windows. The `.deb` depends on wmctrl.
- `clients/` (Kotlin + Compose) is the first client, replaced by `apps/`; it is removed once the new one is in use.

## Building and testing
- Server: `cd server && uv venv -p 3.12 && uv pip install -e '.[dev]' && pytest` (tests use an in-process fake vault-mcp
  built with the real MCP SDK; no network). Lint: `ruff check`.
- Clients: `make setup`, `make check` (Biome, types, unit tests incl. every `api/examples` file), `make e2e` (Playwright
  against a fake server answering with `api/examples`; `e2e/overflow.spec.ts` checks that text fits its box on every
  surface in both languages: a new surface must be added there), `make desktop`, `make package` (`.deb` in `release/`).
- Test it the way Juan uses it before asking him: the real app against the real server with temporary
  `XDG_CONFIG_HOME`/`XDG_DATA_HOME` (a copy of his settings), and synthetic pointer input only in a nested X server
  (Xephyr + muffin), never on his screen.
- CI: one workflow per part (`server.yml`, `apps.yml`), each runs only when its folders or `api/` change. `apps.yml` publishes
  the e2e screenshots on the `ci-screenshots` branch and the `.deb` as the `boni-deb` artifact (version 0.2.<run>).

## Workflow
- Small PRs; tests for pure logic (server modules, chart math, queue, contract parsing).
- Document every change in the vault as you go: `proyectos/boni.md` (log line), and for NAS deployment
  `wiki/infra/` (follow `wiki/infra/CLAUDE.md`) and its `_meta/changelog.md`. Steps Juan has to run go in the chat,
  not in notes.
