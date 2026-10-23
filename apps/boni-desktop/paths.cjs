// Which of the server's paths a page of the app may ask the main process to call (with the token, which the
// page never sees): v1 (charts, capture), the agent's conversation, the pages, the collections as databases
// and the mailbox. Nothing else on the server, no "..", no other host.
const API_PATH =
  /^api\/(v1|agent|pages|pages-trash|data|mail)(\/[A-Za-z0-9_\-./%]*)?(\?[A-Za-z0-9_\-.=&%+]*)?$/;

const allowedPath = (p) => typeof p === "string" && API_PATH.test(p) && !p.includes("..");

// How long a request may take: a turn of the agent's conversation runs plans and model calls (minutes at
// worst); anything else answers in seconds. Cut sooner, a slow answer looked like "no connection" (Juan,
// 2026-10-23). The same in apps/boni-web/src/host.ts and apps/boni-android's Net.kt.
const SLOW_PATH = /^api\/agent\/(turn|answer|confirm|decline)$/;
const timeoutFor = (p) => (SLOW_PATH.test(p) ? 180_000 : 30_000);

module.exports = { allowedPath, timeoutFor };
