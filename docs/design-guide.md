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
  event (and, with a vault or a server, its note). So untitled notes are never made, and notes are never renamed.
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
  server live; Settings says "Live", "Offline: showing the last copy" or "The session ended: log in again". When the server
  writes, the gestures change the notes through it exactly as in a local vault, also offline: changes show at once and wait
  on the device until the connection is back. A change the server refuses (the note changed elsewhere) shows the vault's
  conflict toast and the server's copy. A read-only server sends its calendars read-only. External calendars and the
  shared preferences (language, clock, first day, second timezone, week numbers, default duration, snap) belong to the
  account: every device shows the same, changes reach the others live, and the server downloads the calendars (the hint
  under External calendars says so). Theme, density and timezone stay per device. The first time a device joins, its own
  external calendars join the account's, with a toast saying how many.
- **Data in the vault** (desktop app, Settings → Data): the calendars are always the vault's notes (the invented sample
  data only shows in a plain browser, for development and tests); writing is opt-in ("Read only" / "Read and write"). With it on, the
  gestures above change the notes: only the edited properties are rewritten (unknown ones, comments and the body stay as
  they were), a new event becomes a note when it has a title (file `{date} {title}.md`, with a counter on the file name if
  taken), moving it to another calendar moves its file, deleting sends it to the trash and Undo brings it back. If a note
  changed outside the app since it was read, nothing is written: a toast says so and the notes are reloaded. Notes the
  calendar cannot place are listed in Settings, never hidden.
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
- **Boni on a phone** (narrower than 640 px, and its Android app; Juan, 2026-10-18): not the desktop window made small.
  It is for capturing: three tabs at the bottom, "Apuntar" (the capture buttons, then the user's shortcuts: a saved form
  with its values, which a tap opens filled in or saves at once with Undo in the toast), "Gráficas" (a list with each
  chart's total; one chart on the whole screen with period chips) and "Boni" (the conversation, below). Forms and editors are full-screen sheets with their
  buttons fixed at the bottom; optional fields fold under "Más detalles"; menus come from the bottom; a tap on a chart
  shows the value and a second tap opens the detail. Same tokens and card recipe; written deviation for the thumb:
  16 px text, 48 px touch targets, 20 to 24 px icons. Back closes the top thing.
- **Desktop widgets** (Boni): a chart card alone in a small transparent window that sits on the desktop, below every
  window (on X11 a "dock" window kept below by the window manager; it survives "show desktop"). It keeps the card look
  (`--surface`, 10 px radius, `--line-strong` border) and is fully interactive: hover for values, click for a detail;
  dragging anywhere moves it, the bottom-right corner resizes it; on hover it shows its period and its menu (the chart
  controls below, compact), and right click opens the same menu (open or edit in the app, refresh, hide here, remove).
- **Boni's main window** is laid out as this app: the sidebar (home; the charts, each with a colour from the calendar
  palette, eye = on the home screen, a properties button, drag to reorder; this computer's widgets with an eye; settings
  and the user at the bottom), the main area and the right side panel. The home screen's chart cards fill the main area
  (rows share its height; no empty band), and capturing or editing a chart happens in the side panel with the cards in
  view (the card being edited shows the preview and an accent ring).
  Settings has "Lo que ve la IA" after the account (one row per collection with its count and a three-way segmented
  control: "La ve", "Solo sabe que existe", "No la ve"; each option's tooltip says what it means) and "Tus datos": one button that downloads everything as a .zip
  (where the host can save a file; a toast says how it went).
- **Chart controls** (Boni; like a Notion view's): when the pointer is over a chart card, a small bar of controls appears
  in its header before the total: period (a menu of usual periods), filters (a box, saved when it closes), order and
  "only the N largest", kind, colour (the calendar palette) and "…" (edit, duplicate, on home, on the desktop, delete).
  28 px controls, Lucide icons, `--surface` bar with a `--line-strong` border, 8 px radius; the period's label is cut
  before anything else. Each change applies at once with Undo in the toast; deleting waits for that Undo.
- **The conversation with Boni's agent** (Boni; `apps/boni-web/src/components/Chat.tsx`, docs/nucleo.md 7.14): a
  "Conversación" row under "Inicio" in the sidebar (with the number of proposals waiting), the third tab on the phone.
  Juan's turns on the right in an `--accent-soft` bubble; the answers are painted by the code from the reply components
  (text with slots, a big number in tabular figures, a list, a table). **Text is only text**: no HTML, no Markdown, no
  links, no images; what came from outside (an e-mail, a page) keeps a 2 px amber mark on its left and says so on hover.
  A question shows its options as pills (one line, cut with an ellipsis) and never asks for a password. A
  **confirmation** is a card with an `--accent` border holding only the code's components: the action as a question,
  each argument with its real value in full (scrolling, never cut), where it came from ("Viene de fuera · un correo")
  and its warnings in `--bad` (invisible or direction-changing characters, shown as `⟦U+202E⟧`, mixed alphabets, an
  international domain with its real name, long text). Its accept button waits 0.7 s and changes side with every
  confirmation, so nothing is accepted out of habit. The **inbox** shows each proposal as the same card with Accept and
  Reject (never "accept all"); a hand edit of the mirror in Obsidian arrives there too, titled "Cambio hecho a mano en
  Obsidian", with the note's path first and, under "No se aplica", what did not fit its field; an entity's values are one row per field, labelled with the field's name, and an entity is shown by its title with its id beside it (names and titles that came from outside are not used: the key and the id instead); the **log** lists the requests with Undo for each (a stopped one too); a click on one opens, under it, the request as Juan wrote it and each step of its plan (the tool, what the policy decided or where it stopped, and the arguments as the plan wrote them), all as text. The only exception to "no confirmation
  dialogs" (section 1): these confirmations are the policy engine's, not the interface's.
- **Settings** (Boni): one section at a time, chosen in a column on the left (tabs along the top on a phone or a narrow
  window): Cuenta, Lo que ve la IA, Extensiones, Correo, Tus datos, Apariencia, Escritorio (only those that apply).
  It opens on Cuenta. **Extensiones** (docs/extensiones.md): a note on what they are, then per extension its name and
  what it does in one line with its switch, and under it a closed "Qué usa" group whose summary says whether it is
  as it came ("Viene con Boni (versión 1)") or changed; inside, in plain words (never ids): where it brings data from,
  what it reads, what it looks for, whether it proposes, its daily budget. **Lo que ve la IA**: the three levels explained once at the top, then one row per collection with a select.
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

## 7. Keeping it consistent
- A pull request that changes look or behaviour in Boni Calendar updates this file.
- Another Boni app that needs a new component first looks here; if the component is missing, design it in Boni Calendar's
  language, add it here, then reuse it.
- Screenshots in `e2e/screenshots/` (generated by the e2e suite) are the visual reference.
