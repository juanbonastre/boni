# Boni design and interaction guide

**Boni Calendar (desktop) is the reference.** Every Boni app (Boni desktop and its widgets, the Android clients, the
Boni Calendar mobile app, the Obsidian plugin) must look and behave like it. When something is not specified here, copy
what Boni Calendar does. Changes to the look or the behaviour start in Boni Calendar, are recorded here in the same pull
request, and then propagate to the other apps. A deviation needs a written reason in the deviating app's docs.

Authoritative sources: this file, the tokens in `apps/calendar-web/src/styles.css` (`:root` and `:root[data-theme="light"]`), and the
behaviour covered by `e2e/`. Validated by Juan on the desktop app up to version 0.3.2; the mobile section is a proposal for later.

## 1. Principles
- Calm and dense: graphite surfaces, one accent colour, thin lines, no decoration. Colour means *which calendar*.
- Direct manipulation: drag to create, move and resize, with a live preview while dragging. `Esc` cancels any gesture.
- No confirmation dialogs. Destructive actions happen at once and offer **Undo** in a toast (and `Ctrl+Z`). The only
  question we ask is the "this / this and following / all" scope for a recurring event.
- Keyboard first, but never keyboard only: everything also has a visible control or a context menu. Nothing is
  hover-only.
- Easy to use before complete (Juan, 2026-10-21): group options into sections, show the common things first and put
  the rest behind a disclosure (a group that opens, with a one-line summary of what is inside, or "Más opciones"); one
  task per screen or panel; no long flat lists of controls; a choice among several values on many rows is a select,
  not a row of buttons. Judge each new surface on its screenshot as someone new to it would.
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

- **App icon:** Juan's logo (a graphite frame with a star, on a cream edge `#FFFCF3`): `apps/calendar-desktop/icon.png`
  (512 px), the web favicon (`apps/calendar-web/public/favicon.png`) and Android's adaptive icon (the logo inside the safe zone on a
  cream background). Generated from one source image; keep the three in step.
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
  calendar properties, location, description, read-only id and timestamps. When the location or the description
  carries a video call's link (Zoom, Meet, Teams, Webex, Jitsi, Whereby), one «Unirse» button sits under the head,
  outside the fields a read-only calendar locks, and every http(s) link of the event is a pill by its host in a
  «Enlaces» row before the id; both open through the host (the system's browser), never painted as HTML. In the
  day's grid the event's block carries a camera pill from ten minutes before its start until its end, as Notion
  Calendar does (task 49). An external calendar's event offers, under the head, «¿Es «X»?» with «Sí» when a record
  of the user's shares its moment and title, «Enlazar» (the records near it, the closest first) and «Crear nota» (a
  calendar of the user's); a linked record is one item in its own colour with the external calendar's colour on its
  right edge (half the month's dot), its time is the external event's and is not edited or dragged, and an «Enlace»
  row names the calendar it follows (the event's title and place as the tooltip), with «Quitar enlace» (task 50).
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
- **Switching views keeps the place:** to day or N days, today when it is on screen (from the month: in the month
  shown), otherwise the first visible day (from the month: the month's first day); to the week, today's week when today
  is in the month shown (from the month), otherwise the week in the middle of what was shown; to the month, the month of
  the middle of what was shown. A pane or window narrower than 640 px closes the sidebar (a drawer there); wide again,
  the sidebar is as it was.
- **Shortcuts:** `T` today, `D` `W` `M` views, `1` to `9` N days, arrows or `J`/`K` previous and next, `N` or `/` palette,
  `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo, `Delete` delete selection, `Ctrl+A` select visible, `[` sidebar, `Ctrl+,`
  settings, `?` help, `Esc` closes or cancels.
- **Dragging:** drag on empty space to create (default 15-minute snap, setting), drag a card to move, drag its top or
  bottom edge to resize. Edges follow the pointer in both axes, so dragging into the next or previous day's column
  makes an event cross midnight. All-day events move and resize by whole days, in the all-day row and in the month.
  Dragging between the two zones changes the kind (Juan, 2026-11-02): an event dropped on the all-day row becomes
  all day on the day under the pointer (as many days as it spanned); a bar dropped among the hours gets the time
  under the pointer with the default duration, on that day. The preview follows the pointer into the other zone.
  Dragging near the top or bottom edge auto-scrolls.
- **Reminders** (like Notion Calendar): every calendar has default reminders, one list for timed events ("When it starts",
  5/10/15/30 min, 1/2 h, 1 day before) and one for all-day events ("On the day at 09:00", "The day before at 09:00 / 18:00",
  "2 days before at 09:00"); by default no calendar reminds. They are chosen in Settings → Reminders (one block per
  calendar, also external ones), reached too from a calendar's menu ("Reminders…"). An event's detail has a Reminders row:
  "As the calendar (…)", "No reminders", or its own list. The desktop app shows them as system notifications while it runs
  (a click brings the window up on that event; with Settings → Desktop → "Keep running in the background", on by
  default, closing the window leaves it in the system tray, and "Open at login" starts it there); the Android app as notifications even when closed (exact alarms; a tap
  opens the calendar on that event; it asks for the notification permission the first time there is something to remind).
- **A new event is a draft until it has a title** (like Notion Calendar): however it is made (drag, double click, menu,
  the phone's button), the grid shows only its range, lightly tinted in its calendar's colour with no text, and its detail
  opens on the title (it looks like that from the first moment of the drag). It can be moved or resized with the detail
  still open. A title typed and then a click elsewhere is kept (no Enter needed: any press outside the detail first saves
  what is being typed). Closing the detail without a title (`Esc`, a click elsewhere, the close button, another
  selection) drops it with no undo step; with a title it becomes an ordinary
  event (and, with a server, an entry of its collection). So untitled entries are never made, and notes are never renamed.
- **Selection:** click selects one and opens its detail; `Shift`+click adds the range from the anchor in chronological
  order; `Ctrl`+click (also with `Shift`) adds or removes one event. Dragging one selected event moves all of them. Click on empty space
  or `Esc` clears. While `Ctrl`/`Shift` is held the popover lets clicks through, except while typing in a field (`Shift`
  for a capital letter must not fade it).
- **An event's note opens** from its right-button menu and its detail («Abrir en Boni»), and with a double click in
  its peek. `Ctrl`+click selects (Juan, 2026-11-03: «debería seleccionarlo»); from 2026-10-16 to then it opened the
  note like a link.
- **Series:** repeating an event creates one entry per occurrence (up to 12 months ahead; the server tops up open-ended
  series). The same "this / this and
  following / all" question applies; "all" on a deletion keeps the past notes (the dialog says so); marking a task done only
  changes that note; changing the repetition rule replaces the later notes with the ones the new rule makes.
- **Recurrence:** editing, moving or deleting an occurrence asks "Only this event / This and following events / All
  events" (cancel is always possible). Changing the repetition rule itself applies to the whole series.
- **Tasks:** an event can be switched to Task in the detail or the context menu; tasks show a checkbox in the card,
  also a task of the whole day (its bar in the week's all-day row and in the month) and a month chip, where the box
  takes the place of the colour dot; a click on the box marks it done or not (task 44). A
  calendar offers this only if its view maps a task column: a checkbox column (empty = event, unchecked = open task,
  checked = done) or a status column with chosen done states. Calendars without one show no Event / Task controls.
- **Read-only calendars** can be selected but not edited or dragged: their detail shows every field disabled, and
  `Delete` on them only says "Read-only calendar" (no scope question).
- **Calendars** (the sidebar's first group, «Calendarios», whatever account the definitions carry; Juan, 2026-11-02,
  D-23): every collection of Boni with a day is a candidate (its `date` or `start` role, docs/clases.md §6). «+ Añadir
  calendario» under the group opens a menu of the candidates (name and count; «Ninguna colección con fecha» when none
  is left) and one click makes the collection a calendar with its title, its day and the first free colour of the
  palette (its roles give the times, the end and the task box). «Quitar calendario» in a calendar's properties takes
  the calendar away, never its records; adding it again brings it back. Only with a server (the sample has no
  collections to offer). A definition can be **split by a field** (D-24; «Separar por» in its properties: the
  collection's lists and single relations, or «Ninguno»): the sidebar shows it as a folded row with its name and the
  field («Agenda · por área») and one calendar per value inside, indented, each with its colour and eye, plus «Sin
  área» while some record has no value. The folded row is the definition's, like a folder: its own gear opens the
  definition's properties (its name, «Separar por», «Calendarios por área» with a row of swatches per calendar,
  the mapping, «Quitar calendario», which takes the whole definition) and its eye shows or hides every calendar
  inside at once. A calendar inside has its own gear and properties: its colour, its own «Separar por» (any field
  no node above uses: a value split again is a node of its own, with the values found among its records, nested as
  deep as wanted; Juan, 2026-11-02: «tantos subcalendarios como quiera»), and «Ajustes de Agenda» to the
  definition's. A colour chosen anywhere is kept by the server, for a whole calendar too. The colour is always the
  swatches row: a calendar's own, or one per calendar a split made (a colour by a field without splitting was built
  and taken out the same day, 2026-11-03: Juan wants one way, «Separar por» and the swatches). While the server
  sends the calendar back after a change of the split or of a colour (seconds on the NAS), the select is disabled
  and «Guardando…» shows beside it. Under a finger (the phone's drawer), the row buttons are always visible and
  36 px wide, the rows 40 px tall.
- **External calendars** (Settings → External calendars, or "Add external calendar" under the sidebar's calendars):
  other services' calendars (Google Calendar...) by their iCal address, read-only, in their own sidebar group with
  colour and eye like any other. Each row in Settings shows how many events came and when, or why the download
  failed (refresh, edit, remove next to it). The last copy shows without a connection; they are downloaded anew when
  the app opens, every ten minutes while it is open, and when its window comes back after five minutes away (the
  desktop window hides in the tray); a calendar's context menu has «Actualizar» and the state of its copy (task 60).
  The address of a private calendar is a secret: it stays on the device or in the account,
  encrypted. A repetition the app cannot repeat (e.g. "second Tuesday") shows once and Settings says how many.
- **Data from a server** (Settings → Data; without a server, the invented sample): address, user,
  password; the device keeps only a session token. The calendar opens on the last copy kept on the device, then follows the
  server live; Settings says "Live", "Offline: showing the last copy" or "The session ended: log in again". When the server
  writes, the gestures change its entries, also offline: changes show at once and wait on the device until the connection
  is back. A change the server refuses (the entry changed elsewhere) shows a conflict toast and the server's copy. A read-only server sends its calendars read-only. External calendars and the
  shared preferences (language, clock, first day, second timezone, week numbers, default duration, snap) belong to the
  account: every device shows the same, changes reach the others live, and the server downloads the calendars (the hint
  under External calendars says so). Theme, density and timezone stay per device. The first time a device joins, its own
  external calendars join the account's, with a toast saying how many.
- Every edit is optimistic and undoable; one gesture is one undo step.

## 4b. Quality (learned 2026-10-21)
Distilled from pbakaus/impeccable (Apache 2.0) and emilkowalski/skills (MIT) at Juan's request; the general version for
any interface is the vault note `wiki/temas/diseno-de-interfaces.md`. Here, what it means for Boni.

- **Boni is an "operate" product:** someone doing a task. Familiar controls, one family of type, a tight scale, colour for
  state and selection only, the same vocabulary on every screen. Character lives in details, never in invented controls.
- **Cognitive load:** at most about four visible choices per decision; more go behind a select or a closed group with its
  summary. Groups of four or fewer. Where you are is always marked. No ids or keys in front of the user ("imap" → "un
  buzón de correo (IMAP)").
- **States:** every control has normal, hover, keyboard focus, pressed, disabled, loading, error and empty. An empty
  list says what to do next.
- **Counts:** a translation key with a count has a `.one` form when "1 …" reads wrong ("1 elemento", "1 correo"); both
  translators use it. Never "(s)". Four-digit numbers stay unseparated in Spanish (1284), as Spanish usage has it.
- **Motion:**
  - Whether to animate depends on how often it is seen: keyboard actions and things done many times a day are never
    animated; occasional ones (a panel, a toast) get a short transition.
  - Easing `var(--ease-out)` (`cubic-bezier(0.23, 1, 0.32, 1)`) for what enters, leaves or answers a press; never
    ease-in. 100-160 ms for a press, 150-250 ms for a menu, at most 300 ms for a panel; exits faster than entries.
  - Never from `scale(0)` (from 0.95 with opacity); menus grow from their trigger; transitions, not keyframes, for
    anything that can be interrupted; only `transform` and `opacity`; never `transition: all`. An entry animation
    fills **backwards**, never forwards or both: a transform kept after it makes the element the containing block of
    the fixed menus inside, which then open far from the pointer (2026-11-03, task 39: 252 px off in a table).
  - Buttons (`.btn`, `.pill`, the ↗ of a list line) answer a pointer press with `scale(0.97)` in 120 ms.
  - **What enters, rises** (Juan, 2026-11-02: «animaciones agradables, como Apple»): a request, each block of an
    answer, a question card, the side panel (12 px from the right) and a toast come into place from 6 px below with
    their opacity, in 200-240 ms with `var(--ease-out)`; a list's sections follow each other 50 ms apart, four at
    most. The same rule, everywhere else (task 28, 2026-11-03; I-14): what the main area shows (a page, a record,
    a table; the same node rises again when another page takes its place), each card of the inbox (50 ms apart,
    four at most), a dialog, the pane of Settings when its tab changes, and a screen of the phone. Menus and
    popovers grow from their trigger (from 0.95 with opacity, 160 ms). The phone's sheets keep sliding up from the
    bottom, as the platform's do. Nothing animates on every keystroke or on hover beyond colour and a 1 px lift. References read for it:
    Apple's HIG «Motion» (purposeful, it communicates, optional with Reduce Motion, never on frequent interactions,
    nothing at the edge of the field of view) and Material 3's scale (about 200 ms for a control, 250-400 ms for
    something entering, decelerate curves for entries).
  - **"Reduce motion"** (`prefers-reduced-motion`) is respected in both apps: transitions and animations collapse, and the
    calendar's viewport lands jumps and zooms at once (its smoothing time drops to 1 ms).
- **Waiting** (Juan, 2026-11-03: «en general… que mostrase alguna animación o algo que indique que el sistema está
  cargando algo»; I-15). What the guidelines say, and what Boni takes from them:
  - Nielsen Norman Group, «Response Times: The 3 Important Limits» and «Progress Indicators Make a Slow System Less
    Insufferable»: 0.1 s feels instant, 1 s keeps the flow of thought, 10 s is the limit of attention; under 1 s no
    feedback is needed; a looped animation for 2–10 s; a percent-done, or the amount done, past 10 s; feedback matters
    most when the time varies; a flash is worse than nothing (display inertia).
  - Material Design 3, «Progress indicators»: nothing under 200 ms; a loading indicator from 200 ms to 5 s; a progress
    indicator over 5 s; one indicator for a group, on the top edge of the page or container, never one per item; linear
    on an edge, circular centred where the content will appear; the same variant everywhere.
  - Apple HIG, «Progress indicators» and «Loading»: show the screen at once with placeholders and let the content
    arrive; prefer determinate when the duration is known and switch to it when it becomes known; keep the indicator
    moving (a stationary one reads as frozen); one consistent place; a label only when it adds something («loading»
    adds nothing); let people halt what can be halted.
  - Boni: **the line at the top** (`.wait-line`, the top edge of the top bar, or of the phone's screen): a thin accent
    segment sliding along the width while anything is in flight (a request of either app to the server or to a model,
    the calendar's connection and the calendar itself coming); it shows after 250 ms and stays at least 500 ms; one
    line for everything, never one per element. **In place**, what is loading keeps its room with the pulsing
    placeholder (`.page-loading`; `.short` in a section of Settings) and no word says «Cargando»; a control that
    saves disables itself and says «Guardando…» (the calendar's properties) or shows its busy state (the inbox's
    buttons). **Long waits** (a model's turn, the mailbox's check) say what is happening as it happens (the
    conversation's live steps; «Comprobando…» with its count) and can be stopped («Parar»). **"Reduce motion"** keeps
    the line and the placeholders but stops their motion. A wait never ends in silence: an error replaces it with its
    state (a toast, «Sin conexión»).
- **Surfaces nobody draws:** text selection in the accent's soft tint (`::selection`), a visible focus ring, styled
  scrollbars, tabular numerals in figures.
- **Copy:** a button names its action; an error says what happened and how to fix it, never a code.
- **Worst realistic data:** `e2e-boni/worst-case.spec.ts` fills Settings and the inbox with long hyphenated accented
  names, a 70-character address, one-letter values, counts of 1 and of thousands, a long collection name, through the
  fake server; every section with its groups open must fit. (It found the guide's rule select overflowing with a long
  collection name: a select in a row of controls now shrinks and ellipsizes.)
- **Review before a PR that changes a screen:** look at the screenshot as a first-time user (does every word make sense?
  what do I do on an empty screen?) and as a daily user (keyboard? how many clicks for the main task?); Nielsen's ten
  heuristics and the cognitive-load list; the worst-case data.

## 5. Language and copy
Spanish first, English second, all through `src/i18n.ts` (no hard-coded text). The UI uses proper Spanish with accents
(the "no accents" rule belongs to generated vault notes and chat, not to the product). Labels are short and imperative;
dates use the locale (`Mie 17 sep '25`); durations as `1h 15min`.

**Names in one or two words, as a person says them** (Juan, 2026-11-01: «no me gustan las frases largas que usas a
veces en la app como "Lo que ve la IA", suenan raras, y parece generado por IA»). A place, a tab, a section, a column or
a mode is named with a word or two («Privacidad», «Calendario», «Dinero», «Conciliación»), never with a phrase that
explains it.

**No explanations in the app** (Juan, 2026-11-02, said several times: «no me gustan esas explicaciones dentro de la
aplicación, son redundantes y molestan, además que apestan a IA»; the one that triggered it: «Solo lectura: es lo que
llegó.» on a mail). A screen shows the thing and its state, never a sentence saying what the thing is, what Boni does
with it or what Boni learns from it. A state is a word or a number («Apagado por Boni el 3 nov», «12 de 20»); a
setting may have one short line under it saying its effect, nothing more; a tooltip on a button is fine. What needs
explaining goes in the docs, not on the screen. The last ones removed (2026-11-02): «Solo lectura: es lo que llegó» under a mail and «Boni nunca te pedirá una
contraseña ni un código aquí» under a question.

## 6. Adapting it to other platforms
- **Boni desktop (and later its Android app):** since 2026-10-17 the same architecture as this app (a React web UI in
  Electron, a WebView on Android), so it uses the same tokens, controls (buttons, pills, segmented options, menus, the
  settings modal, toasts) and the "text fits its box" rule, with its own overflow test. Its `styles.css` copies the tokens
  of section 2 (the repos are separate): change them here first, then there. Charts add their own colours (a categorical
  palette checked for colour blindness on these surfaces) and draw in SVG: hairline grid, 4 px rounded data ends, the
  latest value as a label and the rest in a hover tooltip (`--surface-2` box, 8 px radius).
- **Boni on a phone («El móvil»)** (narrower than 640 px, and its Android app; Juan, 2026-10-31: «parecen
  adaptaciones muy obvias de la versión desktop»): made for the phone, from Material 3 (navigation bar, FAB, bottom
  sheets), Apple's HIG (a tab bar holds places, not actions; large titles) and NN/g (visible navigation, less text).
  - **Four places at the bottom, always in view:** Inicio, Páginas, Boni and Bandeja (its count on a badge). Capturing
    is not a tab: it is the **+ button** (56 px, `--accent`, 18 px radius, bottom right above the bar) on every place's
    own screen but Boni's, where the action is to write. Inside a collection it makes a record there and opens it;
    anywhere else it opens **«Crear»**: «Apuntar» first (the server's capture buttons, then the shortcuts, each with
    its menu by ⋮ or a long press: edit, on the launcher, delete with Undo) and «Nuevo» (a page, a record in a
    collection, a file kept in Boni).
  - **Large titles:** a place's screen starts with its title (32 px, 700) in its content; the top bar is slim (48 px)
    and only there when it has something to do: Back and «…» deeper in a place, the collection's name over a record,
    the conversations and a new one in Boni. The settings are the account's initial (a 40 px `--accent-soft` circle)
    on Inicio, not a gear on every screen.
  - **Inicio is the day:** the date over its title, what waits in the Bandeja (an `--accent-soft` banner), «Seguir con»
    (a row of 136 px tiles of what was open last), «Hoy» (what the calendars hold today, as Boni Calendar reads them:
    all day first, then by the hour, done last; a task with its box) and the charts kept on Inicio (each with its
    total; its menu takes it off or puts it back).
  - **Lists for a thumb:** grouped lists (16 px radius, `--surface`, a hairline between rows); each row two lines
    (its title on one line, cut with «…»; its date and its first choice below in `--muted`), at least 56 px high. A
    collection that keeps tasks (its calendar says which box) shows the box in the row and chips to see what is to do,
    done or all; ticking one says so in a notice with Undo, as on Inicio. Dragged left a row shows its actions (done
    in `--good`, delete in `--bad`, with Undo); held for half a second it opens its menu from below.
  - **Sheets from below** for menus and choices: a grabber, a 22 px title and a close button; a tap outside or Back
    closes them. Forms and editors stay full-screen sheets with their buttons fixed at the bottom; optional fields fold
    under «Más detalles».
  - **A record or a page reads first:** its properties as chips under its title (a day, an option's name, a related
    title), and «Propiedades» opens them all in a sheet to edit; «…» has its History and the trash (a page: duplicate
    and the trash). While writing, the tab bar and the + button step aside and a bar sits on the keyboard: a block, a
    heading, a list, a to-do (each turns the block being written into it, and back to text if it already is one,
    keeping the cursor where it was), undo and «Listo».
  - **Boni's conversation is the whole screen** (as Claude's and ChatGPT's): its bar docked at the bottom, its
    conversations in a drawer from the left (84 % wide over a scrim) with «Registro» and «Auditoría» at its foot; an
    empty one greets with things to try. Sending keeps the keyboard up.
  - **Small things:** a notice sits above the + button; no greeting toast (Inicio says the day); a session the
    server no longer takes is a banner on Inicio (in `--now`, as the desktop's pill) that goes to sign in; dates in
    the account's language; one chart on the whole screen with period chips; a tap on a chart shows the value and a
    second tap opens the detail. Same tokens and card recipe; written deviation for the thumb: 16 px text, 48 px touch targets, 20 to
    24 px icons. Back (and Android's button) closes the top thing, then goes a step back in the place, then to Inicio.
- **Desktop widgets** (Boni): a chart card alone in a small transparent window that sits on the desktop, below every
  window (on X11 a "dock" window kept below by the window manager; it survives "show desktop"). It keeps the card look
  (`--surface`, 10 px radius, `--line-strong` border) and is fully interactive: hover for values, click for a detail;
  dragging anywhere moves it, the bottom-right corner resizes it; on hover it shows its period and its menu (the chart
  controls below, compact), and right click opens the same menu (open or edit in the app, refresh, hide here, remove).
- **Boni's main window** is laid out as this app: the sidebar, the main area and the right side panel. The sidebar
  (Juan, 2026-10-28; docs/clases.md §2.7): Buscar, the conversation and «Mis datos» at the top; then two
  sections, each folded and unfolded by a click on its name (a chevron beside it on hover; kept on this device):
  «Recientes» (the last five pages, collections and notes opened here, newest first, hidden while there are none) and
  «Páginas», only to open, add and delete: the user's pages as a tree (each row's "…": «Cambiar nombre», add a
  subpage, duplicate, delete with Undo; "+" by the name of the section makes a page), then the collections, each
  inside its mother and folded by default, with its records that have a note under it when its eye says so (on hover:
  the eye, "…" with «Nueva nota», «Nueva colección dentro» typed in place, «Cambiar nombre», «Eliminar colección»,
  only an empty one; "+" makes a note; a note's "…": «Cambiar nombre», «Copiar enlace», «Mover a la papelera»), then
  «Boni», folded: Boni's template pages and its own collections, read only. **The right button** on a row (task 42,
  as Notion's) opens the same menu as its "…", where the pointer is, the row lit while it is open; «Cambiar nombre»
  writes the name in place, all of it chosen (Enter or leaving it keeps it, Esc does not; a collection's name is used
  once, its key stays). Boni's own things have no menu. What is open is lit there (Juan,
  2026-10-30): opening a page, a collection or a note (from anywhere: Recientes, a table, a link, the search) unfolds
  «Páginas» and the pages or collections above it and scrolls to it; a note whose collection does not show its notes
  lights its collection. A branch folded by hand stays folded until something inside it is opened. The trash,
  settings and the user at the bottom. **Nothing on screen is fixed by the app** (Juan, 2026-10-21): no home of charts, no "Apuntar
  gasto" button, no list of charts. The window opens on the last page seen on this device (else the first); with no
  pages, a welcome with "Nueva página" and "Hablar con Boni". Every account gets Boni's template pages once («Uso de
  la IA», «Actividad», «Registro»); an account that used the first Boni got, once, a page "Gastos" with what its home
  showed, as data it can change or delete. «Modelos» is a section of its own under «Mis datos» (task 59b); the
  conversation also keeps the detailed run log.
- **A page is a Notion page** (`components/PageView.tsx`, docs/extensiones.md 6; measured on Notion on 2026-10-21):
  always editable in place, no edit mode. A reading column of 708 px centred with 64 px above (or the window's whole
  width, from the top bar's "…": "Ancho completo", where charts sit side by side); the name is the first line (40 px,
  700; "Sin título" as its hint), and the top bar shows only the path (parent pages, small) and "…" (full width, add a
  subpage, delete). Blocks from a closed catalogue: text (16 px, line 1.5), headings 1-3 (30/24/20 px), list, to-do,
  divider, chart (a card, 340 px high) and button (a screen of the server or a saved shortcut; consecutive buttons
  share a row). Writing: Enter makes the next line (a list or a to-do continues; Enter on an empty one ends it),
  Backspace at the start joins the line to the one above (or turns a heading or list back into text), "# ", "## ",
  "### ", "- ", "[] " and "---" turn a text line into that block, "/" opens the block menu under the line (grouped "Para
  escribir", "Gráficas", "Botones", filtered by what follows the "/", arrows and Enter, Esc closes). The hint "Escribe,
  o «/» para elegir un bloque" shows only on the focused empty line. On hover every block shows in its left gutter
  "+" (the block menu with a box to filter it, no "/" to type; the block goes after this one) and its handle (its
  menu: turn into, «Modificar…», duplicate, up, down, delete with Undo; drag it to move it); side by side, a chart's
  gutter sits above its top left corner. A click under the last block
  writes at the end. Changes show at once and go to the server together half a second later (and before the window
  closes or another page opens). A new page (sidebar "+", a row's "+" for a subpage) opens at once, untitled, with the
  caret in its name. Sidebar rows: page icon, which turns into a chevron to fold its subpages on hover; "…" and "+"
  on the right on hover; a row is dragged to move the page (top quarter: before, bottom: after, middle: inside).
  Capturing or editing a chart happens in the side panel with the page in view.
- **The page's grid and the block catalogue** (Juan, 2026-10-24/25; `packages/views/src/catalogue.ts`,
  `components/BlockPanel.tsx`, `DataBlockView.tsx`, `core/grid.ts`): a page is rows of columns on a grid of 12 (a block
  on its own is a row of its own, the whole width), and in each column the blocks go one under another (Notion's
  columns). Dragging a block onto another's side (its outer 15 %) makes a column there, with the block's own width when
  the row has room, else half of the other's; above or below puts it in that column; a row left with one column becomes
  the whole width again. "+" after a block in a row of several columns adds into its column; after a block alone, on
  a row of its own. On a window narrower than 640 px the columns go one under another. Numbers («Cifra»), bar lists
  and charts («Gráfica») of any collection: what they count (rows, a sum or an average of a number field), grouped
  by time (por día / semana / mes, the axis with dates) or a select field, in a period, only the rows of one option.
  A collection's roles come first (D-20): a new block over one with an amount sums it, a bar list goes by its
  category, and its day places the rows unless «Fecha que cuenta» names another; the panel's lists put those fields
  first.
  A click uses a block (design audit, Juan 2026-10-25): a number, a bar list or a chart opens «Lo que cuenta» in the
  side panel (the rows it counts, with its filter and period, picked by the same engine, so they add up to it; a bar
  or a chart's point lists only its own; a row of the user's opens as its page); buttons and text are used with the
  click. Every block's menu comes from its handle ⋮⋮ and the right click, the same in all. «Modificar…» opens the block's panel on the right, drawn from the catalogue: «Datos», «Aspecto» (shape,
  colour, «Con fondo», «Ancho», «Altura») and «Solo algunas filas» folded; a setting that depends on another follows
  it (another collection, its fields). Every setting an AI may set has its control there (the AI is given the same
  list). Dragging a number's or chart's right edge changes its width in columns (a chart's corner, also its height:
  low, medium, high). A value that is not in the user's data (a field removed, an AI's mistake) is shown in the
  block («No se puede mostrar: …», «Modifícalo») and in the panel as it is, marked, never as another value.
- **Buttons** (Juan, 2026-10-24; the catalogue's «Botón»): «Nombre», «Qué abre» (Apuntar gasto), «Al pulsarlo»
  (Abrir vacío / Abrir con datos / Apuntar al momento), «Con estos datos» (the capture's own form, as the phone's
  shortcut editor; «Guardar los datos») and «Color». A button of the first pages that ran a saved shortcut keeps its
  data as its own once modified. «Apuntar al momento» is sent at once, so the numbers and charts that count it change
  at once; its notice says ««Café» apuntado» with «Deshacer», which takes it out again (the same device, within 10
  minutes); without a connection it waits in the queue for its Undo as before. Buttons one after another share a row,
  each only as wide as it needs. Opening a form puts the caret in the first field still to fill (the amount).
- **Boni's template pages** (design audit, Juan 2026-10-25; `packages/views/src/templates.ts`,
  `components/TemplatePill.tsx`): «Uso de la IA» (spending, calls, what the AIs read and changed, spending by day, by
  model, calls by use), «Actividad» (reads and changes, by day, who, in which collection, the table of Boni's activity,
  a link to «Registro») and «Registro» (runs, their duration and cost, a daily chart and the table) come with every
  account as ordinary pages of ordinary blocks, over Boni's own read-only collections («Llamadas a modelos», «Actividad
  de Boni», «Ejecuciones»). A run opens to its «Recorrido» (task 52): a diagram of its steps left to right by what each reads from, the verdict in the outline (red where the policy stopped or denied it, dashed where it went to the inbox, faint where it never ran), each step with its rule and what the models answered (folded, as text), then «Leyó», «Hizo», «Propuso», «Decisiones» and «Modelos» as short lists; «Copiar» puts it all in the clipboard as text, headed as carrying text of his data; «Recorrido» also opens from a turn of the chat and from a proposal's page. Nothing in it is a link or markup. A link block opens only a real page and says if its destination is gone. Under the page's
  name, «De Boni»; once changed, «Modificada», which opens the list of changes (+ added, − removed, ✎ changed, ⤢ another
  size, ↕ where the blocks are) and «Restaurar la de Boni» (Undo in the notice and Ctrl+Z). Removed, a template stays
  removed (the trash brings it back).
- **Boni's own collections** (`apps/server/src/systemCollections.ts`): in «Mis datos» and in a database block they carry
  «De Boni · solo lectura» instead of a level of what the AI sees (no AI sees them): no «Nuevo», no editing, no opening
  a row. They are counted like any collection.
- **Databases as Notion's** (plan PR 19, `components/DatabaseBlock.tsx`): "/" + a collection's name puts it on a
  page; its head has the name, the layouts (Tabla, Tablero, Lista, Galería, Calendario), "Filtro", "Opciones" and
  "Nuevo". **«Opciones»** is Notion's «⋯» of a view (Juan, 2026-11-03, task 41): a short list, each row saying what it
  is now on the right («5 visibles», «Título ↓») with a chevron, and opening its panel in the same box (its head, «‹»
  and its name, goes back): Propiedades (each shown or not), Filtrar (the view's rules, as "Filtro"), Ordenar (none, or
  a column up and, again, down), Agrupar (a board's list), Fecha and «También en el calendario» (a calendar), Columnas
  de sistema (a table); under a line, the collection's notes in the sidebar (its eye). It opens on the list again. Table: the title column first, 34 px rows,
  hairline grid, each cell edited where it is (text and numbers as a field, Enter or leaving saves, Esc does not;
  selects as Notion's coloured pills from a menu; checkboxes at once; relations from a picker: the target's rows by
  title, filtered as one types, one with «Ninguno» or several with a click each; Juan, 2026-11-02: every property
  but the system's is editable, D-21; Boni Calendar shows the same relation by the same title, without the vault's
  brackets), delete on hover with Undo.
  Each column is as wide as its kind of value (title 280 px, text 200, number 110, date 140, select 150, relation
  190, checkbox 72…), never stretched to fill the page (Juan, 2026-10-30): dragging a column's edge widens or
  narrows it (an accent line under the pointer), a double click on the edge brings the usual width back, and the
  account keeps each width per collection on every device; a table wider than the page scrolls sideways. A row's
  title opens it with a click and is renamed in place with a double click (the whole name chosen, as a file's). Rows
  are chosen as in a file manager: a box before the first column (shown under the pointer, and on every row once one
  is chosen), or a click just left of it; on a collection's own page the boxes sit in the page's margin, the first
  column under the title, and the whole strip up to the sidebar chooses a row and lights it under the pointer. Ctrl
  adds or takes out one, Shift takes the run from the last one chosen, Ctrl+click on a title chooses instead of
  opening; the box in the head chooses all. Chosen rows are tinted with the accent's soft colour, and a bar over the
  page's bottom (above a toast) says how many, with «Abrir» (one), «Borrar» / «Borrar N» and ✕, so nothing in the
  head or the table moves; the head keeps its options, and a click on one of them, Esc or a click outside the table
  lets go; Supr deletes them (one Undo for all). The right button on a row opens its menu (Abrir, Cambiar nombre,
  Copiar enlace, Borrar; with several chosen, «Borrar N»); a row not chosen is chosen alone first. A card of the
  board, the gallery or the list opens the same menu where the pointer is (task 42), lit while it is open; its
  «Cambiar nombre» writes the card's title in place. **A column's menu**
  (task 40; Notion's property menu): a click on its name opens it under the name, the right button where the pointer
  is: its name written in place (focused; Enter keeps it), «Tipo: …» with the kinds (Texto, Texto largo, Número,
  Lista, Lista múltiple, Fecha, Fecha y hora, Casilla, Enlace, Correo, Teléfono), «Valores» for a list (each renamed
  in place or taken out with ✕, «Añadir un valor» at the end), «Ocultar» (this view) and «Borrar columna» (its values
  kept, «Deshacer» in the toast). The title column only renames; a mother's column, Boni's own collections and the
  mail's show no changes. A column's kind changes freely while empty, among texts with values; otherwise, and for a
  list's value still in use, a toast says «No se puede: está en uso». A «+» at the head's end («Nueva columna»): a
  name and a kind (the kind's name when left empty). On a collection's
  own page, in every layout, the page is centred and as wide as what it shows (Juan, 2026-10-30): a table's columns, a
  board's columns, a gallery's cards (220 px each), a list's rows, from 560 px up to the window's width (then a table
  or a board scrolls sideways, a gallery wraps); what is narrower than 560 px is widened to it, and a calendar fills
  the width. The title sits over the first column (a table's boxes in the margin), the head's options end where the
  content ends, and the layouts keep only their icons when the head is narrow.
  Boni's own tables have no boxes, menu or delete column; their widths are kept too.
  Board: a column per option (and "Sin X" when used), cards dragged between columns change the select. Calendar: a
  month from Monday, today marked, "+" on a day adds a row on it; "Semana" shows seven tall days with every item
  (its start time over its title); "También en el calendario" (Opciones) adds other collections, each with its colour
  and a legend. "Filtro" (Notion's): rules of a property, a condition that fits its type (es, contiene, está vacío,
  antes de / después de hoy or a date, mayor que…) and a value; the button shows how many are on. The view (layout, sort, grouping, hidden
  properties) is the page block's; the rows are the collection's (`/api/data/*`, a personal device only).
  Every collection's head has a quiet pill with what the AI sees of it (Visible, Opaca, Restringida, Privada, each
  with its icon); it opens the four levels with a line of help each. Privada is locked: elsewhere its menu only says
  where to unlock it; on the collection's own page (its name in the tree) "Desbloquear…" opens a dialog that asks
  for the new level and its name typed. A collection's page shows its mother above its name and in the crumbs; Esc
  goes up to the mother (from the top, to «Mis datos»). "Una parte con otro nivel…" (in the pill's menu) opens
  the collection's rules: each is Notion's filter editor and a level, listed in words ("Título contiene Tutoría ·
  Restringida"); the pill shows "+N" when there are rules. Whatever would lower something private asks for the
  collection's name, and only on its own page.
- **Notes as pages** (2026-10-22): a row's text is edited with the page's block editor (headings, lists, to-dos,
  quotes, code, dividers; "/" offers text blocks only), saved as Markdown; what it does not paint yet (tables,
  an Obsidian embed that found no file, inline bold or links) shows as written. A note is titled by its first `# Heading`, never its file's slug.
  Its properties start unfolded (Juan, 2026-11-02: they are what the page is about); folded ("Ocultar propiedades",
  a chevron; "12 propiedades" to unfold) they stay so for that collection. Each property hides with the eye that shows on hover (as Notion's); hidden ones
  wait, dimmed, under "N ocultas" at the end, where the same eye shows them again. The account keeps both per
  collection (Boni, Boni Calendar's peek, every device). A note opens with its properties over its text (Juan,
  2026-11-02: they are what he comes to change from the calendar), folded only where he folded them.
- **Editing as a document** (Juan, 2026-10-30; phase 1 of the Boni note «Boni: el editor de páginas»). A selection
  that leaves a block takes whole blocks, as Notion's: a drag from one block into another, Shift+click from the block
  being edited, Esc (the block the caret is in; a second Esc lets go, a third leaves, as the peek's), Shift+↑ or
  Shift+↓ at a block's edge, Ctrl+A twice (its text, then every block). Selected blocks are tinted with the accent's
  soft colour and their text cannot be selected meanwhile. On them: Ctrl+C copies them as Markdown (any app pastes
  it; Boni gets the same blocks back), Ctrl+X cuts, Supr or Retroceso deletes, Ctrl+D duplicates (the copies stay
  selected), Ctrl+Shift+↑/↓ moves them, Tab and Shift+Tab nest them, ↑ and ↓ move the selection (Shift: grow it),
  Enter edits the first one, typing puts what is typed in their place; Ctrl+Z undoes any of it. Pasting several
  lines makes a block of each paragraph, heading, list item or to-do (the text before the caret joins the first,
  the text after it the last); a picture or a file pasted or dropped is kept in Boni (where the account keeps such
  files: asked once when there are several collections of files) and shown where it fell. The arrows go from block
  to block as in a document: ↑ from the first line shown, ↓ from the last, ← at the start, → at the end; a block
  that is not text (a picture, a chart) is selected on the way.
- **Relacionado** (Juan, 2026-10-30): under the properties' line, one more quiet line with what points to the row
  from other collections, by count ("Relacionado · Deuda 1 · Movimiento 3 · Proyecto 2"), folded; unfolded, one group
  per collection and field ("Movimiento · en «Con quién»"), its rows newest first with their first date on the
  right, a click opening one. Each group folds by its name, with the same chevron (Juan, 2026-10-30); the collection
  keeps the line and its groups open or folded for all its rows, on every device, as the properties. Made from the
  relations alone, for any collection (a person's projects and debts, a project's tasks); it takes the place of
  Obsidian's views. Nothing points to the row: no line at all.
- **Files in a note's text** (Juan, 2026-10-30): a file of the user's alone on its line (`![name|width](boni:<row id>)`
  in the Markdown) is a block: an image shows in place, at its width (never wider than the text), rounded; its name
  (the title of its record in the files' collection, what finds it there and in the search) shows over its corner
  only under the pointer (Juan, 2026-10-30); any other file (or an image too big to show) is a card with a clip, its name and "Abrir". It
  comes through the app's own channel to the server, so it shows the same on the desktop, the phone and the web.
  A file no longer there says so ("Este fichero ya no está").
- **Peek** (2026-10-22): a note opened from another app (a double click on an event in Boni Calendar; its "Abrir en
  Boni", in the right-button menu and the detail, opens the note in Boni's main window instead). In Boni Calendar with Boni's address (Settings →
  Escritorio) it is the calendar's own window with Boni's note page, which asks once for the user and password (no
  address field: it is the page's own) and hides at once on a click in the calendar; it sits above the calendar's
  window only, never over other apps. A single click waits 300 ms before the event's detail where a double click
  opens the peek, so a double click never flashes the detail. It shows in a small frameless
  window, centred where the pointer is: a thin head (its collection, "Abrir en Boni" to take it to the main window,
  ×) that moves the window, and the row as a page below. Esc, × or a click in Boni Calendar put it away (it stays,
  on top, while Juan works in another app); the next note never shows the last one for a moment. On the phone
  there is no peek: in Boni Calendar for Android an event's detail has «Abrir en Boni», which opens Boni's Android app
  on that record (a `boni://note?id=` link) as a page in Boni's tab, titled by its collection, across the screen with a
  smaller title; Back goes back to the calendar.
- **Speed** (2026-10-22): formatters (dates, money) are made once, never per cell; the server counts and finds by
  SQL and lists a type in two queries. Measure with an invented vault of Juan's size (~4,000 notes) in the real app. An attachment is a small chip "Abrir archivo"
  with a clip (never a link): the desktop app opens it with the system's viewer, a browser downloads it; a kind no
  viewer opens is shown in its folder, with a toast saying so.
- **More of Notion** (2026-10-22): blocks numbered list (numbers follow on), toggle (its line folds the blocks
  nested under it; Enter at its end writes inside it), quote (a 3 px bar), callout (an emoji you can change, a
  `--surface-2` box), code (monospace, Enter is a new line, Ctrl+Enter leaves it) and a link to a subpage ("/Página"
  makes the subpage and opens it). **Nesting** as Notion's Tab: Tab puts a line one level under the one above (26 px
  each, up to 4), Shift+Tab takes it out; an empty nested list item comes out with Enter before it ends the list; a
  block moves, is dragged and deleted with what is nested under it. Markdown also "1. ", "> " (toggle), `" ` (quote)
  and "```" (code). **Ctrl+Z / Ctrl+Shift+Z** undo and redo the page's changes (typing in one block for a moment is
  one step). **Ctrl+K** (and "Buscar" at the top of the sidebar) opens Notion's search: a box over the window, pages
  matching the words with their path, arrows and Enter. **Papelera** at the bottom of the sidebar lists deleted pages
  with "Restaurar"; "Duplicar" is in a page's "…" (sidebar and top bar). A new page shows at once (made on the
  server behind it, keeping what was typed). **AI** is a placeholder for now: "/Pedir a Boni" says it is coming.
- This computer's **desktop widgets** are listed in Settings → Escritorio (eye = shown here, X removes, "Añadir widget").
  Settings has «Privacidad» (what the AI sees) after the account (one row per collection with its count and a three-way segmented
  control: "La ve", "Solo sabe que existe", "No la ve"; each option's tooltip says what it means) and "Tus datos": one button that downloads everything as a .zip
  (where the host can save a file; a toast says how it went). In the desktop app, "Tus datos" is the **daily copy on
  this computer** (Juan, 2026-10-23): the switch "Copia diaria en este equipo" with what it does and how many are kept,
  then "Última copia" (date · size, "Haciendo la copia…", or why the last try failed, in `--bad`) with "Hacer copia
  ahora", then the folder in a closed disclosure whose summary is the path.
- **Charts look as Notion's** (studied in Juan's Notion, 2026-10-21): on a page a chart has no card around it (its
  title, period and total over it), a dotted grid, the value over each column or point ("Data labels"), a band behind
  the column under the pointer (no dimming of the rest), a 1.75 px line with a soft gradient under it, a thin donut
  ring with the total big in its centre. Its **style** (`ChartStyle`, `@boni/views`, kept in the chart's definition
  only when it differs from the defaults): height S/M/L/XL (240/340/440/560 px), grid lines (horizontal, vertical,
  both, none), axis names, data labels, colour (one from the palette or "Colorido", one per bar), running total
  ("Acumulado"), zero values left out, and the average as the reference line. The **settings** (the side panel) are
  laid out as Notion's view settings: name, the chart type as five icons (bar, horizontal bar, line, donut, number;
  the rest under a chevron), then sections of rows with the name on the left and the value (a menu) or a switch on
  the right: Eje X (what to show, by, sort, the N largest, omit zero values, detail on click), Eje Y (what to show,
  series, cumulative, compare, reference line), Periodo, Filtros, Estilo (colour swatches; "Más opciones de estilo":
  height, grid, axis names, data labels). Every change shows at once on the chart.
- **Chart controls** (Boni; like a Notion view's): when the pointer is over a chart card, a small bar of controls appears
  in its header before the total: period (a menu of usual periods), filters (a box, saved when it closes), order and
  "only the N largest", kind, colour (the calendar palette) and "…" (edit, duplicate, on the desktop, delete).
  28 px controls, Lucide icons, `--surface` bar with a `--line-strong` border, 8 px radius; the period's label is cut
  before anything else. A card narrower than 480 px (half a page) shows only the period and "…" (whose "Edit…" has
  the rest), so the bar never covers the card's title. Each change applies at once with Undo in the toast; deleting
  waits for that Undo.
- **The conversation with Boni's agent** (Boni; `apps/boni-web/src/components/Chat.tsx`, docs/nucleo.md 7.14): a
  "Conversación" row at the top of the sidebar (with the number of proposals waiting), the third tab on the phone.
  **Its history as other AIs show it** (docs/conversacion.md 3.1; Juan, 2026-10-31): on the left of the conversation, a
  240 px column with «Nueva conversación», a search and the conversations by when they were used («Hoy», «Ayer», «Los
  últimos 7 días», «Este mes», «Antes»); the open one is shaded, and a row shows its pencil (rename in place) and its
  bin (to the trash) on hover. A new conversation starts empty and is made with its first message, whose first words
  are its title. On the phone the list is a drawer from the left. **A turn as it happens**
  (3.5): «Pensando…», then each step in Juan's words, worded by the app from what the server says it works on (Juan,
  2026-10-31: «los pasos serán explicativos»): «Buscando «pan» en Tareas», «Contando en Tareas · Prioridad: Alta»,
  «Leyendo «Rayuela»», and once done what it found in `--muted` («· 2 resultados», «· 9»); a box's value in words
  («Hecha: no»), never as the code writes it; a tool the app does not word (an extension's) keeps its own title. The one going on has a pulsing
  `--accent` dot on its left (still with reduced motion) and the done ones with a tick; once it answered, its steps fold
  into a quiet «Pasos (n)» above the answer. **The bar** (3.6): one rounded box (16 px) whose text grows with what is
  written, up to about eight lines, with no resize grip; inside, below the text, the model the conversation plans with
  (a quiet chip; its menu lists the account's own and the ones evaluated in «Modelos», and links there) and a round
  button on the right: an arrow that sends, or a square that stops the turn («Parar»; the turn then says «Parado.» in
  muted text, never as an error). Juan's turns on the right in an `--accent-soft` bubble; the answers are painted by the code from the reply components
  (text with slots, a big number in tabular figures, a list, a table, and a chart: bars across, label, bar and value on
  one line, or a line with its first and last values, of numbers the tools gave, never the model's). The planner is
  asked to answer as a person would: a sentence first, then what helps see it. «Deshacer lo que hizo» follows an
  answer only while its turn changed something not undone yet: a question that only read has nothing to undo, and once
  undone the link goes. **Text is only text**: no HTML, no Markdown, no
  links, no images; what came from outside (an e-mail, a page) looks like any other text and says where it came from
  on hover: nothing marks it visually (Juan, 2026-11-02, twice: an amber line, per value or per block, looked odd
  everywhere; the protection is in how it is painted, not in a mark). An instant or a day in a reply reads as a date
  in Juan's language and zone («19 oct 2026, 9:28»), never in ISO form. A **list** may have sections (its `group`
  field: a small upper-case label with the count, in the items' order, 10 px apart) and its items (line height 1.5,
  2 px of air between them: short lines in a dense block read best around 1.4-1.5) show their fields with « · »
  between them, never their id or type; an item that carries the id and type of a record as the code wrote them ends
  with a small ↗ button («Abrir»; the text itself is never a link) that opens it: a mail as the mail client shows it,
  in a window of its own in the desktop app (the peek, which stays while Juan works elsewhere; task 30) and elsewhere
  in the side panel (the type's name as the panel's title, «Agrandar» takes it to its page), anything else as its
  page. A mail's line has a second small button, «Proponer tarea» (a list with a plus): the mail is read now by its
  plan, a spinner meanwhile, and a toast says what came of it («2 propuestas en la Bandeja»; «Ya en la Bandeja» or
  «Ya apuntada» when the mail's tasks already wait or were taken; «Sin tareas para ti» when the reader found none;
  or where to choose the collections when there are none); when nothing new came of it, the toast's button «Otra
  vez» reads the mail afresh, the waiting ones giving way (task 54: Juan, 2026-11-04, «que el usuario pudiese
  volver a proponerlo»).
  When a request hits one of its limits (too many model calls, steps or text, P12), the error says which, not «una
  regla de seguridad».
  A question shows its options as rounded buttons with a surface and a shadow (one line, cut with an ellipsis; the
  first, the one the plan puts first, tinted with the accent; they lift under the pointer and shrink a touch when
  pressed) and never asks for a password: there is no password field, and nothing says so (§5; the line «Boni nunca
  te pedirá una contraseña» is gone, 2026-11-02). Answering it leaves the answer as it was and adds what the run did
  next, never the same blocks twice. A
  **confirmation** is a card with an `--accent` border holding only the code's components: the action as a question,
  each argument with its real value in full (scrolling, never cut), where it came from ("Viene de fuera · un correo")
  and its warnings in `--bad` (invisible or direction-changing characters, shown as `⟦U+202E⟧`, mixed alphabets, an
  international domain with its real name, long text). Its accept button waits 0.7 s and changes side with every
  confirmation, so nothing is accepted out of habit. **Questions from background work** (Juan, 2026-10-24, the panel of
  requests, option A) share the inbox's one queue, in the order things arrived; every card says what it is on a small
  muted line on top ("Pregunta · caduca en 7 días", "Propuesta"). A question card: the prompt as its title, where it
  came from (the mailbox, the sender and the subject, outside text with its mark, and "Ver correo"), its options as
  pills or a line to type in with "Enviar", and a quiet "Descartar" (Boni does nothing more with it). The clicked
  answer turns into the same spinner as deciding a proposal; one that no longer waits (answered elsewhere, expired)
  says so on the card with "Quitar". The counts (top bar, sidebar, conversation) are proposals and questions together,
  and a new question opens the panel as a new proposal does. The **inbox** (Juan, 2026-10-22) is a panel on the right
  (the top bar's "Bandeja (N)"; it comes out by itself when a new proposal arrives, checked every minute; in a narrow
  window the sidebar gives it room) and the same cards in Conversación → Bandeja. A card is titled by the proposal
  («Revisar actas») and under it says where it goes and when («Docencia · jue, 29 oct, 12:00–13:00»; Juan,
  2026-11-02: «Añadir tarea a Tarea» said nothing; «Añadir a Tarea» only without a title; a change or a deletion
  as the view names it; a task the mail gave no time for has, after the day, a small «¿A las 16:00?» with the
  first free hour of its day: one tap puts the time on the line and sends it with the acceptance; once Boni has
  earned it the line says the time already; when a reply in the same thread of mail moved it, «Antes: jue, 29
  oct, 12:00» in `--muted` after the day: the earlier card is gone and this one says what it was, task 46; when the
  calendar already has the same thing, «Ya en el calendario: Clase IPM, 17:00–18:00» in the text's colour and, if
  it is an external calendar's event, the primary button reads «Enlazar» and the record is made linked to it; an
  entry at the same moment with another title may be it: «¿Es «Quedada cafe, 16:00–17:00»?» and a button «Es el
  mismo» before «Aceptar» that puts into that record what the proposal adds (nothing of it overwritten; an external
  event's: the record linked to it), task 58; another entry at the same time is «Se solapa con X» in `--muted`,
  task 51), where it came
  from once (the mailbox and the sender, or the note's path; never "Viene de fuera" on every row), its day and times,
  and a mini calendar: the day (detailed) or the day before, the day and the day after (compact), each a short list in
  time order with the proposal drawn with a dashed `--accent` border among what is there. Compact when the source said
  everything and Juan accepted two like it before, detailed otherwise (the subject and the mail's words, clamped to
  three lines, and the fields that the card's line does not already say); "Más detalles" / "Menos" switches. On
  the inbox's own page (more room) a detailed card from mail is two columns: the mail (up to twelve lines) and the
  fields on the left, the three days on the right (titles on two lines); one column when the card is narrow. A
  changed note's text shows as reading text (headings, lists, to-dos), never raw Markdown. Accept and Reject on each
  card (never "accept all"). A card from mail has "Ver correo" on its source line, and «En Gmail» when the
  mailbox is Google's (the mail in its webmail, found by its Message-ID through the host's browser; task 55; the mail's own row in Boni: IMAP
  gives no webmail link; the line carries no amber mark: it says itself it is a mail, Juan, 2026-11-02) and, detailed, "Por qué: «…»" (the reader's quote; in « » only when the code found those
  words in the mail). **Corregir** (the pencil): the title and the collection on two lines and, folded under
  «Propiedades» (Juan, 2026-11-02: there, but not all at once), the chosen collection's other properties, each with
  the same cell the table edits it with (an option from its menu, a relation from its picker, a box); accepting
  sends only what he changed, by the field's key. **«Ver correo»** opens the mail as a mail client shows it
  (`MailView.tsx`; D-22): the subject as its title, under it «En Gmail» when the mailbox is Google's (task 55), a
  header of labelled lines (De: name <address>; Para; Cc;
  Fecha in full; Adjuntos as pills that open the file, the mail's own names, the last its original «Asunto.eml»,
  which a mail app opens whole: task 26) and the text as it came, paragraphs
  kept, never as markup; after it the mail's own images (its files as `data:` addresses, never anything from the
  net) and a reply's quoted part folded behind a «···» pill (`--muted`, `--line` border) that opens it in place, as
  Gmail and Apple Mail do (task 48); nothing
  on it edits, and nothing says so (no explanations in the app, §5); the mail's collection is read only in every
  table and page (its cells plain text). Its ⤢ button opens the **proposal's page** (Juan, 2026-10-23), read only, like a row's page:
  the "Propuesta" tag and what it does, the title large, then sections (small upper-case labels): Propiedades (every
  value, the title and day too), Nota, Por qué, Origen (source line with "Ver correo", subject, the mail's words),
  Esos días (three days); Aceptar / Rechazar at the end go back to where it was opened from, as Esc and the crumb
  "Bandeja / Propuesta" do. A proposal to create something can be **corrected** before accepting (Juan,
  2026-10-23): the ✎ button beside ⤢ (on its page, beside the title) opens a small boxed form under the card's
  content: Título (a text field), Colección (Boni's searchable list, the one of relations and forms: the chosen
  collection as a chip, typing filters, the collections under Tareas, Eventos and Otras by what each keeps, a done
  box or a day, so «tarea o evento» is that one choice, and a last row «Crear «nombre»» makes a collection that does
  not exist yet and leaves it chosen; tasks 47 and 53, Juan 2026-11-04: «como en otras partes de Boni, con barra de
  búsqueda y opción de crear colección»), then the chosen collection's
  day and hours as its own rows (each a cell, like a table's), the rest folded under «Propiedades», and "Deshacer
  cambios"; no sentence explains it (§5). Another collection keeps the day and the hours, each under the field that
  plays its role there. Aceptar then sends the changes and the toast says Boni will learn from them. **Deciding** (Juan, 2026-10-23): the clicked Aceptar / Rechazar keeps its size and turns into a spinner
  (both off meanwhile) while the server answers; decisions queue in order, so the next card can be decided at
  once; a decided card leaves and the toast says «Aceptada» / «Rechazada» with «Deshacer» for a while (Juan,
  2026-11-02): taking it back undoes the acceptance's run and the card returns, pending again (the next decision's
  toast replaces it); a failed one says why under its buttons in `--bad`
  ("Ya no vale…" for a stale one, "Ya estaba decidida.") with "Quitar", and stays until taken out. **"Ya lo hice"**
  (Juan, 2026-10-23), between Aceptar and Rechazar, only on a proposal to create something in a collection whose
  calendar has a task column: it is saved already done (struck through in the calendar), with the same spinner;
  the toast says "Apuntada como hecha". **"Boni la habría aceptado"**: a quiet muted mark with a small sparkle,
  beside the actions (and on the proposal's page next to its headline), when the code's rule says Boni would have
  accepted it alone; the Registro says on top, in one muted line, how often it would have been right. With «Solo»
  on for «Aceptar propuestas» (Settings › Decisiones, docs/fiabilidad.md §3.4) those proposals are accepted alone:
  they leave the inbox, and the Registro lists each as «Propuesta aceptada sola» with its Undo; undoing it, or
  deleting what it made, is Juan's «no», and leaving it a week his «sí». **Ghost rows**: a pending proposal to create an entry also shows in its collection: in
  the table, first, read only, in muted text with a solid "Propuesta" tag and ✓ / ✕ beside its title (no dashed
  border on rows: Juan, 2026-10-23, dashed only in calendars); in the calendar layout, a dashed item; a click on its title (table) or on it (calendar) opens the proposal's page. **In Boni Calendar** (plan b2) the same proposal is an event with a dashed outline in its calendar's colour over a faint fill, no resize handles, read only (no drag, edit, duplicate or delete; it never reminds); one click opens its page in the peek (Boni's address set: the calendar's own peek; otherwise Boni's, `boni://proposal?id=`), where Aceptar or Rechazar puts the peek away. Where there is no peek (a browser, Android) its detail opens read only, titled "Propuesta", saying it is decided in Boni's inbox. They are proposals, not entities: nothing counts them; an entity's values are one row per field, labelled with the field's name, and an entity is shown by its title with its id beside it, and a collection by its name alone ("Docencia"; names and titles that came from outside are not used: the key and the id instead); the **log** (Registro) lists every run with what it was, on one line (the request in quotes; "Correo «asunto»"; "Cambio en Obsidian" for a run of the retired mirror, never its path; "Propuesta aceptada"; the review of the mail guide) and under it, muted, when and what came of it (the sender and mailbox, its proposals by how they were decided, what it made or changed by title and collection, "(deshecho)", or "Nada que hacer"; Juan, 2026-10-22: "Segundo plano · Hecho" said nothing); readings in a row that did nothing are one line ("3 lecturas sin nada que hacer") that opens; Undo only where something is left to undo (a stopped run too); a click on one opens, under it, the request as Juan wrote it and each step of its plan (the tool, what the policy decided or where it stopped, and the arguments as the plan wrote them), all as text. The only exception to "no confirmation
  dialogs" (section 1): these confirmations are the policy engine's, not the interface's.
- **Settings** (Boni): one section at a time, chosen in a column on the left (tabs along the top on a phone or a narrow
  window): Cuenta, Modelos, Privacidad, Decisiones, Extensiones, Correo, Tus datos, Apariencia, Escritorio (only
  those that apply).
  It opens on Cuenta. **Apariencia**: the theme, the language and, in the desktop app only, «Tamaño» (−, the
  percentage, +: the windows' zoom in tenths from 70 % to 200 %, kept per computer; Ctrl+= / Ctrl+- / Ctrl+0 do the
  same from anywhere in the app; the browser and the phone have their own). **Extensiones** (docs/extensiones.md): a note on what they are, then per extension its name and
  what it does in one line with its switch, and under it a closed "Qué usa" group whose summary says whether it is
  as it came ("Viene con Boni (versión 1)") or changed; inside, in plain words (never ids): where it brings data from,
  what it reads, what it looks for, whether it proposes, its daily budget. Above them, each version an assistant
  proposed through the MCP waits as a card (docs/extensiones.md §11, E3; Juan, 2026-10-30), with an accent border and
  a «Propuesta» pill:
  - who proposed it and when, and whether it is new or which version is active;
  - «Lo que pide que no pedía la versión N», in the account's names (new code, what it reads and writes field by
    field, making or changing rows, asking);
  - what it reads that is private: in large red when it does, a green «No lee nada privado ni restringido» when not;
  - its tests with ✓ / ✗, and the dry run on his data, function by function;
  - its code, folded, as plain text with its sha256;
  - «Activar la versión N» (only when every test passes) and «Rechazar», and the note that only a device of his
    activates it, never the MCP. **«Acierto»** (docs/fiabilidad.md §3.3): under that line, a card with one row per area of decisions
  Boni takes alone («Colecciones», «Campos»): its last decisions counted (alone, asked, left) and, of the ones alone,
  how many Juan kept as they were, as «acierto 19 de 20 (95 %)»; «Por nivel» opens the same count by level of
  confidence («0,9–1: 10 de 10»); an area with «Solo» on says so after its numbers. Nothing shows until there is a
  decision. **Decisiones** (Settings, docs/fiabilidad.md §3.4): first «Aprender», a switch (on by default; off, no learner
  suggests anything on its own, docs/preferencias.md §5; only a personal device turns it); then one row per area, as the Registro's card (its name,
  «acierto 20 de 20 (100 %)») and under it, muted, where it stands: «Dentro de una propuesta que decides tú.» for
  the areas decided inside a proposal (no switch); for «Aceptar propuestas», «Solo» with a switch at the right,
  disabled until earned, with how far it is as a count («12 de 20», the numbers from the server); when Boni
  turned it off itself, «Apagado por Boni el 3 nov 2026». Nothing explains the rule on the screen (§5). Only a
  personal device turns it. **Modelos**: under an evaluation's result, muted, the decider's
  calibration by level («Calibración: 0,9–1: 10 de 10 · 0,8–0,9: 5 de 6») when the evaluation measured it.

  An extension with a version before the active one has «Volver a la versión N» under it: one click, both ways.
  **Privacidad** (what the AI sees): the levels explained once at the top, then one row per collection with a select.
  **Correo**: not connected, server (`imap.gmail.com` by default), folder, user and app password, and "Conectar", which
  tries the connection before anything is kept (a wrong password is said under the form). Connected: who, the last
  check and how many mails, and "Comprobar ahora"; under it three closed groups, each with a summary on its right:
  "Colecciones de destino" (the marked ones; open when none is marked, as it needs doing): one switch per collection
  tasks from mail may go to, never "Correos" itself nor a hidden one; "Guía de lectura" (docs/nucleo.md 7.4b; summary
  "Con indicaciones · Reglas: n · Ejemplos: n"): "Tus indicaciones" (a textarea over the whole row, "Guardar" enabled
  only when it changed), one row per rule (sender, what it does, "Quitar"; a long address breaks rather than overflow)
  and a row to add one (address or @domain taking the room; the action select and "Añadir" wrap under it when
  narrow), the examples kept from Juan's decisions (subject, what he wanted, "Quitar"; never written here), and "Revisar
  ahora" (the reviewer on demand; a toast when there is nothing clear). A **suggestion of the reviewer** waiting opens
  the group by itself (its summary says so) and comes first, as a card in the accent tint: what it would add (rules,
  examples), how it measured ("acertaría 37 de tus últimas 40 decisiones (ahora 31)"), "Descartar", "Cambiarlo…" (the suggestion, said as a person would, goes to the end of "Tus
  indicaciones", focused, for him to rewrite and save; no rule is added and it is not suggested again) and "Añadir a
  la guía"; "Más
  opciones": "Volver a leer" (a days select, 1 to 30, and "Leer": that mail is read again and its pending proposals
  are replaced; a toast says how many mails) and the mailbox with "Cambiar" and "Desconectar". The password is never
  shown again.
- **Dashboards** (Boni: «Registro», «Auditoría»; Juan, 2026-10-24: short names, the models and the numbers
  large, not the whole width, charts, detail on click). A page column of at most 1200 px, centred; the title large with
  its period beside it (a segmented control where the period can change). First a row of four number tiles (label,
  a 26 px number, a muted note that takes a second line on a narrow tile rather than losing its end, as «octubre
  2026 - hasta hoy» would; a tile that opens more is a button, outlined in `--accent` while open; a limit is a thin
  bar in `--accent`, amber past the warning, `--bad` at the limit). Then two columns (one when the page is narrower
  than ~900 px, also when a side panel takes room): cards on the left, charts on the right. Charts are Boni's own
  (`Chart.tsx`) at 200 px with the legend in HTML above them (a square per series); comparisons of a few things are
  bar lists (a label up to 11rem, ellipsized with its full text on hover, a bar per series and its value written
  beside it, a click on a row filters or opens what it is about). Colours follow the thing, never its position:
  per actor, the Agente `--c1`, the Lector `--c2`, the Revisor `--c3`, the Decisor `--c4`, the MCP `--c7`, people
  muted, Boni's code `--compare`.
- **«Flujos»** (the sidebar, under «Mis datos»; `docs/flujos.md`, F1, 2026-11-05): the account's flows as rows
  (Nombre, Disparador, Estado, Ejecuciones, Última, Versión) and the chosen one drawn (React Flow, dagre top to
  bottom): the trigger first («Nuevo correo»), a card in `--surface` listing what it binds (`$mail` registro,
  `$text` texto…); then a card per step, a reader in an `--accent` border named as the models' flow names it
  («Lectora», «Decisora», «Rellenadora»), a tool dashed with its title from the registry («Crear», «Leer») and a
  word more (the collection it creates in), with the badges «Para cada» and «Solo si» when the step iterates or has
  a condition, and how often it ran in the period («12 veces · 12 propuestas»); an arrow from each step or input a
  step takes its data from. A click opens the step's panel on the right: its name and its settings as the plan says
  them (`type: "docencia"`, `input: $text`), and what it takes from. The period (7 | 30 días) and «Ordenar» as in
  «Modelos». Two tabs in a segmented control: **Flujos** (this) and **Modelos** (task 59b, below).
- **The flow editor** (F2, `docs/flujos.md` §4.5; n8n's canvas and node panel and Dify's checklist as references):
  the chosen flow opens in it, under «Nuevo flujo» and the rows. A toolbar: the name (edited in place), the
  «Encendido» switch, «Añadir paso» (a menu in groups, Leer, Decidir, Datos, Otros, each node named in a word),
  «Ejecutar» on a flow by hand (its form first when it asks for something; it runs as a turn of a new conversation,
  where its replies, questions and confirmations show as always), then «Descartar» and «Guardar» (primary, enabled
  only with changes and an empty checklist) and «⋯» (the versions, each «vN · Tú/Boni · date», a click goes back to
  it as a new version; «Volver al de Boni» on a flow Boni keeps; «Duplicar»; «Eliminar» on the user's own, a second
  click to confirm). Under it the checklist, in a `--bad`-tinted box, one line per problem («Crear: Colección:
  falta»), a click selects the step. The canvas: a node can be dragged (where it is left is saved with the version;
  «Ordenar» lays it out again), an arrow drawn from one node to another asks where the second uses the first's value
  (a small menu of its settings) and moves it after the first when it ran before, Supr removes the selected node, a
  click opens its panel on the right (340 px): its name, id and «Quitar»; its problems in `--bad`; what it is (the
  tool, the reader, the question, the reply) and its settings from the catalog's schema: a collection as a list of
  the collections (changing it, the record's fields follow their roles and the collection's inputs, `$fill.<key>`,
  its key), a record's values as rows of field and value (the parts it is merged with as chips), any other as a
  value field: a kind (Texto, Número, Sí o no, Valor de, Función, Nada) and its input; «Valor de» offers the values
  that step may take (the server computes them: the trigger's, the earlier steps', `$item` in a loop). Then «Solo
  si», «Para cada» and «Junto con». The trigger's panel: «Nuevo correo» with what it binds, or «A mano» with the
  names its form asks for. A node with a problem has a `--bad` border; the selected one an `--accent` ring.
- **«Modelos»** (the tab; task 59b, Juan 2026-11-04: see what every model does and how they work together, n8n's
  canvas as the reference; until 2026-11-04 Ajustes → Modelos, which keeps a button to it): first the
  flow Boni declares (`packages/agent/src/pipeline.ts`, A-16) as a canvas (React Flow, dagre left to right, dots in
  `--line-strong`): a card per node, 200 px wide, named in a word («Correo», «Lectora», «Decisora», «Rellenadora»,
  «Calendario», «Relaciones», «Bandeja», «Tú», «Mis datos», «Planificadora», «Lectores», «Herramientas»,
  «Políticas», «Revisora», «Guía», «Aprendices»), its kind by its look: a model in an `--accent` border with the
  model's id, its calls and their cost of the period and its acierto; a source with how many came in («42 correos»);
  code dashed; «Tú» in `--accent-soft`. An arrow per flow, labelled with what flows and, when the journal counts it,
  how many («42 correos», «12 propuestas»), in `--accent` when anything went through. A segmented control picks the
  period (7 días, 30 días); «Ordenar» lays it out again; a click on a model's node opens its use below. Then what
  configures the models, as it was in Ajustes: «Usos», a card per use with a one-word name and its icon (Agente, Lector, Decisor, Revisor),
  the model's short id at 18 px, a pill of what its route does with the data (`--good` «No guarda tus datos», muted
  «Borra lo que recibe en 30 días», `--bad` «Puede guardar tus datos») and «€ · llamadas»; a click opens the use in
  place of the list (Esc or its close button goes back to the list, not out of Ajustes): the model and its route, what
  the use does, the privacy in a sentence, whose choice it is, this month's spending, the last evaluation with «Ver
  los casos», «Volver al del servidor» and «Cambiar», which shows the models to choose (search, OpenRouter's models
  some provider serves keeping nothing, cheapest first, a box each with its name, price per million tokens and
  providers; readers only those that answer a fixed form, the Decisor only Jev) and under the list, fixed while it
  scrolls, «Ahora» and «Nuevo» with their scores, «Evaluar» and «Usar este modelo» (enabled only with a recent
  evaluation). Then the month's spending against the budget (a tile with its bar), the spending per model and
  «Cambiar el presupuesto»; «Claves» folded at the end (a password field in place; the key never comes back). What the
  models did is the page «Uso de la IA».
- **Registro** (Boni): an ordinary template page over the read-only «Ejecuciones» collection, with total runs, time and
  cost, a daily chart and the runs table. «Actividad» links to that page. The conversation's «Registro» keeps the
  detailed run list with each step and Undo; it does not require access to the audit.
- **Auditoría** (Boni, from the conversation; crumbs «Registro / Auditoría»): read-only, as a collection: «Verificar la
  cadena» (then `--good` «Cadena verificada» or `--bad` «La cadena no cuadra»), filters (a segmented Todos / Modelos /
  MCP / Boni / Personas and a select of collections; «Una ejecución ✕» when it shows one run), and a table of actions
  (Cuándo, Quién with its colour dot, Acción in words — «Buscó «dentista»», «Leyó», «Descargó una web», a refused one
  in `--bad` «Intentó: …» — and Sobre: the collections and records it saw, «con la nota» when the text reached it, what
  it changed). Fifty at a time, «Cargar más». A row opens its panel: who and when, «Lo que le llegó» (each record's
  title, its collection and fields, «con la nota» in amber or «sin la nota» in `--good`, the fields seen only as their
  shape), «Lo que escribió» (a model's own answer as plain text, or the records it changed), «Argumentos», whether it
  was allowed, and «Ver toda la ejecución».
- **«Mis datos»** (Boni, the sidebar's top; Juan, 2026-10-28: everything, with every way to manage it; «Todas las
  páginas» until 2026-11-04): two modes in a segmented control, Lista and Diagrama, kept per device. The list: the
  sidebar's «Páginas» as a table (Nombre, Elementos, IA, En la barra, Origen, "…"), each line indented
  18 px under its mother: the user's pages, the collections (a chevron opens one: its daughters, then all its notes,
  whatever its eye says; «Ninguno de sus registros tiene nota» when there are none) and «Boni», folded. A search
  (names and the notes' titles) or a level's chip lists what matches flat, each line with where it is, muted, after
  its name. The eye is a column; each collection's pill changes what the AI sees. "…" on a collection: «Nueva nota»,
  «Nueva colección dentro», «Mover a…» (the menu becomes the list of where it can go, «Al primer nivel» first, each
  with its mothers: never into itself or a daughter, never where it is) and «Eliminar colección»; on a note:
  «Mover a…» (it keeps its id and history) and «Mover a la papelera». «Nueva colección» beside the chips names one in
  place at the top. A spark in `--accent` marks a note an AI has read (who and when on hover). A note opens as its
  row's page, with the crumbs «Mis datos / its mothers / collection / title» and the page's own editor («/»
  and «+», data blocks included; the blocks Markdown cannot say are kept in the note's text as fenced «boni»
  blocks); Esc comes back. Below the table, what the collections take (next item).
- **«Mis datos» as a diagram** (task 59a; Juan, 2026-11-04: the collections as a database diagram, how they relate
  and what the AI sees; the schema visualizer of Supabase Studio and n8n's canvas as references): a canvas (React
  Flow, dots in `--line-strong`, zoom buttons bottom left) with a card per collection, 220 px wide, in
  `--surface-2` with a `--line-strong` border: its icon, name, the eye of its level and its count on the head, then
  its own fields, one 20 px row each, the kind muted on the right and a relation as «→ Target» in `--accent`. A
  mother is a dashed frame around her own card and her daughters' (nested when they are mothers too), her name at
  its top left. A relation field is an arrow (smooth steps, closed head) from its card to the collection it points
  to, labelled with the field's name and «· varios» when it takes several. Dagre lays it out left to right, mothers
  kept together; «Ordenar» lays it out again after cards were dragged. «Ver como» (Todo | La IA) is the other
  control: as the AI, a restricted or private collection fades to 28 % (no model reads it) and an opaque one keeps
  its head and fades its fields (a model knows it exists, never its content). A click opens the collection. Boni's
  own records are not in it. Computed from the schema, never drawn by hand (D-40).
- **Historial** (a row's page, the button beside its collection's name): a panel on the right with «Quién hizo qué»,
  «Cambios» (newest first, a dot in each one's colour: who · what, then when and which fields, Boni's hidden fields
  left out), its system columns (two columns, name muted), «Quién lo ha visto» («con la nota» amber, «sin la nota»
  `--good`) and «Ver la auditoría de la colección». While it is open the page itself shows who wrote what (Juan,
  2026-10-30): each block of the text, the title and each property carry a 3 px bar in the margin and a 9 % tint in
  the colour of who wrote it last (Juan on any device green, an MCP client violet, Boni's agents in their role's
  colour, the import grey); under the pointer a small label says who and when (and who else wrote part of it).
  «Quién hizo qué» lists each one with their colour and how much is theirs («4 líneas · 1 propiedad»); a click on one
  lights only theirs and brings it into view, a second click all again. Closing the panel leaves the page as it was.
- **System columns** (any table; Juan, 2026-10-24): Creado, Creado por, Modificado, Modificado por, Editores, Visto
  por, Último acceso de una IA, Origen, Versión, Tamaño. None shown by default; the view's «Opciones» has a «Columnas
  de sistema» panel to show each. Their cells are muted 12.5 px text, ellipsized (full text on hover), never editable.
- **«Mis datos»** (its list) ends with the tiles Registros, Almacenamiento, Historial and Textos de los modelos,
  Boni's storage advice when something grows (an amber-tinted line with a bulb; nothing is deleted by itself), and two
  bar lists: «Tamaño por colección» (data and history; a click opens the collection) and «Uso en 30 días» (read and
  edited; a click opens its audit).

## 7. Keeping it consistent
- A pull request that changes look or behaviour in Boni Calendar updates this file.
- Another Boni app that needs a new component first looks here; if the component is missing, design it in Boni Calendar's
  language, add it here, then reuse it.
- Screenshots in `e2e/screenshots/` (generated by the e2e suite) are the visual reference.
