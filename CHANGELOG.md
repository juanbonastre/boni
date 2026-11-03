# Changelog

One entry per release: what Juan can try, and what each app needs. The server's version is the Docker image tag
(`boni-calendar-server:0.8.N`); Boni's desktop app is `apps/boni-desktop` (`release/boni_0.4.N_amd64.deb`); Boni
Calendar's desktop app is `apps/calendar-desktop` (`release/boni-calendar-desktop_0.8.N_amd64.deb`); the Android apps
come from the CI's APK (Obtainium). Older releases: the Boni note «Boni: registro y relevos anteriores».

## 2026-11-03 (twelfth) — server 0.8.88

Needs: the server only (0.8.88, to deploy). Task 43: the three holds the log of 0.8.86 named.

- **Boni's own records open without stopping the server.** «Actividad de Boni» counted thirty days of reads each
  time it was made, and it was made again whenever anything was read: up to 8 s on the NAS with everything else
  waiting. Now the count is kept and only what was recorded since is added. (#279)
- **Checking the mail no longer reads your collections each time.** The collections a mail may propose into (their
  latest titles, the field a due day goes to, their lists) were worked out on every check, reading all their
  records; now they are kept while none of their records changes. (#279)
- **The Bandeja's cards show each event of the day once.** The day around a proposal read the Agenda once per area
  of a split calendar, and showed each event once per area; the events of its daughter collections were missing.
  Now each collection is read once, each record shown once, and the result kept while nothing changes. (#279)

## 2026-11-03 (eleventh) — server 0.8.87

Needs: the server only (0.8.87, to deploy). Task 43: the three holds the log of 0.8.85 and 0.8.86 named.

- **Editing the Agenda no longer reads it all again.** Each edit of an event or a task made the calendars read the
  Agenda's 2,805 records again to split them by area (about half a second on the NAS). Now an edit that keeps the
  values the calendars split by among the others' (a title, a time, a place) reads nothing (0.2 ms instead of 30 to
  56 on the laptop); a new area, the last event of one gone, or an area renamed still read them. And a record's
  collection branch is worked out once per schema, not once per record (the first read: 160 → 112 ms). (#278)
- **An assistant's query no longer stops the server.** A query through the MCP read, for each of its notes, the note
  it points to (each task its project): 2,805 reads for one query, 1.9 s on the NAS. Now each is read once in the
  call (with 2,800 tasks: 260-300 ms → 40-66 ms on the laptop). (#278)

## 2026-11-03 (tenth) — server 0.8.86 · Boni desktop 0.4.65

Needs: the server (0.8.86, to deploy) and Boni desktop 0.4.65 (`release/boni_0.4.65_amd64.deb`, to install). Boni
Calendar desktop stays 0.8.18. Task 30 (mail M3), and task 43 going on.

- **A mail opens in a window of its own.** In the conversation, the ↗ («Abrir») of a mail of a summary opens it in
  its own window, the one Boni Calendar's notes use, which stays while you work elsewhere; in the browser and on the
  phone, in the side panel as before. (#276, task 30)
- **«Proponer tarea» on each mail.** Next to the ↗, a mail's line proposes its tasks: the mail is read now as a new
  one is, and what it asks goes to the Bandeja; a toast says how many, or that there was nothing to propose. (#276,
  task 30)
- **The log says who asked for what held the server.** Its line names the function in each of Boni's files on the
  way out («store.ts readType ← calendarStore.ts expandNode»), not three of the store's own. (#275, task 43)

## 2026-11-03 (ninth) — server 0.8.85

Needs: the server only (0.8.85, to deploy). Task 43 again, from the log of 0.8.83's last hour.

- **«Todas las páginas» no longer stops the server for ten seconds.** Its storage figures measured every text
  whole (the models' prompts, each change's values): 9.6 s on the NAS, with nothing else answered meanwhile. Now
  they are taken from each row's header, in bytes (34 ms on the laptop with a 300 MB store, where it took 150 to
  230 ms reading them). (#273, task 43)
- **The money no longer holds the server every minute.** To tell the devices listening when the money changed, the
  server read every movement and debt each minute: with 8,000 movements, 0.1 to 0.2 s on the laptop, and up to 0.7 s
  on the NAS in its log. Now the store counts them and says their last change without reading them (1 to 3 ms).
  (#274, task 43)
- **The watchdog of 0.8.84 starts for sure.** When the server was busy as it started, the thread that finds out
  what holds it could end before it began to watch; the log then never said what held the server. (#273, task 43)

## 2026-11-03 (eighth) — server 0.8.84

Needs: the server only (0.8.84, to deploy). Task 43, from what the log said before 0.8.83 went out.

- **Listing the collections no longer holds the server.** To count Boni's own collections (its calls to models, its
  activity, its runs), each list of the collections made all their rows, and made them again every 10 s: with
  Juan's volume about 0.2 s on the laptop, around 0.6 s on the NAS, where the log said only «nothing named». Now
  they are counted without being made (1 ms), and kept while nothing new is recorded. (#272, task 43)
- **The log says what held the server.** When something holds it over half a second, the minute's line names the
  functions that held it longest; the watchdog that finds out profiles only while the server is held (about 20 MB
  of memory, nothing else while it runs freely). (#272, task 43)

## 2026-11-03 (seventh) — server 0.8.83 · Boni desktop 0.4.64 · Boni Calendar desktop 0.8.18

Needs: the server (0.8.83, to deploy: a collection's columns and its name change through it), Boni desktop 0.4.64
(`release/boni_0.4.64_amd64.deb`) and Boni Calendar desktop 0.8.18
(`release/boni-calendar-desktop_0.8.18_amd64.deb`), to install. The batch of Juan's list of the afternoon (tasks 38
to 42), with Notion as the reference.

- **Ctrl+click chooses in Boni Calendar.** With an event chosen, Ctrl+click on another adds it to the selection (or
  takes it out); it no longer tries to open it in Boni. (#267, task 38)
- **Menus open where the pointer is again.** A row's menu, a property's options and every small box open at the
  pointer or under their button, not a hand's width away. (#266, task 39)
- **A collection's columns, as Notion's.** A click on a column's name, or the right button on it, opens its menu: its
  name written in place, its kind, a list's values, «Ocultar», «Borrar columna» with Undo; «+» at the end of the
  head adds one. (#268, task 40)
- **The right button, everywhere.** On a page, a collection or a note of the sidebar, on a table's row and on a card
  of the board, the gallery or the list, it opens the same menu as its «…», where the pointer is. «Cambiar nombre»
  renames in place pages, notes and now collections too. (#269, task 42)
- **«Opciones» gives options.** A short list, as Notion's «⋯»: Propiedades, Filtrar, Ordenar, and Agrupar, Fecha or
  Columnas de sistema by layout, each saying what it is now and opening its panel; the collection's notes in the
  sidebar too. (#270, task 41)

## 2026-11-03 (sixth) — server 0.8.82 · Boni desktop 0.4.63

Needs: the server (0.8.82, to deploy) and Boni desktop 0.4.63 (`release/boni_0.4.63_amd64.deb`, to install). Boni
Calendar desktop stays 0.8.17. The batch Juan chose («36, 37 y 23»).

- **A new page keeps the window.** After logging in or a reconnection, the pages asked before a new page existed no
  longer take the window from it while its name is typed, nor the page from the sidebar. (#262, task 36)
- **The conversation reads mail with Juan's guide.** «Resume mis correos», «Ponme al día» or «¿Quién me ha escrito
  de la secretaría?»: the AI that reads the mail gets his guide (Ajustes › Correo: his instructions and the examples
  from his decisions), as the background reading does, and tells first what it says matters. (#264, task 23)
- **Measuring a guide never leaves new mail unread.** The reviewer's readings of mail already decided count in an
  allowance of their own (45 a day) and in the day's total, never in the mail's 150 nor in a sender's 20. (#263,
  task 37; P13 in `docs/nucleo.md`)

## 2026-11-03 (fifth) — server 0.8.81

Needs: the server only (0.8.81). Deployed at once at Juan's word, with his code.

- **The calendar's reading, cut again.** Read on the NAS after 0.8.79: a read of the calendars costs about 475 ms
  there, and every write anywhere in Boni (a mail, a page) made the calendar read them again. Now only a change of
  the schema or of the records they read (the Agenda's, the areas') does, and a split collection's records are
  listed once per read instead of once per node. The minute's line in the log also names a big JSON answer, a mail
  kept and the money's check when they hold the server. (#260, task 35)

## 2026-11-03 (fourth) — server 0.8.80

Needs: the server only (0.8.80). Deployed at once, out of the batch: mail was being lost.

- **Mail with attachments is kept again, and what was lost comes back.** Since 0.8.70 the attachments went to the
  first collection holding files, a restricted one without folders, and every mail with attachments failed to be
  kept and was lost (the log said `no field "f_folder"`). Now they go to «Archivos» (the collection with files and
  folders); the mail's «Archivos» field is remade toward it; the mail since 2026-11-01 that is not in yet is
  brought in once, by its Message-ID; and a mail that cannot be kept with its files comes in without them, saying
  so, never stopping the others. (#259, task 34)

## 2026-11-03 (third) — server 0.8.79 · Boni desktop 0.4.62 · Boni Calendar desktop 0.8.17

Needs: the server (0.8.79, to deploy: it carries the fixes of the slowness) and Boni Calendar desktop 0.8.17
(`release/boni-calendar-desktop_0.8.17_amd64.deb`, to install). Boni desktop stays 0.4.62.

- **The slowness, measured and cut** (task 35). Two causes, measured with data shaped like Juan's (2,805 agenda
  records split by area, 6,000 runs) on the laptop; the NAS is about three times slower:
  - Since the Agenda was split by area (the night of 2026-11-02), the server read every agenda record again every
    second (the calendar's poll) and on every request of the calendar: 68 ms a poll, 220 ms a `GET /api/changes`
    with nothing new. Now it reads them once per change of the data: 0 ms and 1 ms; a request no longer waits
    behind it (266 ms → 6 ms at worst). (#258)
  - Since 0.8.77 (task 13), the mail reviewer looked on its own on every check of the mailbox whenever a rule found
    by code measured no better: forty readings each time. They spent the day's reading budget of the mail (150), so
    new mail stopped being read for the rest of the day, and they filled the journal with runs. Now it looks on its
    own once a day at most, and a candidate that measured no better waits a week. (#255)
  - Boni's «Ejecuciones» (the Registro) builds 6,000 runs in 109 ms instead of 716 ms. (#258)
  - The server says what is slow once a minute in its log (requests over a second by route, the calendar's poll,
    the event loop held), and `cli.ts diagnose <name>` measures with the account's own data, changing nothing.
    (#258)
- **Boni Calendar: out goes the colour by a field.** «Color del calendario» is the swatches row again, and a split
  definition has «Calendarios por área» with a row of swatches per calendar; «Separar por» is the only way to split
  (Juan: «solo vamos a tener separar por… los colores se seleccionan de la matriz»). What stays: the select and the
  swatches say «Guardando…» while the server sends the calendar back. (#256; tasks 24 and 32 undone)

## 2026-11-03 (second) — server 0.8.78 · Boni desktop 0.4.62 · Boni Calendar desktop 0.8.16

Needs: the server (0.8.78, to deploy), Boni desktop 0.4.62 (`release/boni_0.4.62_amd64.deb`, to install), Boni
Calendar desktop 0.8.16 (`release/boni-calendar-desktop_0.8.16_amd64.deb`, to install). What Juan saw trying the
night's release, as two tasks.

- **Boni Calendar: the colour is one control.** «Color del calendario» is now a select: «Uno» (the calendar's
  swatches), «Por calendario» (a split one: each calendar inside keeps its own) or «Por tipo», «Por área»… (a row
  of swatches per value). «Separar por» stays apart: it is what makes calendars in the sidebar. While the server
  sends the calendar back after a change, the selects wait and say «Guardando…». (#252, task 32)
- **Boni, Ajustes › Decisiones** waits for the server without saying «Sin decisiones», and the server logs a slow
  decisions view. (#251, task 31)
- **The wait always shows.** In Boni and in Boni Calendar, a thin line slides along the top edge of the window while
  anything is in flight (a request, the connection, the calendar coming), after 250 ms; the sections of Settings
  keep their room with a pulsing placeholder while they load. The rule, with what Apple, Material and Nielsen
  Norman Group say, is in `docs/design-guide.md` «Waiting». (#254, task 33)

## 2026-11-03 (night) — server 0.8.77 · Boni desktop 0.4.61 · Boni Calendar desktop 0.8.15

Needs: the server (0.8.77, to deploy), Boni desktop 0.4.61 (`release/boni_0.4.61_amd64.deb`, to install),
Boni Calendar desktop 0.8.15 (`release/boni-calendar-desktop_0.8.15_amd64.deb`, to install; it replaces the 0.8.14
that was never installed). The batch Juan chose («13, 25, 24 y 28»), one PR per task.

- **Boni Calendar: «Colorear por».** In the properties of a definition (Agenda's gear, or any calendar inside it:
  «Ajustes de Agenda»), under «Separar por»: a list or a relation of the collection, or «Por calendario». Every
  event takes the colour of its value without splitting the calendar; «Colores por tipo» lists each value with a row
  of swatches. (#248, task 24)
- **Boni: what enters rises into place**, as the conversation does since the last release: a page, a record or a
  table opened in the main area, the inbox's cards (one after another), a dialog, the Settings pane when its tab
  changes, the phone's screens; menus grow from their button. The system's «reduce motion» turns it all off. (#249,
  task 28)
- **CI.** Boni Calendar's desktop app with its note peek now runs in CI on a virtual screen, as Boni's does; its
  suite passes again. (#247, task 25)

- **Decisions.** The mail reviewer learns by code too: a sender always rejected, or always moved to the same
  collection, becomes a rule it proposes (measured as before), at most one suggestion a day it was not asked for.
  Each suggestion is a decision («Revisora» in Ajustes › Decisiones, judged by the answer). A suggestion is answered
  with «Descartar», «Cambiarlo…» (it goes, in words, to the end of «Tus indicaciones» to rewrite and save) or «Añadir
  a la guía». Ajustes › Decisiones starts with «Aprender»: off, nothing is suggested unasked. (task 13, F4)

## 2026-11-03 — server 0.8.76 · Boni desktop 0.4.60 · Boni Calendar desktop 0.8.14

Needs: the server (0.8.76, deployed), Boni desktop 0.4.60 (installed), Boni Calendar desktop 0.8.14 (to install).

- **Conversation.** «Resume mis correos» answers with a sentence, one list in sections («Te piden algo», «Para saber»,
  «Avisos y publicidad») and a short question at the end; one model call reads every mail (`summarize_each`,
  `label_each`), so «agrupa por tipo en una gráfica» no longer stops on the request's limits, and those limits are
  said as such. Dates read as dates; subjects keep no HTML entities. The ↗ after a line opens the mail in the side
  panel («Agrandar» for its page). The question card's options are real buttons; «No, gracias» no longer repeats the
  answer. Nothing is marked in amber any more. What enters the conversation rises into place; «reduce motion» stops
  it. (#235, #236, #237, #238)
- **Boni desktop.** Ctrl+= / Ctrl+- / Ctrl+0 and Ajustes › Apariencia › «Tamaño» change the size of everything, kept
  per computer. (#236)
- **Boni Calendar.** The sidebar's first group is «Calendarios», with «+ Añadir calendario» (every collection with a
  day is a candidate) and «Quitar calendario» in a calendar's properties. A calendar can be **split by a field**
  («Separar por»): a folded group with one calendar per value, each with its colour, «Sin …» while some record has
  no value; a value can be split again, as deep as wanted; the group row has its own gear and eye; under a finger
  the row buttons are always visible and bigger. Juan's Agenda is one definition split by «area» (`split-check` /
  `split --apply` / `--undo`). (#239, #240, #241, #242, #243, #244)
- **Server.** `GET /api/data/types` sends each type's `key`; `/api/collections/{candidates,add,remove,split,color}`.

## Before 2026-11-03

See the Boni note «Boni: registro y relevos anteriores» (relevos) and the pull requests.
