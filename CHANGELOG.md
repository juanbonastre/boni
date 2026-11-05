# Changelog

One entry per release: what Juan can try, and what each app needs. The server's version is the Docker image tag
(`boni-calendar-server:0.8.N`); Boni's desktop app is `apps/boni-desktop` (`release/boni_0.4.N_amd64.deb`); Boni
Calendar's desktop app is `apps/calendar-desktop` (`release/boni-calendar-desktop_0.8.N_amd64.deb`); the Android apps
come from the CI's APK (Obtainium). Older releases: the Boni note «Boni: registro y relevos anteriores».

## 2026-11-05 (thirty-second) — server 0.8.107 · Boni desktop 0.4.76 · Boni Android

Needs:
- The server, 0.8.107, to deploy: Gmail threads of your mail, the views each collection keeps, and what each flow
  step gives.
- Boni desktop 0.4.76 (`release/boni_0.4.76_amd64.deb`), to install.
- Boni Android from main, through Obtainium.

Tasks 67, 68, 69 and 70: what you asked for on 2026-11-05.

- **A mail's «hoy» is the mail's day** (task 67). Ask about yesterday's mail that said «hoy a las 12h»: Boni now
  says «ayer a las 12h». The fault was Boni's, not the model's: nothing told the readers that a message's «hoy» is
  the day it was written, and the planner passed only the mail's text, without its date. Now every date a reader
  sees comes marked as it stands today («ayer», «hace 3 días»), and the readers are told to count from the mail's
  date (D-46). Still open: the extra mails you got when you asked about «tutor personal». (#336)
- **Mail cards in the Bandeja** (task 68):
  - «Ver correo» and Gmail are now two icons at the end of the card's line. A long sender is cut with «…» and never
    hides them.
  - The mail icon opens the mail in the side panel. Nothing else changes until «Agrandar»; closing it brings the
    Bandeja back as it was.
  - Gmail's icon opens that very mail in your account, not a search. For mail from before this version, Boni finds
    its thread once, in the folder or in «Todos» if you archived it.
  - When a proposal comes from several mails of a thread, «+N correos» unfolds them, and each one opens in the side
    panel. (#337)
- **Collections like Notion** (task 69):
  - A collection's views are tabs on the left. «+» adds one by its layout.
  - A double click renames a tab; the right button duplicates or deletes it.
  - On the right there are icons: Filtro, Ordenar, Buscar, and the view's settings.
  - Filtro and Ordenar show the bar under the head: the order on the left, the filters on the right, each a chip.
    Ordenar opens with its chip's menu already open.
  - Your views are kept in your account, the same on every device.
  - Try it on a collection of yours: «+» → Tablero; then Filtro → a property → its value. (#338)
- **The flow editor gives you control** (task 70):
  - «Añadir paso» has a search and groups by what each step does. «Avisar» has its own group: type «avis» and Enter.
  - The right button on a step has Abrir, Duplicar, Probar hasta aquí and Quitar.
  - A step's panel says what goes in («Entra») and what comes out («Sale»), each with what it is. After «Probar», it
    also says what the step gave. (#339)
- **Fixed while testing:** menus and popovers near the window's edge no longer end a few pixels outside it (the
  widget's menu did), and a new page rises in once instead of twice.

## 2026-11-05 (thirty-first) — server 0.8.106 · Boni desktop 0.4.75 · Boni Android

Needs:
- The server, 0.8.106, to deploy: `system.db`'s migration 3 for the notices, and «Mis datos» as a collection.
- Boni desktop 0.4.75 (`release/boni_0.4.75_amd64.deb`), to install.
- Boni Android from main, through Obtainium.

Tasks 61 (F6b, F4b), 62, 63 and 64.

- **Boni's notices reach you with the app closed** (task 62). «Avisar» of a flow, the agent's notices and the
  budget's reach you two ways:
  - on the phone, by UnifiedPush, sealed for that device, as a system notification (channel «Avisos»);
  - on the desktop, from the tray, with the window closed.

  Open Boni once on the phone so it asks to send notifications and registers with ntfy. **A correction to the
  thirtieth entry:** «Avisar» did not reach the devices with Boni open, as that entry said. No app listened to it,
  so until now it reached nobody. (#331)
- **«Mis datos» is a collection** (F6b; you asked for the section to work like a collection's page).
  - Its page is any collection's: Tabla, Tablero, Lista, Galería, Calendario and Diagrama, «Filtro» and «Nuevo».
  - It has a row per page and collection of yours, then Boni's.
  - In the row itself you rename one, or change its mother, its level or whether it shows in the sidebar. A private
    collection is opened to the AI only from its own page.
  - «Nuevo» makes «Nueva colección». The bin deletes an empty one, with «Deshacer».
  - Things to try: a Tablero grouped by «Nivel», dragging a collection from one level to another; or filter «Escrita
    por» and switch to Diagrama, which is now as wide as the window.
  - The tree with the notes inside is gone: a collection's notes are on its own page. (#332)
- **«Programar» is gone** (F4b). The conversation could save a daily or weekly job that nothing ever ran. Ask for
  something recurring and Boni proposes a scheduled flow in the Bandeja instead. (#333)
- **What the designs ask for and is not built** is in the queue: task 63, from an audit of the designs.
- **How a phase is called done** (task 64, what you chose):
  - A merged phase is «en main»; it is «hecha» when you have tried it.
  - Before a phase is called finished, an agent that did not build it checks it against its design, point by point.
  - Every tool a model can call has a test that runs it end to end (A-18). That test found three tools no test ran,
    and they work. It also found a dead end: a memory the model writes in its own words waits for a confirmation the
    app has no place for (task 63, point 17). (#334)

## 2026-11-05 (thirtieth) — server 0.8.105 · Boni desktop 0.4.74

Needs: the server (0.8.105, to deploy: the scheduler, the new routes and the web app it serves) and Boni desktop 0.4.74
(`release/boni_0.4.74_amd64.deb`, to install). Task 61, phases F2 to F6 of `docs/flujos.md`.

- **The flow editor** (F2). In «Flujos», the chosen flow opens in an editor: add a step from «Añadir paso», drag
  nodes, draw an arrow to use one step's value in another, Supr removes one; a click opens its panel with its
  settings (the collection as a list, a record's values field by field, «Valor de» with what that step may take).
  The checklist says what would be refused before saving. «Guardar» makes your version; «⋯» has the versions, «Volver
  al de Boni», «Duplicar» and «Eliminar». «Nuevo flujo» makes one by hand, with a form, and «Ejecutar» runs it in a
  conversation. Try it on «Leer correo»: change the collection the tasks go to, save, and go back to Boni's. (#325)
- **«Probar»** (F3) runs the draft dry with the latest mail (or the form's values): readers are called, nothing is
  written, and each node says what it gave or would do («Propondría: Crear en Docencia «…»»). A run of the Registro
  is now drawn on the flow's canvas. (#326)
- **Flows on a schedule** (F4): in the trigger's panel, «Programado», every day, a day of the week or every hour, at
  a time (Madrid). Draw a daily summary at 8 without code: «Nuevo flujo», «Programado» at 08:00, a «Consultar» or
  «Calcular» step and «Avisar», «Guardar», turn it on. «Ejecutar» runs it now. The notice reaches the devices that
  have Boni open at that moment (as Boni's notices do today); the run is in the Registro either way. In a conversation you can also ask
  Boni to run one of your flows by name: it asks you to confirm and its answers come in the same turn. (#327)
- **Flows proposed by the AI** (F5): ask in the conversation for something to happen on its own («cada lunes a las
  8 dime cuántas tareas tengo»): the flow waits in the Bandeja, drawn, and «Activar» saves it as yours and turns it
  on. An assistant can propose one through the MCP (`flows_describe`, `flows_propose`); a change of one of yours
  shows what it adds and takes away. (#328)
- **Who reads and writes your data** (F6): «Mis datos» → Diagrama says under each collection who writes it and who
  reads it (your flows, and who did in the last 30 days), with filters («Leída por», «Escrita por», «Nivel»,
  «Madre») instead of «Ver como». A click opens its panel (its level, who, «Abrir», a new collection inside); drag
  from a card's right edge to another to make a relation, drop a collection on another to put it inside, «Nueva
  colección». Each collection has «Diagrama» among its layouts too: try it on Agenda. (#329)

## 2026-11-05 (twenty-ninth) — server 0.8.104 · Boni desktop 0.4.73

Needs: the server (0.8.104, to deploy: the flows live in its journal) and Boni desktop 0.4.73
(`release/boni_0.4.73_amd64.deb`, to install). Task 61, phase F1 of `docs/flujos.md`.

- **«Flujos»** in the sidebar (where «Modelos» was; «Modelos» is a tab inside, as it was). The mail reading is now a
  flow, **«Leer correo»**, kept as data in your account and versioned: a new version only when the collections
  marked for mail, the modules or the guide change. Each reading executes the stored version and says so in the
  Registro. The section lists the flows with their runs and draws the chosen one: the trigger («Nuevo correo») with
  what it binds, each step named as the models' flow names it («Lectora», «Decisora», «Rellenadora») or by its tool
  («Leer», «Crear en Docencia»), «Para cada» and «Solo si» where the step iterates or has a condition, how often it
  ran in the period and how many proposals it made; a click opens the step's settings as the plan says them. Read
  only: the editor comes with F2. (#323, task 61)

## 2026-11-05 (twenty-eighth) — server 0.8.103 · Boni desktop 0.4.72

Needs: the server (0.8.103, to deploy: the flow's numbers and the web app it serves) and Boni desktop 0.4.72
(`release/boni_0.4.72_amd64.deb`, to install). Task 59b.

- **«Modelos»**, a section of its own under «Mis datos»: the flow of models and code as a canvas, read top to
  bottom: where each thing comes in (Correo, Conversación, Calendarios externos, Asistentes), which model reads it
  (Lectora, Decisora, Rellenadora, Planificadora, Lectores, Revisora: each with its model, its calls and their cost
  of the period, its acierto and its last call), what the code decides (Calendario, Relaciones, Herramientas,
  Políticas, Guía, Aprendices), the Bandeja, you, and your data; each arrow says what flows and how many went through
  («42 correos», «12 propuestas»). A period of 7 or 30 days; «Ordenar»; a click on a model's node opens its use
  below, where what was Ajustes → Modelos now lives (Ajustes keeps a button to it). The flow is declared as data in
  the code and the CI refuses a reader, a role, a tool or a kind of run without its node (A-16), so the canvas cannot
  drift from what Boni does. From this version each reader's call says which reader it was; older calls count at
  their role's node. (#320, task 59b)

## 2026-11-05 (twenty-seventh) — server 0.8.102 · Boni desktop 0.4.71

Needs: the server (0.8.102, to deploy: it serves Boni's web app to Android and the browser) and Boni desktop 0.4.71
(`release/boni_0.4.71_amd64.deb`, to install). Task 59a, the first of «Mis datos» and «Modelos» (Juan, 2026-11-04:
«Sí, las cinco»).

- **«Mis datos»**, the sidebar's top entry, replaces «Todas las páginas»; it has two modes, **Lista** (what it was) and
  **Diagrama**, kept per device. The diagram: a card per collection with its icon, name, the eye of its level, its
  count and its own fields (a relation as «→ Target»); a dashed frame per mother around her own card and her
  daughters'; an arrow per relation, named («· varios» when it takes several; a relation with itself, an arc over
  the card). Laid out by itself, left to right, mothers kept together and unrelated parts side by side; cards can be
  dragged and **«Ordenar»** lays it out again; **«Ver como»** (Todo | La IA) fades a restricted or private
  collection and the fields of an opaque one; a click opens the collection. Computed from the schema, never drawn by
  hand (D-40). References read for it: n8n's canvas and Supabase Studio's schema visualizer. Next: 59b, the
  «Modelos» canvas with the pipeline declared as data. (#318, task 59a)

## 2026-11-04 (twenty-sixth) — server 0.8.101 · Boni desktop 0.4.70 · Boni Calendar desktop 0.8.23

Needs: the server (0.8.101, to deploy), Boni desktop 0.4.70 (`release/boni_0.4.70_amd64.deb`, to install) and
Boni Calendar desktop 0.8.23 (`release/boni-calendar-desktop_0.8.23_amd64.deb`, to install); the Android apps
from the CI (Obtainium). From what Juan saw trying the 0.8.22 and the Bandeja: tasks 57, 58 and 60.

- **A new event moved to another calendar is no longer lost.** Made, titled and moved from the default calendar to
  another at once, it was gone when Boni Calendar opened again (and once made twice): the app sends a move as a
  removal plus the row in the new calendar, and the server trashed the record before moving it. The server now
  takes one change per record of a batch, the last: a move is one change of collection, a new row is made once, in
  the calendar it went to. Server only. (#314, task 57)
- **The inbox asks «¿Es «Quedada cafe, 16:00–17:00»?».** A proposal at the same moment as an entry whose title is
  not alike names it as the one it may be, with a button «Es el mismo» before «Aceptar»: no new record, that one
  takes what the proposal adds and it lacked (a person, an end time, a note; its title and day stay), undone whole
  with «Deshacer»; of an external calendar's event, the record is made linked to it. Before, the card only said
  «Se solapa con…» and offered Aceptar or Rechazar. Boni desktop and the server. (#316, task 58)
- **External calendars (Google) are downloaded anew sooner.** At start, every ten minutes while the app is open and
  when its window comes back after five minutes away (the desktop window hides in the tray, so closing and opening
  it started nothing); «Actualizar» in a calendar's context menu, with the state of its copy; the server logs each
  download. Google's own iCal address is served from Google's cache, often hours behind: that part is not ours.
  Boni Calendar desktop and the server. (#315, task 60)

## 2026-11-04 (twenty-fifth) — Boni Calendar desktop 0.8.22

Needs: Boni Calendar desktop 0.8.22 (`release/boni-calendar-desktop_0.8.22_amd64.deb`, to install) and the
Android calendar from the CI (Obtainium). From what Juan saw trying the link of the 0.8.21.

- **A linked record keeps the external event's call and links.** «Unirse» and the «Enlaces» pills of the external
  event stay in the record's detail and on its block once linked (they were the external event's place and note).
  (#312, task 56)
- **An event made right before closing is no longer lost.** The change leaves for the server at once while the
  device keeps it (before, the keeping went first and a window closed within the second had done neither); a small
  change sent as the window closes still arrives; the desktop waits half a second before quitting. And a server on
  its way (502, 503, 504: a deploy, the proxy) or saying too many (429) keeps the device's queue until the stream is
  live again, like no connection does; before, the change was dropped with a toast easy to miss. (#312, task 56)

## 2026-11-04 (twenty-fourth) — server 0.8.100

Needs: the server only (0.8.100, to deploy). Task 43, from the 0.8.98's log while Juan tried the apps.

- **A commit no longer pays the WAL's checkpoint.** A mail kept, a step of a run or an action of the audit held the
  server a second now and then: the commit that crossed a thousand pages did SQLite's checkpoint on the NAS's disk.
  The stores open with the automatic checkpoint off and a thread of the server's own checkpoints them passively
  every few seconds; a commit that still takes long is said in the log with the WAL's size, and so is a checkpoint
  that took long. (#311, task 43)

## 2026-11-04 (twenty-third) — server 0.8.99 · Boni desktop 0.4.69

Needs: the server (0.8.99, to deploy; its first «Todas las páginas» sums the activity once more, for the last time)
and Boni desktop 0.4.69 (`release/boni_0.4.69_amd64.deb`, to install). Tasks 43 and 52.

- **«Recorrido».** In the Registro, a run opens to what it did: a diagram of its steps (red where a rule stopped
  it, dashed where it went to the inbox), each step with its verdict, its rule and what the models answered, then
  what it read, changed, proposed and decided, and the models it called; «Copiar» puts it all in the clipboard as
  text, to paste in a chat and work out a reading without sending the mail to anyone. «Recorrido» also from a turn
  of the conversation and from a proposal's page. (#309, task 52)
- **The start-up no longer sums the whole audit.** Boni's «Actividad» counted 400 days of reads on every start (1 to
  10 s on the NAS); the sum lives in the store now and grows with what comes. (#308, task 43)

## 2026-11-04 (twenty-second) — server 0.8.98

Needs: the server only (0.8.98, to deploy; its first start builds an index over the model calls, a few seconds
more once). Task 43, from the start-up minute of the 0.8.97 in the NAS log.

- **The start-up no longer scans every model call with its texts.** Boni's own records («Llamadas a modelos»,
  the uses and models they offer) and the day's spending read the last days' calls by when; with no index on when,
  that read scanned the whole table, each row carrying its prompt and answer (4.5 s held at start-up, and the
  first «Todas las páginas» 4.1 s). An index now carries what those reads take. (#307, task 43)

## 2026-11-04 (twenty-first) — server 0.8.97

Needs: the server only (0.8.97, to deploy). Task 43, from the first minutes of the 0.8.96 in the NAS log.

- **The «Registro» no longer reads every proposal to count them.** Each request of the runs counted their
  proposals by reading all of them with their arguments (370 ms held, every minute the Registro was open); the
  journal counts them in one query now. (#306, task 43)

## 2026-11-04 (twentieth) — server 0.8.96

Needs: the server only (0.8.96, to deploy). Task 43, from the NAS log before the 0.8.95.

- **One record changed no longer makes the mail reader read every collection again.** The collections a mail may
  go to are remembered by parts: a collection's due field and examples follow its own records, its fields to fill
  follow the collections they point to; a new task, or a class moved in the calendar, no longer re-reads the whole
  Agenda (2,805 records, 0.55–0.9 s on the NAS each time a mail was read). (#305, task 43)

## 2026-11-04 (nineteenth) — server 0.8.95 · Boni desktop 0.4.68 · Boni Calendar desktop 0.8.21

Needs: the server (0.8.95, to deploy; it carries the 0.8.94 too, which was not deployed), Boni desktop 0.4.68
(`release/boni_0.4.68_amd64.deb`, to install; it carries the 0.4.67 too) and Boni Calendar desktop 0.8.21
(`release/boni-calendar-desktop_0.8.21_amd64.deb`, to install). Tasks 50 and 51 (phase A), from what Juan saw with
an external calendar next to his own records of the same classes.

- **A record of yours and an external event, one item.** In Boni Calendar, an external event's detail offers
  «Enlazar» (your records near it, like titles first) and «Crear nota» (a record in a calendar of yours, made from
  it); when one of your records shares its moment and title, «¿Es «Clase IPM 8»?» with «Sí». Linked, the calendar
  paints one item: your record, in its colour, with the external calendar's colour on its right edge, at the
  external event's time, which it follows and does not let you drag; the detail's «Enlace» row names that calendar
  and «Quitar enlace» leaves two again. The column «Evento externo» is added to your collection the first time.
  (#301, task 50)
- **The inbox looks at the calendar before proposing.** A card whose event is already there says «Ya en el
  calendario: Clase IPM, 17:00–18:00»; if it is an external calendar's event, the button is «Enlazar» and the record
  is created linked to it; another thing at the same time is «Se solapa con X»; a task's suggested hour and the mini
  calendar count the external events too. (#302, task 51, phase A)
- **The relations a mail plainly names come filled.** When the collection a proposal goes to relates to another
  whose record is the sender (by name) or whose title the sender's own words carry («IPM 25-26», «FUP 1»), the
  proposal comes with that relation set, one match or none, by code; what the reader chose stays, and «Corregir»
  changes it. (#304, task 51, phases B and C)

## 2026-11-04 (eighteenth) — server 0.8.94 · Boni desktop 0.4.67 · Boni Android

Needs: the server (0.8.94, to deploy), Boni desktop 0.4.67 (`release/boni_0.4.67_amd64.deb`, to install) and Boni
Android from the CI (Obtainium: its bridge now opens links). Tasks 53 to 55, from what Juan saw trying the 0.4.66.

- **«Proponer tarea» says what came of it.** «2 propuestas en la Bandeja»; «Ya en la Bandeja» or «Ya apuntada» when
  the mail's tasks already wait or were taken; «Sin tareas para ti» when the reader found none; and «Otra vez» reads
  the mail afresh when you ask, the waiting ones giving way. Never «Nada que proponer». (#297, task 54)
- **The collection of a proposal, with Boni's searchable list.** In the card's ✎, the collection is chosen as
  everywhere in Boni: the chosen one as a chip, typing filters, the collections under Tareas, Eventos and Otras, and
  «Crear «nombre»» makes one that does not exist yet. (#298, task 53)
- **«En Gmail».** In «Ver correo» and on a card from mail, the mail opens in Gmail by its Message-ID, in the system's
  browser (the desktop, the phone) or a new tab; only for a Google mailbox. (#299, task 55)

## 2026-11-04 (seventeenth) — server 0.8.93

Needs: the server only (0.8.93, to deploy). Task 43.

- **The server no longer writes to its database on every request.** A session's «last seen» is written at most once
  a minute instead of twice per request: with the desktop asking every 350 ms and the calendar every second, each
  write was a commit on the NAS, and a slow one held the server half a second, every minute the apps were open.
  (#295, task 43)

## 2026-11-04 (sixteenth) — server 0.8.92 · Boni desktop 0.4.66 · Boni Calendar desktop 0.8.20

Needs: the server (0.8.92, to deploy), Boni desktop 0.4.66 (`release/boni_0.4.66_amd64.deb`, to install), Boni
Calendar desktop 0.8.20 (`release/boni-calendar-desktop_0.8.20_amd64.deb`, to install) and the Android calendar
from the CI (Obtainium: its bridge now opens links). Tasks 46 to 49, from what Juan saw trying the inbox with a
real thread of mail.

- **One thread of mail, one proposal.** Replies to the same thread no longer repeat what was already proposed, from
  whoever they come; a reply that changes the day or the hour takes the earlier proposal's place, and the card says
  «Antes: mié, 11 nov, 17:00». (#289, task 46)
- **A proposal is corrected in what you decide of it.** In the card's ✎, the collection's select is grouped as
  Tareas, Eventos and Otras (so «tarea o evento» is that one choice), and the day and the hours are rows of their
  own, editable; another collection keeps them. (#290, task 47)
- **«Ver correo» shows the mail's images and folds the quoted reply.** The images the mail brought come after the
  text and Gmail's «[image: …]» marks go; the earlier message a reply quotes waits behind «···». (#291, task 48)
- **Boni Calendar joins the call.** An event with a Zoom, Meet or Teams link has «Unirse» in its detail and a camera
  pill on its block from ten minutes before it starts until it ends; its links open in the system's browser. (#292,
  task 49)

## 2026-11-03 (fifteenth) — server 0.8.91

Needs: the server only (0.8.91, to deploy). Tasks 45 and 29.

- **A calendar invitation becomes its event, with its exact hours.** A mail that carries a calendar invitation
  (Google, Outlook) gives its event from the invitation itself, by code: the day, the start and the end in your
  timezone, with the place and the video-call link in the note; the card no longer asks «¿A las 09:00?» for it. An
  invitation already in one of your external calendars (the UCAM one) is not proposed again; what the mail asks of
  you besides still is. The server's log says what each reading proposed («mail 1: read <sender>: «title»
  (collection, day hours)»). Found on the way: a mail with a readable attachment (csv, xlsx, txt) stopped its
  reading since the attachments' text exists; fixed. (#287, task 45)
- **The readers answer without reasoning first, and hold to their options.** The models that read mail are asked not
  to reason before answering (DeepSeek V4.1 Flash spent the whole answer on it), the options they choose among (the
  kinds of a summary, a classification) go in their schema, and a refused answer says which rule it broke. The
  planner's evaluation with real models passes 24 of 24. The planner no longer ends a summary with a question card,
  and never sends your own tasks to a reader. (#285, #286, task 29)

## 2026-11-03 (fourteenth) — server 0.8.90

Needs: the server only (0.8.90, to deploy). Task 26, as Juan decided («Sí»).

- **Each mail keeps its original.** A new mail keeps the `.eml` it came as, a file beside its attachments named by
  its subject («Actas de FUP 1.eml»), up to 2 MB; in «Ver correo» it is the last of the attachments and opens whole
  in the computer's mail app. A bigger one is not kept, and the mail says so. Mail already in stays as it was.
  (#283, task 26)

## 2026-11-03 (thirteenth) — server 0.8.89 · Boni Calendar desktop 0.8.19

Needs: the server (0.8.89, to deploy) and Boni Calendar desktop 0.8.19
(`release/boni-calendar-desktop_0.8.19_amd64.deb`, to install). Boni desktop stays 0.4.65. Task 44, and task 43.

- **A task of the whole day has its box.** In Boni Calendar, a task of the whole day shows its box in the week's
  all-day row and in the month, as one with a time; a click marks it done or not. In the month, a task with a time
  shows its box too, instead of the colour dot. (#280, task 44)
- **The Bandeja's cards no longer read the Agenda after each change.** The day around a proposal is kept up to date
  with what changes (an event moved, a new one) instead of reading the Agenda again (0.5-0.7 s on the NAS). (#281,
  task 43)

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
