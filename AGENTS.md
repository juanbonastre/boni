# AGENTS.md — Boni Calendar

Desktop calendar app with the UX of a modern day/week/month calendar, built for one user (Juan) and separate from the
Boni project. Phase 1 is the polished interface running on invented sample data; real data, sync and external
calendars come in phase 2. Project notes live in Juan's vault (`proyectos/boni-calendar.md`).

## Layout

```
packages/core/   Pure TypeScript, no DOM: civil-day/timezone math (time.ts), data model (model.ts), overlap and
                 lane layout (layout.ts), per-day segments (queries.ts), quick-create text parser (quick.ts),
                 deterministic sample data (sample.ts). Vitest.
apps/web/        React 19 + Vite UI. Runs in any browser and inside the desktop shell.
  src/engine/    Viewport (smooth scroll / zoom / horizontal motion) and the per-day event index.
  src/components/ TimeGrid (day, week, N days), MonthView, Sidebar, EventDetail, Modals, ...
  src/store.ts   zustand store: data, settings, view, selection, drag, undo history.
apps/desktop-electron/  Electron shell (chosen over Tauri after measuring, see docs/rendimiento.md): window, packaging (.deb, AppImage).
bench/           Smoothness benchmark runners and results. e2e/  Playwright tests and screenshots.
docs/            decisions and status.
```

## Commands (use the Makefile)

- `make setup` install dependencies · `make dev` UI dev server · `make check` lint + types + unit tests
- `make e2e` Playwright (uses the system Chrome; screenshots land in `e2e/screenshots/`)
- `make desktop` run the Electron app · `make package` build `.deb` + AppImage into `release/`
- `make bench-chrome` / `make bench-electron` smoothness benchmark in a real window (see `docs/rendimiento.md`)

## Rules

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
