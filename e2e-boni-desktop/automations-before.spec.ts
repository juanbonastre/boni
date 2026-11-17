import { test } from "@playwright/test";

/**
 * F16's criterion of done in the real desktop app (docs/automatizaciones.md §8): the mail automation opens in the
 * new canvas with its pieces and keeps reading mail the same, and no «Formato anterior» is left.
 *
 * Pending until the phase's screens are built (`make check` reads the rules' ids, T-10). It will run on the real
 * desktop app with invented mail and a scripted model: what a real model reads is evaluated by hand, never here.
 */
test.fixme("AU-127 AU-150 · the mail automation opens in the new canvas with its pieces as steps; an invented mail that arrives is read and proposed as before, its run shows in «Ejecuciones», and nothing in the app says «Formato anterior»", async () => {});
