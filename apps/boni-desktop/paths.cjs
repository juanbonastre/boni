// Which of the server's paths a page of the app may ask the main process to call (with the token, which the
// page never sees): v1 (charts, capture), the agent's conversation, the pages, the collections as databases
// and the mailbox. Nothing else on the server, no "..", no other host.
const API_PATH =
  /^api\/(v1|agent|pages|pages-trash|data|mail)(\/[A-Za-z0-9_\-./%]*)?(\?[A-Za-z0-9_\-.=&%+]*)?$/;

const allowedPath = (p) => typeof p === "string" && API_PATH.test(p) && !p.includes("..");

module.exports = { allowedPath };
