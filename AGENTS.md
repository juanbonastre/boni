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
  (contract types and parsing, chart math, form logic, offline queue, chart repository, chart builder, palette),
  `src/store.ts` the app state, `src/components/` the UI and the SVG charts, `src/i18n.ts` every text (Spanish first,
  English). The main window is laid out as Boni Calendar's: `Sidebar` (home, the charts with colour, eye = on the home
  screen, drag to reorder; this computer's widgets; settings and the user), the main area (the home screen's charts
  filling the window, or one chart on its own) and `SidePanel` (the capture form from the server, the chart editor; the
  card being edited shows the preview). A chart's own controls show when the pointer is over its card (`CardControls`:
  period, filters, order, kind, colour, menu), like a Notion view's; each change is saved at once with Undo in the toast.
  Deleting waits for the toast's Undo before it reaches the server. Zustand selectors return existing objects (a selector
  that builds a new array loops forever: use `useVisibleCharts` and the like).
- **The phone** (narrower than 640 px, and the Android app): `MobileApp.tsx`, its own layout over the same store and
  components, made for capturing rather than watching charts (Juan, 2026-10-18). Tab "Apuntar" (the server's capture
  buttons and the **shortcuts**) and tab "Gráficas" (a list with each total; one chart on the whole screen with period
  chips; the editor in a sheet). Forms and editors are full-screen sheets whose buttons stay at the bottom; the form folds
  the optional fields under "Más detalles". Back is Esc: what a component opened (a menu, a list) closes on its own
  Esc, then `goBack()` in the store (settings, the panel, a chart's detail, the chart, the charts tab), so the detail of
  the chart on its own is navigation (`view.drill`). Closing a sheet by hand (Back, its X) after something was typed or
  chosen in it asks first (`panelEdited`, `dismissPanel`); saving closes it without asking. A tap on a chart shows the
  value, a second tap the detail. Written deviation from Boni Calendar's guide: base text 16 px, touch targets 48 px
  and icons 20-24 px (the guide's 13 px and 28 px controls are for a mouse; 16 px also keeps Android from zooming into
  a field). Styles are under `.m-app` in `styles.css`.
- **Shortcuts** (`Shortcut` in the contract, `core/shortcuts.ts`): a server screen plus values for its form, `open` (the
  form filled in) or `save` (sent at once). Generic: the client reads only the form's fields, never what it captures. A
  `save` goes into the offline queue held back (`hold_until`) while its toast offers Undo, so it survives closing the app.
  Shared by every device (like charts), kept on the device too.
- Everything the UI needs from where it runs goes through `src/host.ts`: the desktop shell's bridge
  (`window.boniDesktop`) or, in a plain browser (dev, e2e), same-origin requests and localStorage. No `fetch` or
  `localStorage` elsewhere in UI code.
- `apps/desktop/` is the Electron shell: `main.cjs` owns the settings (`~/.config/boni/settings.json`, 0600, the same file
  and keys as the first Kotlin client), the login (as Boni Calendar's: address, user, password, device name; the password
  and the session token never reach a page), every request to the server (the API has no CORS), the live changes
  (`live.cjs`: one `/api/v1/events` connection for every window, reconnecting with backoff; pages get "changed" events),
  the small files in `~/.local/share/boni/store/`, the remembered window size, the tray, start at login (`autostart.cjs`)
  and the widget windows (`widgets.cjs`). One page per window: the main window, or one widget
  (`?widget=<id>&chart=<id>`). One page gets the minute ticks (the coordinator: main window, else the first widget): it
  sends the offline queue, and reloads every 15 minutes only while there is no live connection. An old device token
  (from before accounts) keeps working; the page asks to log in.
- `apps/android/` is the Android shell (Kotlin, as Boni Calendar's; CI builds it, `android.yml`): the built web UI in a
  WebView from the APK's assets (`appassets.androidplatform.net`, works without network). `AndroidBridge.kt` is
  `window.boniAndroid` (async `call`, answers fetched with `take`; web side `src/android.ts`), over `Shell.kt`, which
  owns what the desktop's main process owns, with the same answers: settings, the login (the session token encrypted by
  a key in the Android Keystore, `TokenVault.kt`; the page never sees it), every request (`Paths.apiRequest`: only
  api/v1), the small files in the app's `files/store/`, the live stream while the app is in front (`Live.kt`) and the
  minute ticks. `QueueWorker.kt` (WorkManager, needs network) sends `queue.json` with the app closed, with the page's
  rules (`QueueLogic.kt` = `core/queue.ts`, unit-tested on the same cases; keep them in step); while the app is in front
  the page sends it. Back asks the page (`window.__boniBack` = `androidBack`: an Esc, so it closes exactly what Esc closes). Cleartext http only to localhost (a server on
  the laptop through `adb reverse`). Signed releases need four repository secrets (see `android.yml`).
  Home-screen shortcuts (`Launcher.kt`, Juan's step 3): the page's shortcut and chart menus offer "Añadir a la pantalla
  de inicio" (`host.phone.pin`, Android's `requestPinShortcut`); an entry only names its target (`shortcut:<id>`,
  `chart:<id>`) and the page decides what it does (`navigate` in the store: a shortcut runs as if tapped). The page
  publishes every target (`setTargets`): pinned entries follow renames, those whose target is gone are disabled, and
  the first four shortcuts are the menu of the app's icon.
  Home-screen widgets (Juan's step 4): `ChartWidget.kt` shows a picture of one chart (chosen in
  `WidgetConfigActivity.kt` from the charts kept on the phone); `WidgetRenderer.kt` draws it with the app's own page
  (`?picture=<chart id>`, `Picture.tsx`: the compact card) in a WebView that is never shown, sized to the widget, and
  takes the picture when the page calls `pictureReady` (a timer, not animation frames: an unshown WebView may get
  none). `WidgetWorker.kt` redraws them when the app comes to the front or the server says data or charts changed,
  after the queue worker delivered something, and every 30 minutes. A tap opens that chart (`chart:<id>`).
- **Desktop widgets** are windows of type "dock" kept below the others with `wmctrl -b add,below,sticky` (X11): just above
  the desktop background, below every window, they survive "show desktop" and clicks on the desktop, stay out of the
  taskbar and Alt+Tab, and are fully interactive (tested on Cinnamon's window manager, 2026-10-17). Dragging and resizing
  follow the real pointer (`screen.getCursorScreenPoint`), not page coordinates. They are resizable windows with explicit
  limits (a non-resizable Electron window gets min = max = its size at every `setSize`, so it never shrinks). Without
  wmctrl (or on Wayland) they are plain frameless windows. The `.deb` depends on wmctrl.
- The first client (Kotlin + Compose, `clients/`) was replaced by `apps/` and removed (2026-10-18); its history is in git.

## Building and testing
- Server: `cd server && uv venv -p 3.12 && uv pip install -e '.[dev]' && pytest` (tests use an in-process fake vault-mcp
  built with the real MCP SDK; no network). Lint: `ruff check`.
- Clients: `make setup`, `make check` (Biome, types, unit tests incl. every `api/examples` file), `make e2e` (Playwright
  against a fake server answering with `api/examples`; `e2e/overflow.spec.ts` checks that text fits its box on every
  surface in both languages: a new surface must be added there), `make desktop`, `make package` (`.deb` in `release/`).
- The `.deb` holds only what `build.files` in `apps/desktop/package.json` lists (`package.test.cjs` checks every module
  the shell loads is there): before handing a build to Juan, extract it (`dpkg-deb -x`) and start that binary with
  temporary `XDG_CONFIG_HOME`/`XDG_DATA_HOME` (0.3.0 shipped without `live.cjs` and hung at start; the repo run was fine).
- Test it the way Juan uses it before asking him: the real app against the real server with temporary
  `XDG_CONFIG_HOME`/`XDG_DATA_HOME` (a copy of his settings), and synthetic pointer input only in a nested X server
  (Xephyr + muffin), never on his screen.
- CI: one workflow per part (`server.yml`, `apps.yml`), each runs only when its folders or `api/` change. `apps.yml` publishes
  the e2e screenshots on the `ci-screenshots` branch and the `.deb` as the `boni-deb` artifact (version 0.3.<run>).

## Workflow
- Small PRs; tests for pure logic (server modules, chart math, queue, contract parsing).
- Document every change in the vault as you go: `proyectos/boni.md` (log line), and for NAS deployment
  `wiki/infra/` (follow `wiki/infra/CLAUDE.md`) and its `_meta/changelog.md`. Steps Juan has to run go in the chat,
  not in notes.
