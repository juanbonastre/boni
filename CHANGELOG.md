# Changelog

One entry per release: what Juan can try, and what each app needs. The server's version is the Docker image tag
(`boni-calendar-server:0.8.N`); Boni's desktop app is `apps/boni-desktop` (`release/boni_0.4.N_amd64.deb`); Boni
Calendar's desktop app is `apps/calendar-desktop` (`release/boni-calendar-desktop_0.8.N_amd64.deb`); the Android apps
come from the CI's APK (Obtainium). Older releases: the Boni note «Boni: registro y relevos anteriores».

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
