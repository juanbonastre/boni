import { test } from "@playwright/test";

/**
 * F14c's criterion the way it will be tried (docs/automatizaciones.md §8): the real desktop app over the real server
 * and the real box, a profile and a store of its own, with data shaped like the user's (seed.test-util.ts) and its
 * volume: a collection of 3,000 rows. Pending: the first PR of the phase brings them, and the builder's last PR turns
 * them into real tests, each rule's id kept in its name. The server starts as desktop.spec.ts starts it, with the box
 * on a socket of the test. Nothing here calls a model, and typing goes at a person's pace.
 */

test.fixme("AU-30 AU-31 AU-33 · the criterion of F14c in the desktop app over the real server and the real box: a «Código» with the code of the design's §5.4 written in its editor, its two collections connected, «Probar paso» run over 3,000 rows, its rows seen in the output and its `console.log` in «Consola», and nothing written in any collection", async () => {});

test.fixme("AU-31 · in the desktop app over the real server, citing a collection that is not connected says «Conecta … a este paso»; the button connects it and the step can be tested", async () => {});

test.fixme("AU-27 · in the desktop app over the real server and the real box, the value under an expression with JavaScript is, row by row, the value the test gave that row", async () => {});

test.fixme("AU-38 · in the desktop app over the real server and the real box, an expression with JavaScript over 3,000 rows is tested within the time written in the test, and the canvas answers while it runs", async () => {});
