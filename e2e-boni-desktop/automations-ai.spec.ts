import { test } from "@playwright/test";

/**
 * F15's criterion of done in the real desktop app (docs/automatizaciones.md §8): an «Agente» connected to two
 * collections proposes a row in a third; without its permission to read one of them it says it cannot; and every
 * read is in the run's record.
 *
 * Pending until the phase's screens are built (`make check` reads the rule's id, T-10). It will run on the real
 * desktop app with a scripted model: what a real model answers is evaluated by hand, never here.
 */
test.fixme("AU-198 · an «Agente» reads two collections and proposes a row; with reading one of them set to «No» it answers that it cannot, and each read shows in the run", async () => {});
