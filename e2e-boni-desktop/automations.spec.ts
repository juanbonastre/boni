import { test } from "@playwright/test";

/**
 * F14b's criterion the way Juan will try it (docs/automatizaciones.md §8): the real desktop app over the real
 * server, a profile and a store of its own (never Juan's), with data shaped like his (seed.test-util.ts: generated
 * ids, his collections' keys and names) and his volume: a collection of 3,000 rows. Pending: the first PR of the
 * phase brings them, and the builder's last PR turns them into real tests, each rule's id kept in its name. The
 * server starts as desktop.spec.ts starts it (`startServer`, the agent on with an invented key: nothing here calls a
 * model); dragging and typing go at a person's pace.
 */

test.fixme("AU-65 AU-21 AU-70 · the criterion of F14b in the desktop app over the real server: «Buscar filas» in a collection of 3,000 rows, «Filtrar» and «Si» added and filled by dragging fields, each step opened with what comes in and what goes out, «Probar» run, and nothing written in the collection", async () => {});

test.fixme("AU-75 · in the desktop app over the real server no step of the catalogue, with any of its actions, shows more than seven rows of «Parámetros» before «Añadir opción»", async () => {});

test.fixme("AU-62 AU-05 · the draft made in the desktop app is on the server: the app closed and opened again shows the same canvas, each box where it was left and each step with its last test", async () => {});

test.fixme("AU-71 AU-20 · with a test of 3,000 rows, opening a step, asking for more rows and «Probar paso» answer within their time (A-15), and typing in an expression at a person's pace asks the server for nothing", async () => {});

test.fixme("AU-151 · over the real server a flow of before is still in the list, opens the editor of before, and runs as it did; «Nueva» makes an automation of the new format beside it", async () => {});
