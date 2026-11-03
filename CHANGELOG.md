# Changelog

One entry per release: what Juan can try, and what each app needs. The server's version is the Docker image tag
(`boni-calendar-server:0.8.N`); Boni's desktop app is `apps/boni-desktop` (`release/boni_0.4.N_amd64.deb`); Boni
Calendar's desktop app is `apps/calendar-desktop` (`release/boni-calendar-desktop_0.8.N_amd64.deb`); the Android apps
come from the CI's APK (Obtainium). Older releases: the Boni note «Boni: registro y relevos anteriores».

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
