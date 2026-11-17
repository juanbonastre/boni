// An automation inside a conversation (docs/automatizaciones.md §5.11 and §5.10, phase F16): the chat of a page as
// an automation that starts with «Mensaje de chat», and what an automation asks and answers when its run began in a
// chat (AU-137, AU-222).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test, an invented page with
// its collections and a scripted model.
import { describe, it } from "vitest";

describe("an automation in a conversation (F16)", () => {
  it.todo(
    "AU-137 · the «Chat» block names the same id, now an automation: «Mensaje de chat» with its page, welcome and buttons, an «Agente» born with the page's collections to read only, and «Responder» as the message",
  );
  it.todo(
    "AU-137 · an «Agente» that starts from «Mensaje de chat» cannot carry a «Sí»: publishing refuses it and a run treats it as «Preguntar»; a value of its own page is the only thing it sets alone",
  );
  it.todo(
    "AU-137 · each message is one run in the automation's runs, and the conversation, its messages and its memory stay where they are",
  );
  it.todo(
    "AU-231 · the chat of a page is in the list of automations and opens in the canvas; the conversation with the assistant is not listed, has no runs of its own, and its record stays where a turn's is",
  );
  it.todo(
    "AU-222 · a «Preguntar» of a run that began in a chat is a card in that chat, with a number, a date, a row of a collection or a file as its answer, and it waits as any other",
  );
  it.todo(
    "AU-222 · «Responder» with «Se ve como» is painted by code as text, number, list, table or chart; outside a chat it is what the run returns",
  );
});
