// «Automatizaciones» on the server in F14b (docs/automatizaciones.md §5.7, §5.8, §6, §7): the store, the routes, the
// real `Collections` and `Policy`, and the test run. Pending: the first PR of the phase brings one test per rule,
// and the builder turns each into a real one, keeping the rule's id in its name (`make check` reads them). Real
// tests open a store with the repo's invented seeds (seed.test-util.ts: generated ids, keys and names like Juan's)
// and, where a rule is about volume, thousands of rows.
import { describe, expect, it } from "vitest";
import { AUTOMATION_ACTIONS, AUTOMATION_ROUTES } from "./routes.ts";
import * as service from "./service.ts";

describe("the contract of the routes (it holds today)", () => {
  it("every route is under the path the apps already allow, runs an action there is, and names a function of the service", () => {
    for (const [route, { action, runs }] of Object.entries(AUTOMATION_ROUTES)) {
      // What paths.cjs and Net.kt allow under api/agent: letters, digits and - _ . / % after the prefix.
      expect(route, route).toMatch(
        /^(GET|POST|PUT|DELETE) \/api\/agent\/automations(\/[a-z:/]*)?$/,
      );
      expect(Object.keys(AUTOMATION_ACTIONS), route).toContain(action);
      expect(typeof (service as Record<string, unknown>)[runs], route).toBe("function");
      // A GET never runs an action that changes something.
      if (route.startsWith("GET ")) expect(AUTOMATION_ACTIONS[action]?.effect, route).toBe("read");
    }
    const used = new Set(Object.values(AUTOMATION_ROUTES).map((r) => r.action));
    expect(Object.keys(AUTOMATION_ACTIONS).filter((a) => !used.has(a))).toEqual([]);
  });
});

describe("the routes and the list of actions", () => {
  it.todo(
    "AU-168 · every route of AUTOMATION_ROUTES is in ROUTES as tailnet and in ROUTE_RUNS with its action; with a list of actions that lacks it the route is refused (403, P0) before anything runs, the reads too",
  );
  it.todo(
    "AU-168 · an action that changes an automation is Juan's touch: his hand runs it, and an assistant, a flow and work in the background are refused by the policy",
  );
  it.todo(
    "AU-168 · asked by an origin that is not Juan's hand, automations.read and automations.test answer the states and the counts and never a row or a field's value",
  );
  it.todo(
    "AU-87 · no action of the list adds, removes or changes a step of a draft but automations.create and automations.edit, and neither runs for an origin that is not Juan's hand or his card",
  );
});

describe("where an automation lives", () => {
  it.todo(
    "AU-62 · the draft saves itself: the first step creates the automation with its draft, each later save keeps the whole document over the last and answers its new rev, and another device reads what the last one saved",
  );
  it.todo(
    "AU-62 · a draft that is not the format, has another's id or is over 200,000 characters is refused, and one with problems of validate is kept all the same",
  );
  it.todo(
    "AU-62 · «Duplicar» makes a new automation named as told with the same steps, arrows and places and no tests; «Eliminar» takes it off the list and restore brings it back with its draft, places and tests",
  );
  it.todo(
    "AU-05 · the places of the boxes are kept apart from the draft: placing steps changes no rev and makes no test stale, a step with no place has no entry, and a step the draft no longer has loses its place",
  );
  it.todo(
    "AU-61 · the collection «Automatizaciones» has six columns (name, what starts it, state, last run, runs, whose); an automation of the new format says «Sin publicar» with no runs, and one with no trigger says none",
  );
  it.todo(
    "AU-61 · with a thousand automations and flows the list answers within its time (A-15): no draft is parsed to list it",
  );
  it.todo(
    "AU-60 · Boni's collection of automations says «Automatizaciones» in its name and in what it tells an assistant; the internal names (flows.*, flows_*) stay until F16",
  );
  it.todo(
    "AU-60 · the MCP's texts (the guide and the descriptions of the flows_* tools) say automation where they said flow; the tools keep their names until F16",
  );
  it.todo(
    "AU-61 · a flow of before says «Encendida» or «Apagada» and only it does; «De» says whose each is (the user's, Boni's or a page's, with the page's name); with no automation and no flow the collection has no rows",
  );
  it.todo(
    "AU-61 · the map lists the flows of before and no automation of the new format, which does not run until it is published (F14d)",
  );
  it.todo(
    "AU-151 · the list has the flows of before and the automations side by side, each saying its format; a flow of before still saves, turns on and off and runs through its own routes, untouched by this phase",
  );
});

describe("the real Collections and the real Policy", () => {
  it.todo(
    "AU-04 · a row read from the store knows its record and the version it was read at, and a change to a row that changed since is refused whole",
  );
  it.todo(
    "AU-162 · a row read from the store has its record's label and each field that differs its own: a value that came from outside is still from outside in the row, field by field",
  );
  it.todo(
    "AU-164 · rows read from the store come in the same order twice (the sort, then the id), and a search with conditions over thousands of rows is one query, timed (A-15)",
  );
  it.todo(
    "AU-19 · for each action of «Colección» the real policy answers what decide answers for the list's action that does the same to a record, with the same labelled arguments and origin: the trash is asked about (P5)",
  );
  it.todo(
    "AU-168 · one policy per run counts over the whole run: the policy's own limit of writes stops a test that would write past it",
  );
});

describe("«Probar» and «Probar paso»", () => {
  it.todo(
    "AU-90 · «Probar» reads and computes for real on the store and writes nothing: the operation log is as long after it as before, nothing is proposed or notified and no run is left in the journal",
  );
  it.todo(
    "AU-90 · a step that would write gives the row it would make, with the saved row as it is now for «Haría esto», and what follows goes on with it",
  );
  it.todo(
    "AU-91 · «Probar paso» runs that step and what it lacks, takes the rest from the kept tests, and answers which ran and which were reused; the kept test of a step that did not run is untouched",
  );
  it.todo(
    "AU-92 · a save of the draft answers the steps whose kept test is stale, and the view marks them; moving a box or renaming a step marks none",
  );
  it.todo(
    "AU-94 · a test of «Disparado por el usuario» takes the fields it declares, labelled as Juan's from his device: one it lacks is null, one it does not declare is refused, and the view offers the last ones again, read from the row the trigger gave in its kept test",
  );
  it.todo(
    "AU-115 · an automation is tested by hand whatever its trigger: the test starts in the trigger named, with the fields that trigger declares",
  );
  it.todo(
    "AU-64 · an automation with problems is not tested: the answer is invalid with each problem's step and parameter, and nothing kept changes",
  );
  it.todo(
    "AU-67 · after a test every step the trigger reaches has its state and its rows in and out by output, an unconnected output too; a step that failed says why and the ones that hung from it are skipped",
  );
  it.todo(
    "AU-71 · the rows that came into a step are served 50 at a time with their total, each with its label and the fields that came from outside",
  );
  it.todo(
    "AU-72 · the rows of each output of a step are served 50 at a time from the kept chunks: a page of a test of 3,000 rows does not read the other rows, timed (A-15)",
  );
  it.todo(
    "AU-84 · a step that fails because of a parameter names it: the error carries the parameter's path as validation writes one",
  );
});
