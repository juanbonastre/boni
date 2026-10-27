# Rules for Boni Calendar (`apps/calendar-web`, `packages/calendar`)

For agents, read with the root `AGENTS.md` before changing the calendar. These rules keep it correct and at 60 fps;
tests guard most of them.

## Data

- **Rows are the truth.** The store keeps `collections`, `views` and `rows`; `data.events`, `data.calendars` and
  `data.projects` are derived (events are rows projected through each calendar's mapping, memoised per row object).
  Never write them: edit through the store actions, which turn event changes into row changes (`reconcileRows`) and
  hand them to the `CollectionProvider`. `isTask` and `done` come from the calendar's task column (`supportsTasks`).
- **A calendar is a view of a collection with a date** (`docs/clases.md`): nothing in the code names a user's
  collections or fields.
- **Repetitions** come in two kinds, and a calendar maps one or the other:
  - A master that expands (`recurrence`, `exdates`). It is never rendered directly: `expandAll` turns it into
    occurrences (`id = "<master>~<day>"`, `seriesId`, `occurrenceDay`) for the window the views publish (`store.win`,
    with hysteresis). Edits and deletions go through `editOccurrence` with a scope (`this` / `following` / `all`) via
    the store (`editEvents`, `removeEvents`, `finishDrag`), which ask the user. Never write to `data.events` with an
    occurrence id; keep occurrence objects stable (`OccurrenceCache`): segments and layouts are cached on identity.
  - A series kept as one row per occurrence (`series: { id, rule }`, `series.ts`). Repeating creates rows up to 12 months
    ahead (`makeSeries`); open-ended series are topped up after their last row (`extendSeries`, never refilling gaps);
    `editSeries` takes the same scopes; marking one done touches only that row; deleting «all» removes only the rows
    from today on, and a deletion that takes the end ends the series with an `until`.
- **Reminders** (`reminders.ts`): a calendar's defaults (`CalendarView.reminders`) and an event's own list in a text
  column mapped as `reminders` («1h, 10m», «none»; empty = the calendar's). `upcomingAlerts` (core) and `noticesFor`
  (web) make the notifications; the host shows them (`host.notify`).
- **External calendars** (`src/external.ts`): read-only iCal subscriptions. The address is a secret (device storage,
  or the account's, encrypted); the last copy is in IndexedDB. They are merged into `data` (`withExternal`) but are
  never rows: `reconcileRows` never sees them (`isExternalEvent`), so nothing of them reaches a provider.
- **The vault mode** (a folder of notes read from the disk: `src/vault/`, `vault-fs.cjs`, the Android folder bridge) is
  being removed (`docs/clases.md` §4): do not extend it.

## Hosts

The app runs on its own (browser tab, desktop shell, Android WebView) or inside another page. Everything it needs from
where it runs comes through `src/host.ts` (`mountApp` in `mount.tsx`): storage for settings and UI state, whether it
owns the window, notifications and downloads (`host.fetchText`). In UI code: no `localStorage` (use the host), no
`document.querySelector` or `elementFromPoint` (`findInApp`, `elementsAt`), `eventTarget(e)` instead of `e.target` in
window listeners (shadow roots retarget it), keyboard listeners only through `onKeys`, overlays positioned inside
`appRect()`, and `cqh`/`cqw` instead of `vh`/`vw`. `styles.css` is scoped at build time (`scopeCss.ts`): `:root` there
means the app's root. `e2e/embed.spec.ts` mounts the app inside a stand-in host page.

## The grid at 60 fps

- Wheel input only moves targets in `Viewport`; per-frame work writes `transform` / `height` to a handful of elements
  directly (no React state, no CSS variables that cascade over the events).
- Event and label positions are percentages of the column height, never `calc(var(--hh) ...)` per element.
- Zoom is a compositor `scaleY` while animating and one real re-layout when it settles (`ZOOM_STRETCH_LIMIT`). Text
  (`.ev-body`, hour labels, the now label) is counter-scaled with `--inv` and sits on its own layers
  (`will-change: transform`) so letters keep their size during the animation.
- Only a few days around the viewport are rendered (`BLOCK` in `TimeGrid.tsx`).
- Month rows are positioned relative to an epoch (`EPOCH_WEEKS`) so scrolling never moves existing rows; keep row props
  stable so `WeekRow` stays memoised.
- After touching the grid, run `make bench-chrome` and compare with `bench/results/` (`docs/rendimiento.md`).

## Sharp text

Anything on a GPU layer sits on whole device pixels, or its text is resampled and looks soft: strip translations are
snapped (`snapPx`), column width and month row height are whole device pixels, the committed hour height is a multiple
of `HH_STEP` (4 px, so a 15-minute slot is whole pixels), boxes centred with `translateY(-50%)` have an even explicit
height, popover positions are rounded, and text layers (`will-change`) exist only while zooming (`.zoom-armed`).
`e2e/interactions.spec.ts` («layout sits on whole pixels») guards it.

## Text, tests and trying it

- Labels of controls never wrap and nothing sticks out of its box: fix it with the general layout rule in `styles.css`
  (rows wrap the control under the label; controls ellipsize), never with a per-element patch. `e2e/overflow.spec.ts`
  walks every surface in both languages and at a narrow window: a new surface goes there.
- Pure logic in `packages/calendar` and `src/engine` gets unit tests; user-visible behaviour gets a Playwright test and,
  when the look changes, a screenshot checked by eye.
- The desktop shell loads `apps/calendar-desktop/web/` (the copy from the last `make package`) when it exists: run
  `node scripts/copy-web.mjs` there before trying the desktop app from the repo. `make e2e-calendar-desktop` drives it
  for real (it opens windows; not in CI).
