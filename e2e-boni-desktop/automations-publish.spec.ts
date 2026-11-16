import { test } from "@playwright/test";

/**
 * F14d's criterion the way it will be tried (docs/automatizaciones.md §8): the real desktop app over the real server,
 * a profile and a store of its own, with data shaped like the user's (seed.test-util.ts) and its volume. The server
 * starts as automations-code.spec.ts starts it, with a clock the test moves, so a scheduled hour arrives without
 * waiting for it. Nothing here calls a model, and typing goes at a person's pace. Pending: the phase's first PR
 * brings them, and its builders make each real, the rule's id kept in its name (`make check` reads them).
 */

test.fixme("AU-95 AU-114 AU-99 AU-18 · the criterion of F14d in the desktop app over the real server: a «Programada» that creates a row is published, its hour arrives, the row is in its collection, the run is in «Ejecuciones» saying what it did, and «Deshacer lo que hizo» takes the row away", async () => {});

test.fixme("AU-97 AU-17 · in the desktop app over the real server, «Ejecutar» on a published automation that modifies 3,000 rows stops at the default limit saying which; with the limit raised and published it saves them, the window answers meanwhile, and the run is undone from «Ejecuciones»", async () => {});

test.fixme("AU-167 AU-193 AU-170 · in the desktop app over the real server, a scheduled run with a value from outside and «Preguntar» writes nothing and leaves one proposal in the inbox; accepted, its rows are saved, read as from outside, and undone with the run", async () => {});

test.fixme("AU-195 AU-167 · in the desktop app over the real server, the same published version with «Sí» and a value from outside saves it without asking by «Ejecutar» and at its hour, its run's line says «con datos de fuera», and each run is undone from «Ejecuciones»", async () => {});
test.fixme("AU-186 AU-187 · in the desktop app over the real server, a published «Eliminar filas» with «Sí» sends its rows to the trash at its hour with no proposal, and undoing the run brings them back; with «Preguntar» the same run leaves a proposal", async () => {});

test.fixme("AU-190 · in the desktop app over the real server, a server stopped in the middle of a run and started again shows that run as «Interrumpida» and does not run it again", async () => {});
