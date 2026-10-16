# AGENTS.md — Boni Calendar

Desktop calendar app with the UX of a modern day/week/month calendar, built for one user (Juan) and separate from the
Boni project. Phase 1 is the polished interface running on invented sample data; real data, sync and external
calendars come in phase 2. Project notes live in Juan's vault (`proyectos/boni-calendar.md`).

## Layout

```
packages/core/   Pure TypeScript, no DOM: civil-day/timezone math (time.ts), data model (model.ts), overlap and
                 lane layout (layout.ts), per-day segments (queries.ts), quick-create text parser (quick.ts),
                 deterministic sample data (sample.ts). Collections (phase 2): typed tables, calendar views with
                 column mappings and row providers (collections.ts, projection.ts, codec.ts, provider.ts,
                 validate.ts, sampleCollections.ts). Notes with YAML properties (notes.ts: `parseNote`, `patchNote` change only
                 the edited lines, `formatNote`). Vitest.
apps/web/        React 19 + Vite UI. Runs in any browser and inside the desktop shell.
  src/engine/    Viewport (smooth scroll / zoom / horizontal motion) and the per-day event index.
  src/components/ TimeGrid (day, week, N days), MonthView, Sidebar, EventDetail, Modals, ...
  src/store.ts   zustand store: data, settings, view, selection, drag, undo history.
apps/desktop-electron/  Electron shell (chosen over Tauri after measuring, see docs/rendimiento.md): window, packaging (.deb, AppImage). `vault-fs.cjs` is the
                 only code that touches the vault's files (confined to the root, never `private/` or `restricted/`,
                 atomic writes with a conflict check); the UI reaches it through `window.boniVault` (`vaultBridge.ts`).
bench/           Smoothness benchmark runners and results. e2e/  Playwright tests and screenshots.
docs/            decisions and status.
```

## Commands (use the Makefile)

- `make setup` install dependencies · `make dev` UI dev server · `make check` lint + types + unit tests
- `make e2e` Playwright (uses the system Chrome; screenshots land in `e2e/screenshots/`)
- `make desktop` run the Electron app · `make package` build `.deb` + AppImage into `release/`
- `make bench-chrome` / `make bench-electron` smoothness benchmark in a real window (see `docs/rendimiento.md`)

## Rules

- **Design consistency:** `docs/design-guide.md` is the visual and interaction reference for *all* Boni apps (this one is
  the reference). Read it before touching the UI and update it in the same PR as any visual or behavioural change.

- **Language:** code, comments, commits and AI-facing docs in English. UI strings only through `src/i18n.ts`
  (Spanish first, English second, real accents in the UI). Docs for Juan in `docs/` are Spanish.
- **No personal data, ever.** The repo is public. Sample data is invented (`ejemplo.*@example.*`); no hostnames,
  tokens or paths of Juan's machines. Secrets never go in the repo.
- **Time:** events store instants (epoch ms) + an IANA timezone, all-day events store civil days. All wall-clock
  math goes through `packages/core/src/time.ts`. Never use `Date` local getters in UI code.
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
  mapping; `collectionDef.ts`) and then every note of each folder (`apps/web/src/vault/loadVault.ts`, through
  `window.boniVault`). Row id = note path; every property of a note is kept in the row, the columns only choose what the
  calendar shows, so unknown keys survive an edit. The vault is shown read-only until writing lands. Notes it cannot place
  are listed in Settings, never hidden. `vault/sync.ts` keeps an index of parsed notes (kept in memory and in
  `userData/vault-index-*.json`, never in the vault or the repo): a note is read and parsed again only when its mtime or
  size changed, an unchanged note keeps the very same row object, and a watcher (`vault-fs.cjs`, plus window focus)
  triggers a cheap re-scan. Anything that compares definitions must keep object identity when they did not change. Never put real titles, paths or note contents in the repo (tests use invented notes).
  **Writing** (opt-in, `settings.vaultWrite`): `vault/provider.ts` turns row changes into note changes: only differing
  properties are patched (`patchNote`), a new row becomes a note once it has a title (name from `newNote.name`, counter on the
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
- **Tests:** pure logic in `packages/core` and `apps/web/src/engine` gets unit tests; user-visible behaviour gets a
  Playwright test and, when the look changes, a screenshot check by eye.
- Biome is the linter/formatter; React hook dependency lint is off on purpose (the grid is an imperative engine).
