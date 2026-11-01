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
  order; `Ctrl+Shift`+click adds or removes one event. Dragging one selected event moves all of them. Click on empty space
  or `Esc` clears. While `Ctrl`/`Shift` is held the popover lets clicks through, except while typing in a field (`Shift`
  for a capital letter must not fade it).
- **Ctrl+click opens the event's note** (like a link): from the desktop app, in Boni (a double click, in its peek). An
  event without a note (sample data, not saved yet) is just selected. Decided by Juan, 2026-10-16; until then
  `Ctrl`+click toggled the selection and `Ctrl+Shift`+click added a range of one calendar.
- **Series:** repeating an event creates one entry per occurrence (up to 12 months ahead; the server tops up open-ended
  series). The same "this / this and
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
  opens and every half hour. The address of a private calendar is a secret: it stays on the device or in the account,
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
    anything that can be interrupted; only `transform` and `opacity`; never `transition: all`.
  - Buttons (`.btn`) answer a pointer press with `scale(0.97)` in 120 ms.
  - **"Reduce motion"** (`prefers-reduced-motion`) is respected in both apps: transitions and animations collapse, and the
    calendar's viewport lands jumps and zooms at once (its smoothing time drops to 1 ms).
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
  - **Small things:** a notice sits above the + button; no greeting toast (Inicio says the day); dates in the account's
    language; one chart on the whole screen with period chips; a tap on a chart shows the value and a second tap opens
    the detail. Same tokens and card recipe; written deviation for the thumb: 16 px text, 48 px touch targets, 20 to
    24 px icons. Back (and Android's button) closes the top thing, then goes a step back in the place, then to Inicio.
- **Desktop widgets** (Boni): a chart card alone in a small transparent window that sits on the desktop, below every
  window (on X11 a "dock" window kept below by the window manager; it survives "show desktop"). It keeps the card look
  (`--surface`, 10 px radius, `--line-strong` border) and is fully interactive: hover for values, click for a detail;
  dragging anywhere moves it, the bottom-right corner resizes it; on hover it shows its period and its menu (the chart
  controls below, compact), and right click opens the same menu (open or edit in the app, refresh, hide here, remove).
- **Boni's main window** is laid out as this app: the sidebar, the main area and the right side panel. The sidebar
  (Juan, 2026-10-28; docs/clases.md §2.7): Buscar, the conversation and «Todas las páginas» at the top; then two
  sections, each folded and unfolded by a click on its name (a chevron beside it on hover; kept on this device):
  «Recientes» (the last five pages, collections and notes opened here, newest first, hidden while there are none) and
  «Páginas», only to open, add and delete: the user's pages as a tree (each row's "…": add a subpage, duplicate,
  delete with Undo; "+" by the name of the section makes a page), then the collections, each inside its mother and
  folded by default, with its records that have a note under it when its eye says so (on hover: the eye, "…" with
  «Nueva nota», «Nueva colección dentro» typed in place, «Eliminar colección», only an empty one; "+" makes a note),
  then «Boni», folded: Boni's template pages and its own collections, read only. What is open is lit there (Juan,
  2026-10-30): opening a page, a collection or a note (from anywhere: Recientes, a table, a link, the search) unfolds
  «Páginas» and the pages or collections above it and scrolls to it; a note whose collection does not show its notes
  lights its collection. A branch folded by hand stays folded until something inside it is opened. The trash,
  settings and the user at the bottom. **Nothing on screen is fixed by the app** (Juan, 2026-10-21): no home of charts, no "Apuntar
  gasto" button, no list of charts. The window opens on the last page seen on this device (else the first); with no
  pages, a welcome with "Nueva página" and "Hablar con Boni". Every account gets Boni's template pages once («Uso de
  la IA», «Actividad», «Registro»); an account that used the first Boni got, once, a page "Gastos" with what its home
  showed, as data it can change or delete. Modelos is in Ajustes; the conversation also keeps the detailed run log.
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
  de Boni», «Ejecuciones»). A link block opens only a real page and says if its destination is gone. Under the page's
  name, «De Boni»; once changed, «Modificada», which opens the list of changes (+ added, − removed, ✎ changed, ⤢ another
  size, ↕ where the blocks are) and «Restaurar la de Boni» (Undo in the notice and Ctrl+Z). Removed, a template stays
  removed (the trash brings it back).
- **Boni's own collections** (`apps/server/src/systemCollections.ts`): in «Todas las páginas» and in a database block they carry
  «De Boni · solo lectura» instead of a level of what the AI sees (no AI sees them): no «Nuevo», no editing, no opening
  a row. They are counted like any collection.
- **Databases as Notion's** (plan PR 19, `components/DatabaseBlock.tsx`): "/" + a collection's name puts it on a
  page; its head has the name, the layouts (Tabla, Tablero, Lista, Galería, Calendario), "Opciones" (sort, a board's
  grouping select, a calendar's date, visible properties) and "Nuevo". Table: the title column first, 34 px rows,
  hairline grid, each cell edited where it is (text and numbers as a field, Enter or leaving saves, Esc does not;
  selects as Notion's coloured pills from a menu; checkboxes at once; relations read-only), delete on hover with Undo.
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
  Copiar enlace, Borrar; with several chosen, «Borrar N»); a row not chosen is chosen alone first. On a collection's
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
  goes up to the mother (from the top, to «Todas las páginas»). "Una parte con otro nivel…" (in the pill's menu) opens
  the collection's rules: each is Notion's filter editor and a level, listed in words ("Título contiene Tutoría ·
  Restringida"); the pill shows "+N" when there are rules. Whatever would lower something private asks for the
  collection's name, and only on its own page.
- **Notes as pages** (2026-10-22): a row's text is edited with the page's block editor (headings, lists, to-dos,
  quotes, code, dividers; "/" offers text blocks only), saved as Markdown; what it does not paint yet (tables,
  an Obsidian embed that found no file, inline bold or links) shows as written. A note is titled by its first `# Heading`, never its file's slug.
  Its properties start folded under one quiet line ("12 propiedades", a chevron); unfolded ("Ocultar propiedades")
  they stay so for that collection. Each property hides with the eye that shows on hover (as Notion's); hidden ones
  wait, dimmed, under "N ocultas" at the end, where the same eye shows them again. The account keeps both per
  collection (Boni, Boni Calendar's peek, every device). A note opens on its text, not on a list of properties.
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
- **Peek** (2026-10-22): a note opened from another app (a double click on an event in Boni Calendar; Ctrl+click and
  its "Abrir en Boni" open the note in Boni's main window instead). In Boni Calendar with Boni's address (Settings →
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
  Settings has "Lo que ve la IA" after the account (one row per collection with its count and a three-way segmented
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
  links, no images; what came from outside (an e-mail, a page) keeps a 2 px amber mark on its left and says so on hover.
  A question shows its options as pills (one line, cut with an ellipsis) and never asks for a password. A
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
  window the sidebar gives it room) and the same cards in Conversación → Bandeja. A card says what the proposal does
  in words made by code ("Añadir tarea a Docencia", "Añadir evento a …"), where it came
  from once (the mailbox and the sender, or the note's path; never "Viene de fuera" on every row), its day and times,
  and a mini calendar: the day (detailed) or the day before, the day and the day after (compact), each a short list in
  time order with the proposal drawn with a dashed `--accent` border among what is there. Compact when the source said
  everything and Juan accepted two like it before, detailed otherwise (the subject and the mail's words, clamped to
  three lines, and the fields that the card's line does not already say); "Más detalles" / "Menos" switches. On
  the inbox's own page (more room) a detailed card from mail is two columns: the mail (up to twelve lines) and the
  fields on the left, the three days on the right (titles on two lines); one column when the card is narrow. A
  changed note's text shows as reading text (headings, lists, to-dos), never raw Markdown. Accept and Reject on each
  card (never "accept all"). A card from mail has "Ver correo" on its source line (the mail's own row in Boni: IMAP
  gives no webmail link) and, detailed, "Por qué: «…»" (the reader's quote; in « » only when the code found those
  words in the mail). Its ⤢ button opens the **proposal's page** (Juan, 2026-10-23), read only, like a row's page:
  the "Propuesta" tag and what it does, the title large, then sections (small upper-case labels): Propiedades (every
  value, the title and day too), Nota, Por qué, Origen (source line with "Ver correo", subject, the mail's words),
  Esos días (three days); Aceptar / Rechazar at the end go back to where it was opened from, as Esc and the crumb
  "Bandeja / Propuesta" do. A proposal to create something can be **corrected** before accepting (Juan,
  2026-10-23): the ✎ button beside ⤢ (on its page, beside the title) opens a small boxed form under the card's
  content, Título (a text field) and Colección (a select of his collections), with "Boni lo toma como un error suyo
  y aprende de él." and "Deshacer cambios"; Aceptar then sends the changes and the toast says Boni will learn from
  them. **Deciding** (Juan, 2026-10-23): the clicked Aceptar / Rechazar keeps its size and turns into a spinner
  (both off meanwhile) while the server answers; decisions queue in order, so the next card can be decided at
  once; a decided card simply leaves (no toast for each); a failed one says why under its buttons in `--bad`
  ("Ya no vale…" for a stale one, "Ya estaba decidida.") with "Quitar", and stays until taken out. **"Ya lo hice"**
  (Juan, 2026-10-23), between Aceptar and Rechazar, only on a proposal to create something in a collection whose
  calendar has a task column: it is saved already done (struck through in the calendar), with the same spinner;
  the toast says "Apuntada como hecha". **"Boni la habría aceptado"**: a quiet muted mark with a small sparkle,
  beside the actions (and on the proposal's page next to its headline), when the code's rule says Boni would have
  accepted it alone; nothing is accepted alone yet (measured first): the Registro says on top, in one muted line,
  how often it would have been right. **Ghost rows**: a pending proposal to create an entry also shows in its collection: in
  the table, first, read only, in muted text with a solid "Propuesta" tag and ✓ / ✕ beside its title (no dashed
  border on rows: Juan, 2026-10-23, dashed only in calendars); in the calendar layout, a dashed item; a click on its title (table) or on it (calendar) opens the proposal's page. **In Boni Calendar** (plan b2) the same proposal is an event with a dashed outline in its calendar's colour over a faint fill, no resize handles, read only (no drag, edit, duplicate or delete; it never reminds); one click opens its page in the peek (Boni's address set: the calendar's own peek; otherwise Boni's, `boni://proposal?id=`), where Aceptar or Rechazar puts the peek away. Where there is no peek (a browser, Android) its detail opens read only, titled "Propuesta", saying it is decided in Boni's inbox. They are proposals, not entities: nothing counts them; an entity's values are one row per field, labelled with the field's name, and an entity is shown by its title with its id beside it, and a collection by its name alone ("Docencia"; names and titles that came from outside are not used: the key and the id instead); the **log** (Registro) lists every run with what it was, on one line (the request in quotes; "Correo «asunto»"; "Cambio en Obsidian" for a run of the retired mirror, never its path; "Propuesta aceptada"; the review of the mail guide) and under it, muted, when and what came of it (the sender and mailbox, its proposals by how they were decided, what it made or changed by title and collection, "(deshecho)", or "Nada que hacer"; Juan, 2026-10-22: "Segundo plano · Hecho" said nothing); readings in a row that did nothing are one line ("3 lecturas sin nada que hacer") that opens; Undo only where something is left to undo (a stopped run too); a click on one opens, under it, the request as Juan wrote it and each step of its plan (the tool, what the policy decided or where it stopped, and the arguments as the plan wrote them), all as text. The only exception to "no confirmation
  dialogs" (section 1): these confirmations are the policy engine's, not the interface's.
- **Settings** (Boni): one section at a time, chosen in a column on the left (tabs along the top on a phone or a narrow
  window): Cuenta, Lo que ve la IA, Extensiones, Correo, Tus datos, Apariencia, Escritorio (only those that apply).
  It opens on Cuenta. **Extensiones** (docs/extensiones.md): a note on what they are, then per extension its name and
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
    activates it, never the MCP.

  An extension with a version before the active one has «Volver a la versión N» under it: one click, both ways.
  **Lo que ve la IA**: the three levels explained once at the top, then one row per collection with a select.
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
  examples), how it measured ("acertaría 37 de tus últimas 40 decisiones (ahora 31)"), "Descartar" and "Añadir a la
  guía"; "Más
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
- **Ajustes → Modelos** (design audit, Juan 2026-10-25: what configures Boni lives in Ajustes, not on a page; it was the
  sidebar's «Modelos»): «Usos», a card per use with a one-word name and its icon (Agente, Lector, Decisor, Revisor),
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
- **«Todas las páginas»** (Boni, the sidebar's top; Juan, 2026-10-28: everything, with every way to manage it): the
  sidebar's «Páginas» as a table (Nombre, Elementos, Lo que ve la IA, En la barra, Origen, "…"), each line indented
  18 px under its mother: the user's pages, the collections (a chevron opens one: its daughters, then all its notes,
  whatever its eye says; «Ninguno de sus registros tiene nota» when there are none) and «Boni», folded. A search
  (names and the notes' titles) or a level's chip lists what matches flat, each line with where it is, muted, after
  its name. The eye is a column; each collection's pill changes what the AI sees. "…" on a collection: «Nueva nota»,
  «Nueva colección dentro», «Mover a…» (the menu becomes the list of where it can go, «Al primer nivel» first, each
  with its mothers: never into itself or a daughter, never where it is) and «Eliminar colección»; on a note:
  «Mover a…» (it keeps its id and history) and «Mover a la papelera». «Nueva colección» beside the chips names one in
  place at the top. A spark in `--accent` marks a note an AI has read (who and when on hover). A note opens as its
  row's page, with the crumbs «Todas las páginas / its mothers / collection / title» and the page's own editor («/»
  and «+», data blocks included; the blocks Markdown cannot say are kept in the note's text as fenced «boni»
  blocks); Esc comes back. Below the table, what the collections take (next item).
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
  de sistema» group to show each. Their cells are muted 12.5 px text, ellipsized (full text on hover), never editable.
- **«Todas las páginas»** ends with the tiles Registros, Almacenamiento, Historial and Textos de los modelos,
  Boni's storage advice when something grows (an amber-tinted line with a bulb; nothing is deleted by itself), and two
  bar lists: «Tamaño por colección» (data and history; a click opens the collection) and «Uso en 30 días» (read and
  edited; a click opens its audit).

## 7. Keeping it consistent
- A pull request that changes look or behaviour in Boni Calendar updates this file.
- Another Boni app that needs a new component first looks here; if the component is missing, design it in Boni Calendar's
  language, add it here, then reuse it.
- Screenshots in `e2e/screenshots/` (generated by the e2e suite) are the visual reference.
