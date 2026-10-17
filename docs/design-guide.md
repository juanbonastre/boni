# Boni design and interaction guide

**Boni Calendar (desktop) is the reference.** Every Boni app (Boni desktop and its widgets, the Android clients, the
Boni Calendar mobile app, the Obsidian plugin) must look and behave like it. When something is not specified here, copy
what Boni Calendar does. Changes to the look or the behaviour start in Boni Calendar, are recorded here in the same pull
request, and then propagate to the other apps. A deviation needs a written reason in the deviating app's docs.

Authoritative sources: this file, the tokens in `apps/web/src/styles.css` (`:root` and `:root[data-theme="light"]`), and the
behaviour covered by `e2e/`. Validated by Juan on the desktop app up to version 0.3.2; the mobile section is a proposal for later.

## 1. Principles
- Calm and dense: graphite surfaces, one accent colour, thin lines, no decoration. Colour means *which calendar*.
- Direct manipulation: drag to create, move and resize, with a live preview while dragging. `Esc` cancels any gesture.
- No confirmation dialogs. Destructive actions happen at once and offer **Undo** in a toast (and `Ctrl+Z`). The only
  question we ask is the "this / this and following / all" scope for a recurring event.
- Keyboard first, but never keyboard only: everything also has a visible control or a context menu. Nothing is
  hover-only.
- Smooth: 60 fps while scrolling, zooming and dragging is a requirement, not a nice-to-have (`docs/rendimiento.md`).
- Text never stretches or jumps when the layout moves (zoom keeps letter sizes), and it is always pixel-sharp: boxes, offsets
  and column or row sizes are whole device pixels (see `AGENTS.md`, "Sharp text").

## 2. Visual tokens
| Token | Dark (default) | Light |
|---|---|---|
| `--bg` | `#16171a` | `#ffffff` |
| `--surface` | `#1d1e22` | `#ffffff` |
| `--surface-2` | `#232429` | `#f5f5f7` |
| `--sidebar` | `#121316` | `#f3f3f6` |
| `--line` / `--line-soft` / `--line-strong` | `#25262b` / `#1f2024` / `#34363d` | `#e6e6ea` / `#efeff2` / `#d4d4db` |
| `--text` / `--muted` | `#e9eaed` / `#8b8f99` | `#1b1c20` / `#666a75` |
| `--accent` / `--accent-soft` | `#7b8cff` / 16 % accent | `#4b5ce0` / 12 % accent |
| `--now` (current time, today) | `#ff5f5f` | `#e5383b` |
| `--hover` | white 6 % | black 5 % |
| Shadow (menus, popovers) | `0 12px 40px #0008, 0 2px 8px #0006` | softer, bluish |

Calendar palette (colour of a calendar, always from this list): violet `#a78bfa`, orange `#fb923c`, coral `#f87171`,
amber `#fbbf24`, green `#4ade80`, teal `#2dd4bf`, sky `#38bdf8`, blue `#60a5fa`, pink `#f472b6`, red `#ef4444`,
slate `#94a3b8`.

- **Type:** Inter, then the system stack. Base 13 px / 1.4. Month title 22 px, weight 650, year in `--muted`. Small text
  11 to 12.5 px. Times and numbers use tabular figures.
- **Radii:** 6 (small controls, event cards), 7 to 8 (buttons, pills, inputs), 10 (menus, cards), 12 (popover), 14 (modals).
- **Sizes:** controls 28 to 30 px high, icon buttons 28 px square, menu rows 30 px. Sidebar 252 px, top bar 62 px, event
  popover 340 px, side panel 352 px, hour gutter 64 px.
- **Icons:** Lucide, 14 to 16 px, stroke 1.8, `--muted` until hovered. No product or brand icons.
- **Event card:** background = calendar colour mixed into `--bg` at 24 % (dark) or 20 % (light); text = calendar colour
  mixed into `--text` (30 % dark, 55 % light); 3 px solid left border in the calendar colour; hover +8 % tint; selected =
  2 px `--accent` ring; done tasks 60 % opacity with strike-through; recurring events carry a small repeat icon.
- **Today:** day number in an `--accent` circle, column tinted 4 %; the current time is a `--now` line with a dot and a
  label in the hour gutter.
- **Hidden calendars:** hollow swatch, muted name, struck eye icon.

## 3. Patterns
- Top bar: title (month in bold, year muted), view picker, "Today", previous/next, detail-panel toggle.
- Sidebar: mini month whose highlighted band is exactly the visible days, calendars grouped by account with colour
  swatch, eye (and a properties gear on hover), search and new-event buttons on top, settings at the bottom.
- Event detail header: (open note in Obsidian, only for events that have a note), more, expand, close. The detail is a popover anchored to the event; the expand button turns it into a right side panel. Fields in order:
  title, date and times, repeat, calendar, type (Event / Task) and done (only when the calendar maps a task column),
  calendar properties, location, description, read-only id and timestamps.
- Context menus (right click or long press) on events, empty time slots, month cells and calendars; the same actions as
  the detail where they exist. Several selected events: actions apply to all and show "(n)".
- Calendar properties dialog (sidebar gear, context menu): name, colour, **Calendar view** (which column of each row plays
  date, start and end time, end date and tasks; a status column also asks "Done when"), then **Other properties** (the
  columns the view does not use, each with its type and options). Mapped columns never appear twice: they are controls of
  the event (date, times, task), not properties. A calendar is a view of a collection of rows; rows are the truth.
- Day headers show the weekday and the number; when a column is too narrow for both (a side panel, a pane of
  another app) only the number stays.
- Command palette (`Ctrl+K`): commands, event search, "go to date" and natural-language quick create
  ("clase FUP manana 10-12 #docencia").
- Toasts at the bottom centre with an Undo action. A floating selection bar appears with two or more selected events.
- **Text never wraps inside a control** (buttons, segmented options, chips, menu items, selects) and never sticks out of
  its box. Layout makes room instead: a row that pairs a label with a control (settings, properties) puts the control under
  the label when both do not fit, and a control that still does not fit cuts its label with an ellipsis. Menus align to stay
  inside their popover. One rule in `styles.css`, guarded by `e2e/overflow.spec.ts` on every surface, in both languages
  and at a narrow window.

## 4. Interaction rules
- **Wheel:** vertical scroll; `Ctrl` + wheel zooms the hours around the pointer; `Shift` + wheel moves across days and
  settles on a whole day. Motion is exponentially smoothed (about 70 to 85 ms time constants) and never snaps.
- **Views:** day, week, N days (2 to 14), month. First weekday and 12/24 h are settings (default Monday, 24 h).
- **Shortcuts:** `T` today, `D` `W` `M` views, `1` to `9` N days, arrows or `J`/`K` previous and next, `N` or `/` palette,
  `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo, `Delete` delete selection, `Ctrl+A` select visible, `[` sidebar, `Ctrl+,`
  settings, `?` help, `Esc` closes or cancels.
- **Dragging:** drag on empty space to create (default 15-minute snap, setting), drag a card to move, drag its top or
  bottom edge to resize. Edges follow the pointer in both axes, so dragging into the next or previous day's column
  makes an event cross midnight. All-day events move and resize by whole days, in the all-day row and in the month.
  Dragging near the top or bottom edge auto-scrolls.
- **Selection:** click selects one and opens its detail; `Shift`+click adds the range from the anchor in chronological
  order; `Ctrl+Shift`+click adds or removes one event. Dragging one selected event moves all of them. Click on empty space
  or `Esc` clears. While `Ctrl`/`Shift` is held the popover lets clicks through, except while typing in a field (`Shift`
  for a capital letter must not fade it).
- **Ctrl+click opens the event's note** (like a link in Obsidian): in Obsidian in a tab, from the desktop app in
  Obsidian. An event without a note (sample data, not saved yet) is just selected. Decided by Juan, 2026-10-16; until
  then `Ctrl`+click toggled the selection and `Ctrl+Shift`+click added a range of one calendar.
- **Series in the vault:** repeating an event creates one note per occurrence (up to 12 months ahead; open-ended series are
  topped up whenever the vault is read with writing on, with a toast saying how many were created). The same "this / this and
  following / all" question applies; "all" on a deletion keeps the past notes (the dialog says so); marking a task done only
  changes that note; changing the repetition rule replaces the later notes with the ones the new rule makes.
- **Recurrence:** editing, moving or deleting an occurrence asks "Only this event / This and following events / All
  events" (cancel is always possible). Changing the repetition rule itself applies to the whole series.
- **Tasks:** an event can be switched to Task in the detail or the context menu; tasks show a checkbox in the card. A
  calendar offers this only if its view maps a task column: a checkbox column (empty = event, unchecked = open task,
  checked = done) or a status column with chosen done states. Calendars without one show no Event / Task controls.
- **Read-only calendars** can be selected but not edited or dragged: their detail shows every field disabled, and
  `Delete` on them only says "Read-only calendar" (no scope question).
- **External calendars** (Settings → External calendars, or "Add external calendar" under the sidebar's calendars):
  other services' calendars (Google Calendar...) by their iCal address, read-only, in their own sidebar group with
  colour and eye like any other. Each row in Settings shows how many events came and when, or why the download
  failed (refresh, edit, remove next to it). The last copy shows without a connection; they refresh when the app
  opens and every half hour. The address of a private calendar is a secret: it stays on the device, never in the
  vault. A repetition the app cannot repeat (e.g. "second Tuesday") shows once and Settings says how many.
- **Data from a server** (Settings → Data → Source: Local folder | Server; a plain browser only has Server): address, user,
  password; the device keeps only a session token. The calendar opens on the last copy kept on the device, then follows the
  server live; Settings says "Live", "Offline: showing the last copy" or "The session ended: log in again". Read-only until
  writing through the server lands.
- **Data in the vault** (desktop app, Settings → Data): the calendars are always the vault's notes (the invented sample
  data only shows in a plain browser, for development and tests); writing is opt-in ("Read only" / "Read and write"). With it on, the
  gestures above change the notes: only the edited properties are rewritten (unknown ones, comments and the body stay as
  they were), a new event becomes a note when it has a title (file `{date} {title}.md`, with a counter on the file name if
  taken), moving it to another calendar moves its file, deleting sends it to the trash and Undo brings it back. If a note
  changed outside the app since it was read, nothing is written: a toast says so and the notes are reloaded. Notes the
  calendar cannot place are listed in Settings, never hidden.
- Every edit is optimistic and undoable; one gesture is one undo step.

## 5. Language and copy
Spanish first, English second, all through `src/i18n.ts` (no hard-coded text). The UI uses proper Spanish with accents
(the "no accents" rule belongs to generated vault notes and chat, not to the product). Labels are short and imperative;
dates use the locale (`Mie 17 sep '25`); durations as `1h 15min`.

## 6. Adapting it to other platforms
- **Boni desktop / Android clients (Compose):** same hex tokens, radii, type scale and event-card recipe. Until there is a
  second web consumer, copy the values from section 2; when it exists, move them to a shared tokens file (JSON) that both
  the CSS and the Compose theme are generated from.
- **Obsidian plugin:** uses these tokens, scoped to the plugin's own container, so it looks like Boni Calendar inside Obsidian
  (decided by Juan, 2026-10-15; it does not follow Obsidian's theme variables). It is the same app, mounted in a pane: popovers,
  menus, dialogs and toasts stay inside that pane, and the keyboard shortcuts work only while the calendar has the focus (a
  click anywhere in it gives it the focus; `Esc` keeps it there), so typing in a note never reaches the calendar. While it
  has the focus, the calendar's `Ctrl` shortcuts (`Ctrl+K`, `Ctrl+,`, `Ctrl+Z`...) are its own, not Obsidian's. It opens
  from the ribbon icon (calendar) or the command "Abrir Boni Calendar", in one tab (the command brings that tab
  forward), and lives in a shadow root so neither Obsidian's theme nor its class names reach it. In Obsidian the
  calendar always shows the vault it runs in (Settings → Data offers no folder to choose) and writes to it from
  the start, with the same rules as the desktop app; "Open note" opens the note in a tab, or brings forward the tab
  that already shows it. Installed by hand (`make install-obsidian VAULT=...`), not from the community catalogue.
- **Mobile** (the Android app, `apps/android`: the same web app in a WebView, so the look is the desktop's by construction;
  also any pane narrower than 640 px): same tokens and card recipe. It opens on three days. The sidebar is a drawer over
  the calendar (top-left button; it closes on a tap outside or once a day is chosen); the detail is a sheet at the bottom
  (expanded, full screen); "new event" is a floating button (next whole hour, today). Fingers: a swipe scrolls the hours
  and glides on, a sideways swipe moves days and settles on a whole day, two fingers zoom the hours; a tap selects and
  opens the detail; a long press then a drag creates, moves or resizes exactly like the mouse; a long press without moving
  opens the context menu. Nothing is hover-only on a touch screen, resize edges are taller, the system Back button closes
  what is open, and the calendar keeps clear of the status and navigation bars. Undo through the toast. On Android the vault's
  folder is chosen once (Settings → Data → Choose, the system folder picker); "Open note" opens it in Obsidian.
  GrapheneOS lets the user take network access away from an app (its "Network" permission, which no dialog can ask for);
  when it is off, Settings says so where the network is needed (server, external calendars) with a button that opens the
  app's permissions.

## 7. Keeping it consistent
- A pull request that changes look or behaviour in Boni Calendar updates this file.
- Another Boni app that needs a new component first looks here; if the component is missing, design it in Boni Calendar's
  language, add it here, then reuse it.
- Screenshots in `e2e/screenshots/` (generated by the e2e suite) are the visual reference.
