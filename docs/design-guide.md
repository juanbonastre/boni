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
- **Boni's notices outside the app** (task 62, A-17): what Boni says on its own (a flow's «Avisar», the agent's
  `notify`, the month's budget) is a system notification on the phone and on the computer even when Boni is closed,
  so the summary of 08:00 is seen at 08:00. From Material 3 («Notifications»: short, timely information from an app
  that is not in use) and Apple's HIG («Notifications»: timely, useful, never a flood): only what Juan drew or asked
  for notifies, at most ten an hour (the server stops there), and NN/g's warning that interruptions cost attention.
  - **Android:** channel «Avisos» (high importance, it shows over the screen), the bell as its small icon, no title
    (the system's header already says «Boni»), the text as it came on one line and whole when expanded, its time; a
    tap opens Boni. The permission is asked once (Android 13 and later), the first time the app opens with a session.
  - **Desktop:** while Boni runs, its window open or only in the tray, «Boni» as the title and the text; a click opens
    the main window. Nothing inside the app: a notice is not a toast.
  - **The text is text:** at most 500 characters (the server cuts it), never bold or a link (on Linux its markup shows
    as it was typed), and it travels sealed for each device (the distributor never reads it).
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
  showed, as data it can change or delete. «Flujos», with its map, is a section of its own under «Mis datos» (F8); the
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
  de Boni», «Ejecuciones»). A run opens to its steps in words (task 52; task 90: each step by the editor's name, what came of it and what it does, never a rule's code), then «Leyó», «Hizo», «Propuso», «Decisiones» and «Modelos» as short lists; «Copiar» puts it all in the clipboard as text, headed as carrying text of his data; «Recorrido» draws it on the map (as from a turn of the chat and from a proposal's page). Nothing in it is a link or markup. A link block opens only a real page and says if its destination is gone. Under the page's
  name, «De Boni»; once changed, «Modificada», which opens the list of changes (+ added, − removed, ✎ changed, ⤢ another
  size, ↕ where the blocks are) and «Restaurar la de Boni» (Undo in the notice and Ctrl+Z). Removed, a template stays
  removed (the trash brings it back).
- **Boni's own collections** (`apps/server/src/systemCollections.ts`): in a database block they carry «De Boni · solo
  lectura» instead of a level of what the AI sees (no AI sees them): no «Nuevo», no editing, no opening a row. They
  are counted like any collection. «Mis datos» is the one a person changes (its rows are his collections and pages:
  the item «Mis datos» below), so it has no pill.
- **Databases as Notion's** (plan PR 19, `components/DatabaseBlock.tsx`, its head in `DatabaseHead.tsx`): "/" + a
  collection's name puts it on a page. **The head as Notion's** (task 69; Juan, 2026-11-05, with Notion's «Tareas BD»
  as the reference: «más limpio, menos texto»): on the left a collection's **views as tabs** (its own page and «Mis
  datos»), each its layout's icon and its name, the open one lit; a click opens one, a double click renames it in
  place (Enter or leaving keeps the name, Esc does not), the right button opens its menu (Cambiar nombre, Duplicar
  vista, Eliminar vista: never the last one); «+» («Añadir vista») shows the layouts as tiles (Tabla, Tablero,
  Lista, Galería, Calendario, Diagrama) and makes a view of that one, named after it and opened. A view still named
  after its layout takes the new one's name when its layout changes. The account keeps a collection's views
  (`rowUi.views`, at most 20), the same on every device; which
  one is open is this device's. A page's block keeps one view (in the page): its name, then that view's tab, which
  opens the layouts' tiles. On the right, **icons**: Filtro, Ordenar, Buscar (it turns into a field; the rows whose
  title has the words, nothing kept; Esc closes it), the view's settings (Ajustes de la vista), then «Nuevo». An icon
  whose part of the view is on (a filter, an order) is in the accent's colour. Filtro and Ordenar show **the bar**
  under the head, Notion's: the order on the left, a vertical line, the filters on the right and «+ Filtro», each a
  chip (the order's says its column with ↑ or ↓; a filter's says itself, «Estado es Leído»). Ordenar shows it with
  the order's chip open (its columns, Ascendente, Descendente, Quitar orden); Filtro with «+ Filtro» open (the
  properties): a property chosen adds its rule and opens its chip for the condition and the value; a rule without
  its value yet filters nothing. The bar stays while the view has an order or a filter, and goes when they go.
  **The view's settings** (its icon) are Notion's «⋯» of a view (Juan, 2026-11-03, task 41): the view's name (a field,
  on a collection's page), then a short list, each row saying what it is now on the right («Tabla», «5 visibles»,
  «Título ↓») with a chevron, and opening its panel in the same box (its head, «‹» and its name, goes back): Diseño
  (the layouts as tiles, the view's marked), Propiedades (each shown or not), Filtrar (the view's rules, as the
  bar's), Ordenar (none, or a column up and, again, down), Agrupar (a board's list), Fecha and «También en el
  calendario» (a calendar), Columnas de sistema (a table); under a line, the collection's notes in the sidebar (its
  eye), Duplicar vista and Eliminar vista. It opens on the list again. Table: the title column first, 34 px rows,
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
  content ends, and the views' tabs keep only their icons when the head is narrow.
  Boni's own tables have no boxes, menu or delete column; their widths and their views are kept too.
  Board: a column per option (and "Sin X" when used), cards dragged between columns change the select. Calendar: a
  month from Monday, today marked, "+" on a day adds a row on it; "Semana" shows seven tall days with every item
  (its start time over its title); "También en el calendario" (the view's settings) adds other collections, each with
  its colour and a legend. A filter (Notion's): a property, a condition that fits its type (es, contiene, está vacío,
  antes de / después de hoy or a date, mayor que…) and a value. On a page, the view (layout, sort, grouping, hidden
  properties) is the page block's; on a collection's page and «Mis datos», the collection's saved views; the rows are
  the collection's (`/api/data/*`, a personal device only).
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
- **Peek** (2026-10-22): a note opened from another app, or a mail from the conversation or a Bandeja card (tasks 30
  and 74; a mail shows as the mail client view) (a double click on an event in Boni Calendar; its "Abrir en
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
- **Boni over the screen** (F9, task 85; `BoniWindow.tsx`; docs/sistema.md §4.7, docs/conversacion.md C4): a 44 px
  `--accent` circle at the bottom right of every desktop screen but the conversation's own (its tooltip «Boni ·
  Ctrl+E»), and `Ctrl+E` in Boni's windows, typing or not, open the conversation over what is open: a 400 × 600 px
  window with a 12 px radius and the shadow of a popover, growing out of the circle in 200 ms (none with reduced
  motion), the same conversation as always in its compact form, with what Juan types going to its box. Its head says
  «Boni» with three icons: «Llevar a la derecha» (it becomes a side panel in the Bandeja's place; opening the Bandeja
  makes it float again, and the button turns into «Que flote sobre la pantalla»), «Ampliar» (the Conversación screen)
  and «Cerrar · Esc». `Esc` closes it before anything under it goes back. With a panel on the right (the Bandeja, a
  record), the circle and the window stay beside it, never over its cards. Each message goes with what is on the
  screen, by reference (what is open, the Bandeja's cards in its order, the rows chosen); the phone has no circle yet.
- **The conversation with Boni's agent** (Boni; `apps/boni-web/src/components/Chat.tsx`, docs/nucleo.md 7.14): a
  "Conversación" row at the top of the sidebar (with the number of proposals waiting), the third tab on the phone.
  **Its history as other AIs show it** (docs/conversacion.md 3.1; Juan, 2026-10-31): on the left of the conversation, a
  240 px column (task 92: widened by dragging its edge, 180–440 px, or with the arrow keys on its grip, and folded with
  the button beside «Nueva conversación» to a narrow rail that shows it again; both kept on the device) with «Nueva
  conversación», a search and the conversations by when they were used («Hoy», «Ayer», «Los
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
  (a quiet chip; its menu lists the account's own and the ones evaluated in Ajustes → Modelos, and links there) and a round
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
  came from (the mailbox, the sender and the subject, outside text with its mark, and the mail's two icons), its options as
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
  card (never "accept all"). A card from mail (a proposal's and a question's) ends its source line with two icons that
  a long sender never hides (tasks 68 and 74; Juan, 2026-11-05), 28 px buttons with an 18 px drawing whose mark is part
  of it at the same stroke, never a tiny badge (Juan: «el mini icono es demasiado pequeño para verlo, se ve raro»): the
  mail kept in Boni (an envelope with an arrow down beside it), which opens it without leaving the inbox: in the
  desktop app in the peek, its window of its own, as the conversation opens a mail (task 30); elsewhere in the side
  panel (closing gives the inbox back as it was; «Agrandar» there opens it whole); and, when the mailbox is Google's,
  Gmail's envelope in its colours with ↗ at its upper right («Abrir en Gmail»), which opens that very mail in its account (its Gmail
  thread, `authuser`; the server finds it, by IMAP's thread id for a new mail and once by its Message-ID for an older
  one; Gmail's search only when it is no longer in the folder). Their names are their tooltips. When the proposal also
  comes from earlier mails of its thread (a reply that moved it), «+1 correo» (accent text) unfolds them under the line,
  one per row: who, the subject and the day, each opening the same way. The line carries no amber mark: it says itself
  it is a mail (Juan, 2026-11-02). Detailed, "Por qué: «…»" (the reader's quote; in « » only when the code found those
  words in the mail). **Corregir** (the pencil): the title and the collection on two lines and, folded under
  «Propiedades» (Juan, 2026-11-02: there, but not all at once), the chosen collection's other properties, each with
  the same cell the table edits it with (an option from its menu, a relation from its picker, a box); accepting
  sends only what he changed, by the field's key. **«Ver correo»** opens the mail as a mail client shows it
  (`MailView.tsx`; D-22): the subject as its title, under it «En Gmail» with Gmail's mark when the mailbox is Google's
  (tasks 55 and 68: that very mail in its account), a
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
- **«Flujos»** (the sidebar, under «Mis datos»; `docs/flujos.md`, F1; `docs/sistema.md` §4.4, F8, 2026-11-06): one of
  Boni's collections, like «Mis datos»: a page with any collection's head (its views as tabs with «+», filter, sort,
  search, its settings and «Nuevo», which makes a flow by hand, off, and opens it), starting with two views:
  **«Tabla»** (Nombre; Disparador as it is said everywhere, «Llega a Correos», «Cada día a las 08:00», «Disparado por
  el usuario»; Estado; Versión de, Boni or Ti; Pasos; Ejecuciones; Última; Versión hidden: a name and the state change
  in place, a flow of Boni's keeps its name and is turned off, never deleted) and **«Mapa»** (below). A flow's name
  opens it on a page of its own; its row in «Mis datos» opens «Flujos». No «Modelos» tab any more (decision 3): what
  configures the models is Ajustes → Modelos, what they do and cost is on the map. On the phone «Páginas» lists
  «Flujos» under «De Boni»: there the map is looked at and a flow tried or run, never changed (no «Nuevo», in the
  header or under the table; its rows only open, nothing chosen, renamed, deleted or edited in a cell; the editor
  read only, with «Probar»); the map opens no smaller than half its size, so its cards can be read, the rest a finger
  or a pinch away.
- **The map** («Mapa», F8; dbt's and Dagster's lineage, Home Assistant's «Related» and Grafana's node graph as
  references): everything that brings, starts, reads and writes the account's data, computed by the server
  (`apps/server/src/flowMap.ts`, A-16) and never placed by hand: React Flow, dagre left to right (who acts, you, an
  assistant or the conversation, on the left with what they write, what they read coming back to them; where things come in
  first, where they end last; columns 150 px apart so an arrow's words fit between them), dots in `--line-strong`,
  the canvas taking the window's height. A card per node, 212 px: the mail connector («Correo · Conector», dashed), a
  collection («Tarea · 128 elementos», in `--surface`), a flow (an `--accent` border, dashed when off: its trigger,
  «42 ejecuciones · 0,41 US$», tags «De Boni», «Apagado» and its models' ids, and a chevron that unfolds its steps),
  Boni's own work that is not a flow yet («Conversación», «Revisar la guía», `--accent`), **the Bandeja** («Bandeja ·
  3 esperan»: what a flow in the background or the conversation proposes waits there), «Tú» («Desde tus apps»), an
  assistant («Asistente · claude-ejemplo · Por el MCP»), a page. An arrow per verb, its words in a pill: «trae · 42»,
  «pone en marcha · 42», «lee», «escribe · 61», «propone · 12» (dashed, into the Bandeja), «aceptadas · 7» (out of it,
  to each collection), «decides · 11» (yours, in it), «tus decisiones · 11» (to the guide's reviewer), «mejora»,
  «muestra»; one that carries a mail's words with a small mail in its words and a dotted line («Lleva texto de fuera»
  on hover; a colour of its own until task 91, read as something lit), its words keeping the mark when lit; one going
  back, right to
  left (what you or the conversation read, a lesson to an earlier flow), says its words only when it is lit, so they
  never cover a card's name. The Bandeja is crossed, not
  counted: «Profundidad: 1» of Evento shows the Bandeja and, in the same step, the flows that propose into Evento (not
  those that propose elsewhere), each «propone» with what went to Evento (not its total), so «who writes in Evento»
  still reads «Leer correo (propone · 3)»; «Profundidad: Todo» of the mail goes Correo → Correos → Leer correo →
  Bandeja → Tarea, Evento and → Revisar la guía → Leer correo. «decides» counts your decisions, not what Boni accepted alone
  («Solo»); «tus decisiones» only those on the mail's proposals (the reviewer learns from nothing else), and the lens
  goes from the Bandeja to the reviewer only from «Leer correo». What you moved to another collection as you
  accepted it counts where it went. Without a centre
  it shows everything joined to something (a node alone says nothing), pages only with «Con páginas». Over it, one
  bar: **«Buscar en el mapa»** (by name; Enter takes the first) puts a node **in the centre**, then a chip «En el
  centro · Tarea ×» and **«Profundidad»**, one slider (140 px) from 1 to as deep as the centre reaches, its value said
  beside it, the deepest as «5 (máx.)» (arrows back and forth at once, dbt's `+model+`; task 90, Juan, 2026-11-06: «una
  sola barra deslizante», instead of «Antes» and «Después»; task 91: «el número con un máximo»; a depth saved by «Antes»
  is read as one);
  **«Agrupar»** (Sin agrupar; Por disparador, frames «Llega a Correos», «Disparado por el usuario», «De Boni»; Por
  flujo, every flow unfolded into its steps; Por colección, a frame for each collection that holds others; Por paquete,
  «Correo» round its connector, collection, flow and reviewer); **«Filtros»** (Solo con IA, Solo lo que escribe, Solo
  lo encendido, Solo lo que pasó, an arrow with a number in the period; Con páginas), with a count on the button when
  any is on; and the period (7 días | 30 días). The lenses, the
  grouping and the period are kept on the device; «Flujos»' own filter and search take flows off the map too.
  Hovering a card lights its arrows and quiets the rest; a click shows its panel docked on the right (300 px; a sheet
  at the bottom on the phone): its name and kind, its numbers («7 propuestas · 4 aceptadas», «21 llamadas a
  modelos», its models), **«Entra»** and **«Sale»** (each arrow's other end as a link that chooses it, with its verb
  and number), and «Poner en el centro», «Ver los pasos» / «Plegar los pasos» on a flow and «Abrir» (primary: a flow's
  page, a collection's, a page, the conversation); a double click opens it; the right button gives the same as a menu.
  A box chosen out of view is brought to the middle. An unfolded flow is a frame with its steps inside, laid out as
  its editor lays them out, **from what starts it** (a first box with ⚡, «Llega a Correos» and what it brings,
  «Correo · Texto», as the editor's trigger), its arrows leaving from the steps that make them; each step by the name the editor gives it («Lectora»,
  «Crear», «Regla del remitente»: never a tool's id), what it does in one line in its tooltip («Elige la colección; si
  duda, te pregunta en la Bandeja.»), and a model's step with its calls and their cost in the period («42 llamadas ·
  0,21 US$», also when its model is not known). A lane's name over its column is cut with «…» to its lane's width,
  the whole in its tooltip, so two lanes' names never overlap. Every box sits above every arrow, and an arrow's words
  show only where they cover no box and no other words: the rest when one of its ends is pointed at (a run's way
  too). What carries a mail's words has a small mail in its words («Lleva texto de fuera» on hover), never a colour of
  its own (task 91: Juan read the pink arrows as something lit). Under the map, on the right, whose numbers they are:
  «Las cifras son de los últimos 7 días» and, with a run on it, «En naranja, lo de esta ejecución» in `--c2` (beside a
  box's panel, never over it; on the phone, away while the panel is open, and under the map when a run's card stands
  above it). A click
  on a step opens its own panel: its name, «Paso de «Leer correo»», what it does, its model and «42 llamadas · 0,21 US$
  en 7 días». The map fits what it shows whenever its
  boxes move, never on a hover. **«Ver en el mapa»** (I-25), in the right-click menus of a collection, a page, a row,
  a block over a collection and a flow, opens it with that in the centre and its panel open (an Inbox card's menu has
  «Abrir propuesta» and «Recorrido»; text chosen in the card keeps the browser's own menu); a page put in the centre shows the pages while it is there; what the map does not have
  (a page none of whose blocks shows a collection) says «No sale en el mapa» and opens it whole. **A run's
  «Recorrido» is the map** (I-25, task 90; Juan, 2026-11-06: «teniendo el mapa, no tiene sentido tener lo del
  recorrido»): from the Registro, an Inbox card's menu, a proposal's page and a turn of the conversation, the run is
  drawn on it, its whole way on the map whatever the depth, over the version of its flow it ran (an earlier one when
  the flow changed since): its flow unfolded from what started it, each step with what came of it («Hecho», «Propuesto», «No se
  ejecutó», «Parado: una regla de seguridad lo impide») and, in orange, its own calls and their cost («Hecho · 1
  llamada · 0,0021 US$»; the period's numbers leave the step while a run is on it), what did not run faded; **its way in
  orange** (`--c2`), from the mail's connector through the collection, what started the flow, each step that did
  something and, between two of them, the shortest way along the canvas's arrows (never another lane's: task 91, «se
  activan para todas las líneas»), the Bandeja after the step that proposed and the collection after it (what the
  run only read is not on its way). **A light goes along it again and again** (task 91: «una animación constante… de
  forma lenta… desde principio a fin»): each box and arrow glows in its turn, 0.7 s apart, the cycle as long as the
  way plus three steps, and the arrows' dashes move slowly (2.6 s); still when the system asks for less motion; the
  rest quiet. **What came out of each box**, in its panel, under «En esta ejecución» in an orange frame (task 91: «en
  la tarea, los datos de la fila generada; en la bandeja, esa tarjeta generada; dentro de algún paso, lo que ha enviado
  al siguiente paso de forma legible»): the mail (its subject and first fields) on the connector, the collection and
  the trigger; a step's line, its calls and cost, and what it gave the next one, said as a person reads it (a list as
  its items by title, a record as its fields by name, «Eligió: Gestiones», a day as «23 oct 2026», never JSON); the
  proposal a «Crear» made; the Bandeja's card for each proposal with its fields and what became of it; a
  collection's record as it was saved, its fields by name, or «espera en la Bandeja». A model's words stay text. A card
  over the top left corner, **«Explicación»** (task 91, formerly «Por dónde fue»), with «×» to hide it (kept hidden on
  the device; a chip «Explicación» brings it back, and the map fits below it while it is there), tells it in words («Empezó con «Reunión con secretaría el
  jueves» (Correos)», «Leer correo (v3) · 20 oct, 11:05», «Propuso «Preparar la reunión» · aceptada», «Escribió
  «Café» en Gastos»; three of each, then «y 2 más»), with **«Detalles»** (each step in the Registro's words and what it
  does, what a model answered, «Leyó», «Decisiones», «Modelos»; «Menos» folds it) and «Copiar»; and a chip «Ejecución · 6 nov,
  00:52 ×» that takes both away. **«¿De dónde viene?»**, in a
  row's right-click menu (not in Boni's own collections), asks the server who made the record: one a flow or the
  conversation proposed or wrote opens the map with that run drawn on it and the card titled «¿De dónde viene
  «Pedro Páramo»?»: the mail it started with, the run, «Lo propuso como «Pedro Páramo»» (and «y propuso 1 más»), and
  the «Aceptar» («Lo aceptaste · 20 oct, 13:30», or «Boni lo aceptó solo»); a run is drawn where the server says it
  belongs (its flow, the conversation, the reviewer, the Bandeja for an «Aceptar», «Leer correo» for a reading from
  before flows, whose mail is the one its plan read first); one
  written by hand, by an assistant, by an import or by the connector says so in a notice («Lo escribiste tú, en
  portatil, el 21 oct, 19:45»), with no map.
- **A run drawn in the conversation** (task 92; Juan, 2026-11-06: «dibujar el diagrama metiendo esa vista de mapa
  dentro del chat, de una forma sencilla; ya si quiero tocar opciones haría clic en un botón de ampliar»): the reply
  component «run» (the planner gives it a run that `entities.origin` or `inbox.pending` named) draws its way as the
  map does, in a row that wraps: the mail's connector, the collection with «Reunión con secretaría el jueves», the flow
  with what came of it, the Bandeja with «Preparar la reunión» · aceptada, the collection where it went, each box in
  orange with an arrow before it and the same light going along them again and again (a proposal still waiting: the
  collection it would go to, dashed and still, «espera en la Bandeja»; words from a mail or a model dotted underneath,
  «Viene de fuera» on hover); «Ampliar» under it opens the map with the run on it. Only a run a tool gave is drawn,
  never an id a model wrote. Its names are the map's; who proposed something is said by its name («lo propuso Leer
  correo»), never by a code.
- **A flow's page** (F8): «Flujos › Leer correo» above it (the crumb goes back to «Flujos») with the period (7 días |
  30 días) on its right, then the editor, its canvas taking the window's height.
- **The flow editor** (F2, `docs/flujos.md` §4.5; n8n's canvas and node panel and Dify's checklist as references):
  a flow's page. A toolbar: the name (edited in place), a pill saying whose version runs («De Boni» in `--accent`, kept
  up to date by Boni; «Tu versión», which Boni no longer changes), the «Encendido» switch, «Añadir paso» (task 70: a search on top, «Buscar paso», which takes the keys at once and finds
  a kind by its name, its group's or its tool's, Enter taking the first once something is typed, «Ningún paso se
  llama así» when none; under it the kinds in groups by what they do, Leer, Decidir, Datos, Avisar, Preguntar,
  Responder and Otros, and **«De Boni»** in a flow a mail starts (F7, `docs/sistema.md` §4.2: Boni's pieces, named as
  what they do, «Regla del remitente», «Ya propuesto», «Leer invitación», «Buscar relaciones», «Plegar hilo», «Aceptar
  solas» (2026-11-06; Juan did not know what «Lo pendiente», «Invitación» or «Relaciones» meant), the code that works
  on the mail, which only such a flow has), a group with nothing to offer left out, each node named in a word; never a step
  that runs or saves a flow),
  «Ejecutar» on a flow by hand (its form first when it asks for something; it runs as a turn of a new conversation,
  where its replies, questions and confirmations show as always), then «Descartar» and «Guardar» (primary, enabled
  only with changes and an empty checklist) and «⋯» (the versions, each «vN · Tú/Boni · date», a click goes back to
  it as a new version; «Volver al de Boni» on a flow Boni keeps; «Ver en el mapa»; «Duplicar»; «Eliminar» on the
  user's own, a second click to confirm). Under it the checklist, in a `--bad`-tinted box, one line per problem («Crear: Colección:
  falta»), a click selects the step. The canvas lays itself out (I-26; 2026-11-06: «Leer correo» opened in a heap,
  positions left over from an older version, «Aceptar solas» on top and «Guardar» lit with nothing changed): the
  trigger on top, the steps downwards in the order they run, those that run only for one choice side by side in lanes
  named by the choice (an `--accent-soft` pill over each lane's first step: «Tarea», «Evento»; cut with «…» at the
  lane's width, 184 px, the whole name in its tooltip), a grey arrow from each
  to the next with a «+» on it (shown on hover; none into a lane) that puts a new step there, and, for the chosen
  step, its values' arrows dashed in `--accent` round the right side, the steps it takes them from ringed. A card's
  line says what it works in and over («Tarea · cada tarea», «Tarea · cada evento», «Tarea · la invitación»), one
  row per line (the whole line in its panel and its tooltip). A step that writes in the collection the decider chose
  («Crear en la elegida», docs/sistema.md §4.2) says «En la elegida · cada cosa», and its panel's «Colección» says
  among which, in words («La que elija la Decisora: Tarea, Evento o Persona»), not as a list to choose from: Boni's
  «Leer correo» has one «Rellenadora» and one «Crear» for everything the reader finds («cada cosa»), the invitation's
  «Crear» apart («la invitación»), and no lanes (D-49). The decider's panel, here and on the map (task 83), says under
  its line (which already says it asks when unsure) what it chooses among («Elige entre Tarea, Evento y Persona.»,
  from the `case` over the collection of the steps after it) and, when it takes «Regla del remitente»'s answer,
  «Reglas de tu guía» (11.5 px, semibold, `--text-2`) over one row per rule that chooses for it: one that sends a
  sender to one of its collections and that no earlier rule takes first (the first that matches wins); the address as
  Juan wrote it (it breaks anywhere) and «→ Tarea» muted. With none, no heading; with nothing to say, no block (no
  explanations in the app, §5). A rule that skips a sender is «Regla del remitente»'s, not listed here. A piece of
  Boni's card says so in its line, with what it may change: «De Boni · lee», «De Boni · cambia la Bandeja». A piece's
  settings are in its panel (task 83): «Plegar hilo»'s «Días» is a setting of its step like any other, and its panel,
  here and on the map, says the days the server takes («Mira 60 días atrás en el hilo.»; a whole number from 1 to
  366, else 60; «1 día»); «Aceptar solas» shows «Solo» with the switch of Ajustes → Decisiones (the same one, asked
  again each time its panel opens), greyed until earned, and under it, muted, what Ajustes says of it («Apagado por
  Boni el …», «Todavía no se lo ha ganado»), nothing when earned. A trigger whose records the mail's connector brings
  says so under its name, muted, as its draft says: «Viene del conector Correo». Boni's «Traer correo» (D-50) starts
  with «Llega correo al buzón», a trigger that is not changed in its panel (as a record's) nor run by hand, and its
  one step, «Guardar en Correos», says «De Boni · guarda en Correos» (a piece that changes something says what, in
  its own words, when it has them); on the map the mail goes from the connector to «Traer correo» and on to Correos,
  and a reading's Recorrido lights that way too. Boni's «Revisar la guía» (D-51) starts with «Cuando tus decisiones
  lo piden», fixed in the same way, and reads «Tus decisiones» → «Revisora» → «Medir releyendo» → «Sugerencia», the
  last card saying «De Boni · deja una sugerencia»; on the map it replaces the reviewer's own box, learning from the
  Bandeja and improving «Leer correo». «Función» (task 93, D-52), offered in «Añadir paso» under «Funciones» with
  «Aplicar cambios» only while an extension's function is active, chooses among them in a select («Banco ·
  importar»), with «Código» under it (a `<details>`, the code in a scroll of at most 240 px, to read, never to edit)
  and «Pruebas (n)», its tests' names; «Aplicar cambios» takes its result whole, and in the Bandeja its card is
  titled by the function's name and its summary («Banco · importar: 2 nuevos») with its numbers and its questions
  as rows by name («Función», «Resumen», «Nuevas», «Cambiadas», «Preguntas»), never JSON or a key; one that no longer
  gives the same set says «Ya no vale» when accepted. Nothing is dragged, nothing of where things are is kept, no «Ordenar»: looking
  never asks to save. The wheel scrolls the canvas (Ctrl or a pinch zooms); it opens fitted to
  its first eight boxes at a size to read (at most 100 %), the rest a scroll below. An arrow drawn from one node to
  another asks where the second uses the first's value
  (a small menu, «Usar en», of its settings by the names its panel gives them) and moves it after the first when it
  ran before (task 78; Juan, 2026-11-05: «no puedo conectarlo entre ellos»: the dots were a pixel): a 12 px dot under a
  step (the accent's) to drag from and one over each step to land on, shown under the pointer and, while an arrow is
  drawn, on every step; the arrow lands on a step wherever it is left on it, and left on the canvas it opens «Añadir
  paso» there, the new step going after the one the arrow came from and then asking where it takes the value; the
  trigger has no dot (its values are the flow's inputs, taken by name). The right button on the canvas opens «Añadir
  paso» there, the step going after the chosen one or at the end (task 78). Supr removes the selected node, the
  right button on a node opens its actions where the pointer is, without opening its panel (task 70: Abrir, its
  panel; Duplicar, a copy right after it under an id of its own; Probar hasta aquí,
  the flow tried as far as it and the test bar saying «hasta «…»», greyed while a test runs or with a problem up to
  it; and Quitar; the trigger has only Abrir), a click opens its panel on the right (340 px): its name, id and
  «Quitar»; its
  problems in `--bad`; **«Entra»** (task 70: each value it takes, what the trigger binds by its name, «Correo»,
  «Texto» (F7, I-08), an earlier step's by the step's name and the path in it, «Lectora › tasks», «Buscar relaciones ›
  tarea», a loop's item as «Elemento › quote», with what it is, «texto», «lista», «registro», muted on the right; «Nada
  de antes» without any); what it is (the tool, among those «Añadir paso» offers, the reader, the question, the reply)
  and its settings from the catalog's schema (the
  tool, the reader, the question, the reply) and its settings from the catalog's schema: a collection as a list of
  the collections (changing it, the record's fields follow their roles and the collection's inputs, `$fill.<key>`,
  its key), a record's values as rows of field and value (the parts it is merged with as chips), any other as a
  value field: a kind (Texto, Número, Sí o no, Valor de, Función, Nada) and its input; «Valor de» offers the values
  that step may take (the server computes them: the trigger's, the earlier steps', `$item` in a loop). Then «Solo
  si», «Para cada» and «Junto con»; under a line, **«Sale»** (what it gives the steps after it, itself and its
  fields, as «Entra» shows them: the server computes them with the values a step may take; a reply gives «Nada»),
  and after a test «En la
  prueba» (what it gave or would do, the node's lines in full; «No llegó a este paso» when the test stopped
  before). The trigger's panel and node name what it binds as a person says it («Correo», «Asunto», «Destinatarios»,
  «Guía», «A petición», «Dónde escribe», «Ya propuesto»; F7, I-08: never `$mail`): «Llega a Correos» (the collection by
  its name; «Nuevo correo» until 2026-11-06) with what it binds, «Disparado por el usuario» (task 78; «A mano» until
  then) with the
  names its form asks for, or **«Programado»** (F4): «Cuándo» (Cada día, Cada semana with its «Día», Cada hora) and
  «A las» as two lists, the hour and the minutes every five (never a time field: it shows AM/PM in an English
  browser), or «Minuto» every hour; the node says it in words («Cada día a las 08:00», «Cada lunes a las 07:30»,
  «Cada hora a y 15») and gives `$today`. «Ejecutar» runs a scheduled flow now too. The «Añadir paso» menu never
  offers «Ejecutar flujo» (a flow does not run another). A node with a problem has a `--bad` border; the selected
  one an `--accent` ring.
  **«Probar»** (F3; n8n's «Test step» and Dify's debug run as references) runs the draft as it is, dry: with the
  latest mail for a mail flow, or with the one chosen in **«Probar con…»** (F7, task 63 point 6: an icon button beside
  it, a list of the mails by subject, newest first, «Buscar correo» filtering it as one types), with the form's
  values for one by hand. Boni's pieces run too and say what they found (2026-11-06; «Hecho» said nothing): «Va a
  Tarea», «Sin regla: sigue» or «La guía dice no leerlo: acaba aquí»; «Nada propuesto antes» or «2 ya propuestos»;
  the invitation's event («Reunión con secretaría · 06/11 12:00»), «No es una invitación» or «Ya está en un
  calendario»; the relations found («Persona: Ana Ejemplo») or «Sin relaciones»; and «Sin propuestas en la prueba»
  for «Plegar hilo» and «Aceptar solas» (a dry run proposes nothing, so they find nothing to change). Readers and the decider are called (it costs
  what a reading costs); nothing is written, notified, proposed or confirmed, and a question ends it. A bar over the
  canvas in `--accent-soft` says with what («Prueba con «Informe y sala» · sin escribir nada», or where it stopped)
  and has × to take it away; each node says what came of it in its line: «→ 2 elementos», «→ «Gestiones»»,
  «Propondría: Crear en Docencia «Enviar el informe»», «Haría: Avisar «…»», «Preguntaría: …», «No se ejecuta (Solo
  si)», «Parado: P4»; a node it never reached fades. Changing the draft takes the test away (its lines are stale).
- **A proposed flow in the inbox** (F5): a card like a proposal's, «Flujo propuesto» as its kind, the flow's name as
  its title (or «Cambio en «Resumen diario»» when it changes one), a line with when it runs and how many steps
  («Cada lunes a las 08:00 · 2 pasos»; for a change, «1 paso nuevo · 1 quitado»), the flow drawn read only (320 px,
  as the editor draws it: the trigger with what it gives, each step named, its arrows), what it adds with an
  `--accent` border and «Nuevo», what it changes with a dashed one and «Cambiado», what it takes away faded and
  struck with «Quitado»; «Activar» (primary) and «Rechazar».
- **A run in the Registro** (task 90, I-27): in words only, with no drawing of its own (its drawing is the map's,
  «Recorrido»): «Recorrido» and «Copiar» on top, the request, then each step by the name the editor and the map give
  it, with the words of the request it took («Buscar «informe»»), what came of it («Hecho», «Propuesto», «No se
  ejecutó», «No llegó», «Acaba aquí», «Parado: una regla de seguridad lo impide», «Parado: lo paraste tú») and what it
  does in one muted line; a model's answer folded under its step, as text; then «Leyó», «Hizo», «Propuso»,
  «Decisiones» and «Modelos» («Planificador · m-ejemplo · 1200 → 80 · 0,004 US$»). No tool id, `$` reference or
  rule code on screen: «Copiar» alone adds the code after why it stopped («(P2-untrusted-destination)»), to fix it,
  with each step's line of what it does under it and the run's own status in words on its first line. A stop says
  why in words: «una regla de seguridad lo impide» (the policy's rules and what a model may read), «se llegó al límite
  de gasto de hoy», «se llegó a un límite de la petición», «lo paraste tú», «un fallo al hacerlo».
- **Ajustes → Modelos** (again its place, 2026-11-06: the tab «Modelos» of «Flujos», task 59b, is gone with its declared
  canvas; what every model does and costs is on the map's flows and steps, `docs/sistema.md` §4.4): what configures
  the models: «Usos», a card per use with a one-word name and its icon (Agente, Lector, Decisor, Revisor),
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
  páginas» until 2026-11-04; a collection since 2026-11-05, F6b: «que la sección se comportase como una página de
  colección»): the page of one of Boni's collections, «Mis datos» (`apps/server/src/myData.ts`), laid out as any
  collection's page: its title, then the head of its block, as any collection's (its views as tabs with «+», the
  diagram one of their layouts; Filtro, Ordenar, Buscar, the view's settings; «Nuevo»). A row per page of the user's (each after its mother), per
  collection (each mother before her daughters, by name), then Boni's own (its template pages and its records). Its
  columns: Nombre, Tipo (Página, Colección, De Boni), Padre («Madre» until task 77: Juan, «me suena raro»), Nivel (the
  level's pill), Elementos, En la barra (the eye: its notes in the sidebar), Leída por, Escrita por and Origen (hidden
  at first). Nombre, Padre, Nivel and En la
  barra change in place and are done to what the row is, with their usual rules and toasts: a name used once, a
  private collection lowered only from its own page («Una colección privada solo se abre a la IA desde su página.»),
  only an empty collection deleted; what does not apply to a row is plain text (a page has no level nor eye; Boni's
  rows have no box and no bin). «Nuevo» makes «Nueva colección» (then «… 2»); a row's bin deletes it, with
  «Deshacer». A click on a row's name opens what it is: the collection's page, or the page. Its views (each its
  layout, filters, order, columns) are kept in the account as any collection's (task 69; until then, one view on the
  device, which became its first). Below the block, what the collections take (the last item of this list).
- **«Mis datos» as a diagram** (task 59a; Juan, 2026-11-04: the collections as a database diagram, how they relate
  and what the AI sees; the schema visualizer of Supabase Studio and n8n's canvas as references): a canvas (React
  Flow, dots in `--line-strong`, zoom buttons bottom left) with a card per collection, 220 px wide, in
  `--surface-2` with a `--line-strong` border: its icon, name, the eye of its level and its count on the head, then
  its own fields, one 20 px row each, the kind muted on the right and a relation as «→ Target» in `--accent`. A
  mother is a dashed frame around her own card and her daughters' (nested when they are mothers too), her name at
  its top left. A relation field is an arrow (smooth steps, closed head) from its card to the collection it points
  to, labelled with the field's name and «· varios» when it takes several. Dagre lays it out left to right, mothers
  kept together; «Ordenar» lays it out again after cards were dragged. Boni's own records are not in it. Computed
  from the schema, never drawn by hand (D-40).
  **Who reads and writes it, and editing it there** (F6, `docs/flujos.md` §4.7; «Ver como» is gone): under its
  fields each card has two muted 11 px lines, a pen with who writes it and an eye with who reads it (the flows whose
  steps name it, then who did in the last 30 days: «Tú», «Asistente · …», a model's use, «Boni»; two names and «+N»).
  In «Mis datos» it is one more layout of its views: its filters fade what they leave out to 28 % (nothing moves),
  its «Nuevo» makes a collection, and the canvas's toolbar has only «Ordenar». In a collection's «Diagrama» the
  toolbar has filters as small lists, «Leída por», «Escrita por» and «Nivel», with the same fading, then «Nueva
  colección» (a name field under the toolbar, «Crear» and «Cancelar») and «Ordenar». A click on a card opens its
  panel on the right, as the flow editor's (its
  name and count, «Nivel» with the level's pill and menu, «Escrita por» and «Leída por» with each flow «flujo
  encendido/apagado» or how many times in the period, «Abrir» and «Nueva colección dentro»). A drag from a card's
  right edge (a dot in `--accent` on hover) to another card draws a relation: a column of the first named as the
  second, said in a toast with «Deshacer»; the arrow lands wherever it is left on the card (a dot on each card's left
  shows while it is drawn; task 77: Juan, 2026-11-05, «no puedo conectar con nada»: the dots to land on were a
  pixel), and left on the canvas it opens the new collection's name form, the first then pointing to it. A card at
  the top level dropped on another card or frame goes inside it, also with «Deshacer». **The right button** on a
  card or a mother's frame (task 77) opens its actions where the pointer is: Abrir, «Abrir {padre}» (one inside
  another), Cambiar nombre (the name form, filled), Nueva colección dentro, «Sacar de {padre}» (to its parent's
  parent, with «Deshacer») and Borrar (only an empty one, greyed otherwise; with «Deshacer», as «Mis datos»' bin);
  a collection a connector fills, only Abrir. An arrow released back on its own card relates nothing. What the diagram changes shows in «Mis datos»' table at once (its rows read again). **A collection's «Diagrama»** is one more of its layouts (Tabla, Tablero, Lista, Galería,
  Calendario, Diagrama): the same canvas over her branch, with the collections a relation joins to it as dashed
  cards without fields.
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
  por, Último acceso de una IA, Origen, Versión, Tamaño. None shown by default; the view's settings have a «Columnas
  de sistema» panel to show each. Their cells are muted 12.5 px text, ellipsized (full text on hover), never editable.
- **«Mis datos»** (under its block) ends with the tiles Registros, Almacenamiento, Historial and Textos de los modelos,
  Boni's storage advice when something grows (an amber-tinted line with a bulb; nothing is deleted by itself), and two
  bar lists: «Tamaño por colección» (data and history; a click opens the collection) and «Uso en 30 días» (read and
  edited; a click opens its audit).

## 7. Keeping it consistent
- A pull request that changes look or behaviour in Boni Calendar updates this file.
- Another Boni app that needs a new component first looks here; if the component is missing, design it in Boni Calendar's
  language, add it here, then reuse it.
- Screenshots in `e2e/screenshots/` (generated by the e2e suite) are the visual reference.
