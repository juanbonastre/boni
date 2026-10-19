# AGENTS.md — Boni

The Boni monorepo (`juanbonastre/boni`, renamed from `boni-calendar` on 2026-10-19). Today it holds **Boni Calendar**:
a desktop and phone calendar app with the UX of a modern day/week/month calendar, built for one user (Juan), and its
server. It is growing into the Boni core (entities, agent, views) and the Boni apps, following the approved design in
`docs/nucleo.md`: one server, one account, several apps published separately (each with its own release tag prefix).
Project notes live in Juan's vault (`proyectos/boni-plan.md`, `proyectos/boni-calendar.md`).

Names that devices depend on stay as they were when folders moved: the desktop package `boni-calendar-desktop` (its
userData folder and the `.deb`), the Android `applicationId` and the workflow file `android.yml` (its run number is the
`versionCode`), the Obsidian plugin id `boni-calendar`, the IndexedDB stores `boni-calendar-server*`, the server's start
log line and the Docker image tag on the NAS.

## Layout

```
packages/calendar/ Pure TypeScript, no DOM: civil-day/timezone math (time.ts), data model (model.ts), overlap and
                 lane layout (layout.ts), per-day segments (queries.ts), quick-create text parser (quick.ts),
                 deterministic sample data (sample.ts). Collections (phase 2): typed tables, calendar views with
                 column mappings and row providers (collections.ts, projection.ts, codec.ts, provider.ts,
                 validate.ts, sampleCollections.ts). Notes with YAML properties (notes.ts: `parseNote`, `patchNote` change only
                 the edited lines, `formatNote`). iCalendar feeds into read-only events (ical.ts, `parseIcal`). Vitest.
packages/entities/ The core's data model (pure, no I/O; docs/nucleo.md, 4): types, fields and values (`checkValue`,
                 `convertValue`), provenance labels (`join` keeps the lowest integrity and the highest sensitivity;
                 `derive` marks values a plan computed, which `canBeDestination` refuses) and schema operations
                 (`applySchemaOp`: each returns its inverse; Boni's own types only with `{ system: true }`). Values are
                 kept by field id; keys are ASCII. Property tests use a seeded generator (`random.test-util.ts`).
packages/store/  One SQLite per user (`openUserStore`, node:sqlite, no native modules): entities, links, a label per
                 field (`field_prov`, raised to the field's and type's sensitivity), an FTS5 index, and an operation log
                 with before and after. Undo is a new operation (`undo`, `undoRun` for a whole agent run, all or
                 nothing); it refuses while a later change of the same entity is still in effect. `null` is never
                 stored (same as a missing key). `readQuery` runs SELECTs under an authorizer (readable tables only,
                 no pragmas but `data_version`, no `load_extension`). Keys: a data key per user, stored only wrapped
                 (`wrappedKeyProvider`); backups are `VACUUM INTO` sealed with it (AES-256-GCM).
packages/identity/ The single Boni account (system.db; docs/nucleo.md, 6): accounts made by the admin (`src/cli.ts`),
                 devices with a trust level (personal / shared / ambient; only another personal device raises it),
                 sessions stored as sha256 of the token (same scrypt and token hashing as both old servers, so
                 `import-accounts` moves their accounts and sessions and devices stay logged in), account data,
                 push addresses, and each account's data key, wrapped (`wrappedKeysIn` for @boni/store). The
                 servers still use their own accounts until the server moves onto it (plan PR 6).
packages/net/    Safe outbound HTTP (`fetchText`): public addresses only, checked by the `lookup` Node connects with
                 (no DNS rebinding), every redirect again, IPv4 hidden in IPv6 judged as IPv4, size and time limits.
                 Every download the server or the agent makes on someone's behalf goes through it (today `feeds.ts`).
apps/calendar-web/ React 19 + Vite UI. Runs in any browser and inside the desktop shell.
  src/engine/    Viewport (smooth scroll / zoom / horizontal motion) and the per-day event index.
  src/components/ TimeGrid (day, week, N days), MonthView, Sidebar, EventDetail, Modals, ...
  src/store.ts   zustand store: data, settings, view, selection, drag, undo history.
apps/calendar-desktop/  Electron shell (chosen over Tauri after measuring, see docs/rendimiento.md): window, packaging (.deb, AppImage).
                 Background mode (`desktop-prefs.cjs`, `window.boniDesktop`): closing hides to the tray, optional
                 autostart entry (`--hidden`), so reminders arrive with the window closed. `vault-fs.cjs` is the
                 only code that touches the vault's files (confined to the root, never `private/` or `restricted/`,
                 atomic writes with a conflict check); the UI reaches it through `window.boniVault` (`vaultBridge.ts`).
apps/obsidian-plugin/  The same app as an Obsidian plugin (desktop only, `make plugin`): `main.ts` registers a tab, a
                 ribbon icon and a command and reads nothing until the tab opens (after `onLayoutReady`);
                 `view.ts` mounts the app in a shadow root (Obsidian's CSS and ours never meet) and leaves the
                 calendar's Mod shortcuts to it through the view's `Scope`; `bridge.ts` is the `VaultBridge`
                 over Obsidian's API (`vault.process`, `fileManager.renameFile` / `trashFile`, vault events),
                 unit-tested against `fakeObsidian.ts`. Writing is on by default there; one calendar tab at a
                 time (the store is a singleton). The index lives in IndexedDB (`cache.ts`), settings in
                 `app.saveLocalStorage`: per device, never in `.obsidian/` (Syncthing carries it).
apps/calendar-android/ The same app on Android (Kotlin shell, `make`-less: CI builds it, android.yml): the built web UI in a
                 WebView from the APK's assets. `AndroidBridge.kt` is `window.boniAndroid` (async calls, answers
                 fetched with `take`; web side `src/android.ts`): the vault through the Storage Access Framework
                 (`VaultSaf.kt`, folder chosen once; same rules as vault-fs.cjs, trash = the vault's `.trash`), index
                 in the app's files, downloads for external calendars. Signed releases (secrets) for Obtainium.
                 Reminders: `Notices.kt` (exact alarms + notifications, re-armed at boot), `ServerSync.kt` (with a
                 server the app fetches `/api/reminders` itself: on a UnifiedPush message via `BoniPushService.kt`,
                 connector 3.0.x, at boot and every few hours).
apps/server/     Boni Calendar Server (docs/servidor.md): Node 24 running TypeScript directly, no build. Reuses
                 packages/calendar, the web's vault loader (`loadVault`), writer (`vault/provider.ts`) and the desktop's
                 `vault-fs.cjs`, so it reads and writes the vault with the apps' rules; the vault stays the truth.
                 Node only strips types there: no parameter properties or enums in any file the server imports
                 (`write.test.ts` loads the server the way its container does). SQLite (`node:sqlite`) only for
                 accounts (made by the admin, `src/cli.ts`), sessions (token hashes) and per-account data. API: snapshot,
                 changes since a version, live stream (SSE), `POST /api/apply` (only with `BONI_WRITE=1`; per-row
                 version check, a session's own writes are not conflicts); serves the web app; CORS open.
                 With writing on it tops up open-ended series itself (`topUpSeries`, after changes and every 6 h).
                 Client side: `apps/calendar-web/src/remote.ts` (login, snapshot, changes, live stream with reconnection, last
                 snapshot in IndexedDB) and the store's `source: "server"` (`connectServer`, `loadServer`), which applies
                 server data through the same path as a vault read (`applyLoad`). Its rows are notes too (id = path),
                 so "Open note in Obsidian" works there as well (a host without a vault folder opens
                 `obsidian://open?file=`, Obsidian's open vault). Writes: `serverWriter.ts` is the store's provider
                 there (optimistic, outbox in IndexedDB sent in order, pending changes shown over the server's
                 rows until its stream brings that version, temporary ids mapped through `aliases`). Phase 4: the
                 account's prefs (`ACCOUNT_PREFS` in store.ts) and external calendars live on the server
                 (`account.ts`, the list encrypted with `secret.ts`; `feeds.ts` downloads them, public addresses
                 only); the store syncs them (`syncAccount`, `pushAccount`, "account" stream event). Dockerfile for the NAS.
bench/           Smoothness benchmark runners and results. e2e/  Playwright tests and screenshots.
docs/            decisions and status. docs/nucleo.md: the approved design of the Boni core this repo is growing into.
legacy/boni/     the first Boni (repo boni-pruebas, archived) with its history, real names replaced. Reference only:
                 not built, linted or tested here; delete each piece once it is ported to the core.
```

## Commands (use the Makefile)

- `make setup` install dependencies · `make dev` UI dev server · `make check` lint + types + unit tests
- `make e2e` Playwright (uses the system Chrome; screenshots land in `e2e/screenshots/`)
- `make desktop` run the Electron app · `make package` build `.deb` + AppImage into `release/`
- `make bench-chrome` / `make bench-electron` smoothness benchmark in a real window (see `docs/rendimiento.md`)
- `make plugin` build the Obsidian plugin · `make install-obsidian VAULT=/path/to/vault` copy it into a vault
- `make e2e-obsidian` / `make bench-obsidian` the plugin in the Obsidian installed here (`OBSIDIAN_BIN`, default
  `/opt/Obsidian/obsidian`), always on a temporary profile and an invented vault (`e2e-obsidian/obsidian.ts`); not in CI

## Rules

- **Design consistency:** `docs/design-guide.md` is the visual and interaction reference for *all* Boni apps (this one is
  the reference). Read it before touching the UI and update it in the same PR as any visual or behavioural change.

- **Hosts:** the app runs standalone (browser tab, desktop shell) or inside another app (the Obsidian plugin). Everything
  it needs from where it runs comes through `src/host.ts` (`mountApp` in `mount.tsx`): the vault bridge, a small storage
  for settings and UI state, and whether it owns the window. So in UI code: no `window.boniVault` or `localStorage`
  (use the host), no `document.querySelector` / `elementFromPoint` (use `findInApp` / `elementsAt`), `eventTarget(e)`
  instead of `e.target` in window listeners (shadow roots retarget it), keyboard listeners only through `onKeys` (in
  another app shortcuts work only while the calendar has the focus), overlays positioned inside `appRect()` (the app's
  root is their containing block) and `cqh`/`cqw` instead of `vh`/`vw`. `styles.css` is scoped at build time
  (`scopeCss.ts`): `:root` there means the app's root (theme, `mod-select`), every other selector ends up under it.
  `e2e/embed.spec.ts` mounts the app inside a stand-in host page (`embed.html`, built only for the tests).
  Network downloads go through `host.fetchText` (desktop: the main process, `net:fetch-text`; Obsidian: `requestUrl`).

- **External calendars** (`src/external.ts`): subscriptions by iCal address, read-only. Their address lives in
  `settings.externals` (device storage, never the vault: a private address is a secret; with a server, the account
  keeps them encrypted and downloads them), the last copy in IndexedDB.
  The store merges them into `data` (`withExternal`) but they are never rows: `reconcileRows` only ever sees the own
  events (`isExternalEvent` filters them out), so nothing of them can reach a provider or the vault.

- **Language:** code, comments, commits and AI-facing docs in English. UI strings only through `src/i18n.ts`
  (Spanish first, English second, real accents in the UI). Docs for Juan in `docs/` are Spanish.
- **No personal data, ever.** The repo is public. Sample data is invented (`ejemplo.*@example.*`); no hostnames,
  tokens or paths of Juan's machines. Secrets never go in the repo.
- **Time:** events store instants (epoch ms) + an IANA timezone, all-day events store civil days. All wall-clock
  math goes through `packages/calendar/src/time.ts`. Never use `Date` local getters in UI code.
- **Performance rules for the grid (they are what keeps it at 60 fps):**
  - Wheel input only moves targets in `Viewport`; per-frame work writes `transform` / `height` to a handful of
    elements directly (no React state, no CSS variables that cascade over the events).
  - Event and label positions are percentages of the column height, never `calc(var(--hh) ...)` per element.
  - Zoom is a compositor `scaleY` while animating and one real re-layout when it settles (`ZOOM_STRETCH_LIMIT`).
    Text (`.ev-body`, hour labels, now label) is counter-scaled with `--inv` and sits on its own layers
    (`will-change: transform`) so letters keep their size during the animation.
  - Only a few days around the viewport are rendered (`BLOCK` in `TimeGrid.tsx`).
  - Re-run `make bench-chrome` after touching the grid and compare with `bench/results/`.
- **Sharp text (pixel alignment):** anything that sits on a GPU layer must sit on whole device pixels, or its text is
  resampled and looks soft. So: strip translations are snapped (`snapPx`), column width and month row height are whole
  device pixels, the committed hour height is a multiple of `HH_STEP` (4 px, so a 15-minute slot is whole pixels), boxes that
  are centred with `translateY(-50%)` have an even explicit height, popover positions are rounded, and text layers
  (`will-change`) exist only while zooming (`.zoom-armed`). `e2e/interactions.spec.ts` ("layout sits on whole pixels") guards it.
- **The vault (phase 2, step 2):** the app reads `_system/colecciones/*.md` (one definition per collection: folder, columns,
  mapping; `collectionDef.ts`) and then every note of each folder (`apps/calendar-web/src/vault/loadVault.ts`, through
  `window.boniVault`). Row id = note path; every property of a note is kept in the row, the columns only choose what the
  calendar shows, so unknown keys survive an edit. The vault is shown read-only until writing lands. Notes it cannot place
  are listed in Settings, never hidden. `vault/sync.ts` keeps an index of parsed notes (kept in memory and in
  `userData/vault-index-*.json`, never in the vault or the repo): a note is read and parsed again only when its mtime or
  size changed, an unchanged note keeps the very same row object, and a watcher (`vault-fs.cjs`, plus window focus)
  triggers a cheap re-scan. Anything that compares definitions must keep object identity when they did not change. Never put real titles, paths or note contents in the repo (tests use invented notes).
  **Writing** (opt-in, `settings.vaultWrite`): `vault/provider.ts` turns row changes into note changes: only differing
  properties are patched (`patchNote`), a new row becomes a note once it has a title (until then the UI shows it as a
  draft, `newEventId`: a tinted range only, dropped by `discardDraft` when its detail closes untitled) (name from `newNote.name`, counter on the
  file name only), a row that changes collection moves its file (and its `Area:` line), a removed row goes to the system
  trash (text kept in memory so Undo can restore it), existing notes are never renamed, and a note whose mtime changed since
  it was read is never overwritten (`VaultWriteError` conflict -> toast and reload). Reads and writes share one lock
  (`withLock` in `vault/sync.ts`). A new row keeps its temporary id for the session (`aliases` maps it to the path).
  **Series in the vault are separate notes, never a master** (`series.ts` in core; the calendar's mapping has
  `series: { id, rule }`, two text columns): every note of a series is a plain event with the same `series` id and the rule.
  Repeating an event creates one note per occurrence up to 12 months ahead (`makeSeries`); on every read with writing on,
  open-ended series are topped up after their last note (`extendSeries`, never refilling gaps); edits and deletions go through
  `editSeries` with the same this/following/all scope (marking done only touches that note; deleting "all" only removes notes
  from today on; a deletion that takes the end ends the series with an `until`); changing the rule replaces the later notes.
  A calendar maps `series` or `recurrence`, not both.
  **Reminders** (phase 5, `reminders.ts` in core): a definition's `reminders: { timed: "10m", allDay: "0d@09:00" }` are its
  calendar's defaults (`CalendarView.reminders`); an event's own list lives in a text column mapped as `reminders`
  ("1h, 10m", "none"; empty = the calendar's), added to the definition the first time an event needs it. Definitions are
  changed only through `vault/definitions.ts` (`patchCollectionReminders`, those lines only; the server does the same via
  `PUT /api/collections/reminders`). `upcomingAlerts` (core) and `noticesFor` (web) make the notifications; hosts show them
  through `host.notify` (desktop: `boniNotify`, main-process timers).
- **Rows are the truth (phase 2):** the store keeps `collections`, `views` and `rows`; `data.events`, `data.calendars` and
  `data.projects` are *derived* (events are the projection of rows through each calendar's mapping, memoised per row
  object). Never write them: edit through the store actions, which turn event changes into row changes (`reconcileRows`)
  and hand them to the `CollectionProvider`. `isTask`/`done` come from the calendar's task column (`supportsTasks`).
- **Recurring events:** a series is ONE stored event (the "master": `recurrence`, `exdates`) and is never rendered
  directly. `expandAll` (core) turns it into occurrences (`id = "<master>~<day>"`, `seriesId`, `occurrenceDay`) for the
  window the views publish (`store.win`, with hysteresis). All edits and deletions go through `editOccurrence` with a
  scope (`this` / `following` / `all`) via the store (`editEvents`, `removeEvents`, `finishDrag`), which ask the user
  when a series is involved. Never write to `data.events` directly with an occurrence id.
  Keep occurrence objects stable (`OccurrenceCache`) - segments and layouts are cached on object identity.
- **Month view rows** are positioned relative to an epoch (`EPOCH_WEEKS`) so scrolling never moves existing rows
  (moving them repaints the whole layer). Keep row props stable so `WeekRow` stays memoised.
- **Text fits its box:** labels of controls never wrap and nothing sticks out of its box. Fix it with the general layout
  rule in `styles.css` (rows wrap the control under the label; controls ellipsize), never with a per-element patch.
  `e2e/overflow.spec.ts` walks every surface in both languages and at a narrow window: a new surface must be added there.
- **Tests:** pure logic in `packages/calendar` and `apps/calendar-web/src/engine` gets unit tests; user-visible behaviour gets a
  Playwright test and, when the look changes, a screenshot check by eye.
- **Test it the way Juan uses it** (vault `AGENTS.md`, "Working with Juan") before asking him: the server locally with the built
  web app (`BONI_WEB=apps/calendar-web/dist BONI_WRITE=1`, an invented vault in the scratchpad), phone-sized viewports, and the real
  desktop app on his X11 screen with Playwright's `_electron` (`--user-data-dir` and `XDG_CONFIG_HOME` temporary, never his
  config). The desktop shell loads `apps/calendar-desktop/web/` (the copy from the last `make package`) when it exists: run
  `node scripts/copy-web.mjs` there first. Screenshots on his screen: the app window (`page.screenshot`) or a crop, never the
  full screen; delete them afterwards. Tests type at a person's pace where timing matters (a fast `fill` hid a bug).
- Biome is the linter/formatter; React hook dependency lint is off on purpose (the grid is an imperative engine).
