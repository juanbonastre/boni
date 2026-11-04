# Rules for Boni Calendar (`apps/calendar-web`, `packages/calendar`)

For agents, read with the root `AGENTS.md` before changing the calendar. These rules keep it correct and at 60 fps;
tests guard most of them.

## Data

- **Rows are the truth.** The store keeps `collections`, `views` and `rows`; `data.events`, `data.calendars` and
  `data.projects` are derived (events are rows projected through each calendar's mapping, memoised per row object).
  Never write them: edit through the store actions, which turn event changes into row changes (`reconcileRows`) and
  hand them to the `CollectionProvider`. `isTask` and `done` come from the calendar's task column (`supportsTasks`).
- **A calendar is a view of a collection with a date** (`docs/clases.md`): nothing in the code names a user's
  collections or fields. Which collections show is the user's choice (D-23): the server offers every collection with
  a day and no calendar yet (`GET /api/collections/candidates`), «+ Añadir calendario» adds one
  (`POST /api/collections/add`) and «Quitar calendario» takes the view away (`POST /api/collections/remove`), never
  the records; the server's stream then brings a new snapshot. A definition **split by a field** (D-24) is one kept
  definition the server reads as a view per value: each view carries `group` (the definition and the field) and
  `split` (the field and the choices); `POST /api/collections/split` sets it, `POST /api/collections/color` keeps a
  colour. The sidebar folds a group's views under its name (`CalendarList.tsx`); their properties are the
  definition's (`Modals.tsx`). A colour by a field without splitting was built and taken out the same day (2026-11-03,
  Juan: only «Separar por», the colours from the swatches). The server reads the calendars (`calendarDefs`) from
  memory while the schema, the kept definitions and the records they read (a split collection's branch and its
  values' collections) do not change; a split collection's records are listed once per read, for all its nodes. The
  calendar asks every second and on every request (A-15).
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
- **A record linked to an external event** (task 50, `link.ts`): a text column mapped as `external` holds the
  external event's id (`ext:<calendar>:<uid>`, `~<day>` for one occurrence). `withExternal` applies `linkExternals`:
  the record shows at the external event's time and carries it as `linked`, the external event is absorbed (an
  occurrence becomes an exception of its master) and nothing is written; a link whose event is gone from a calendar
  that is here is `linkLost`, one whose calendar is not here is left alone. `isTimeLocked` keeps the grid from moving
  a linked record and the detail from editing its when. An external event's detail offers «¿Es «X»?» (`suggestLink`:
  the same moment and a like title, code only, never linked alone), «Enlazar» (`candidatesFor`, the records near it)
  and «Crear nota»; the record's detail has an «Enlace» row naming that calendar, with «Quitar enlace». The column is added the
  first time (`ensureLinkColumn` in the store; `POST /api/collections/link-column` on the server).
- **Writes go through `ServerWriter`** (`src/serverWriter.ts`): shown at once, queued on the device (IndexedDB) and
  sent in order; a batch carries the version the device had, and the server refuses it (409) only when one of its
  records changed elsewhere after that version. The queue waits while there is no connection, no session, the
  server is on its way (502, 503, 504: a deploy, the proxy) or it says too many (429), and goes when the stream is
  live again; any other failure drops the batch and says so (2026-11-04: a deploy's 502 dropped a new event).
  A move to another calendar leaves the queue as `diffRows` makes it (a removal, then the row in its new
  collection, same id); the server takes a batch's changes one per record, the last of each, so that pair is one
  move and a row made, titled and moved before the server answered is one record (2026-11-04: it went to the
  trash, or was made twice).
- **No vault mode** (2026-10-28): the calendar is a server's (or the invented sample). The desktop shell only says
  where an event's note opens (`window.boniNotes`: Boni or its peek); Android has no such bridge.

## Hosts

The app runs on its own (browser tab, desktop shell, Android WebView) or inside another page. Everything it needs from
where it runs comes through `src/host.ts` (`mountApp` in `mount.tsx`): storage for settings and UI state, whether it
owns the window, notifications and downloads (`host.fetchText`). In UI code: no `localStorage` (use the host), no
`document.querySelector` or `elementFromPoint` (`findInApp`, `elementsAt`), `eventTarget(e)` instead of `e.target` in
window listeners (shadow roots retarget it), keyboard listeners only through `onKeys`, overlays positioned inside
`appRect()`, and `cqh`/`cqw` instead of `vh`/`vw`. An outside address (an event's video call) opens through
`openUrl` in `host.ts` (the desktop's `shell.openExternal`, Android's intent, a browser's new tab; http(s) only):
the app never navigates away, and its windows deny `window.open` (task 49). `styles.css` is scoped at build time (`scopeCss.ts`): `:root` there
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
  for real (it opens windows; CI runs it on a virtual screen, I-06).
