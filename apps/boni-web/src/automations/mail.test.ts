/** The panels of «Leer correo»'s steps as data: the cap said, the rows of the rules, and «Crear en la elegida»'s cells. */
import {
  type Automation,
  BONI_PARAMS,
  BONI_TRIGGERS,
  CREATE_CHOSEN,
  MAIL_CAP,
  type Step,
} from "@boni/automations";
import { cpu, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { instructionsCardOf } from "../core/agent.ts";
import { translator } from "../i18n.ts";
import { setChosenCell, setParam } from "./edit.ts";
import {
  capWords,
  chosenAmong,
  chosenRows,
  newRule,
  type RuleRow,
  rulesOf,
  setRule,
} from "./mail.ts";
import { rowsOf } from "./panel.ts";
import { namer } from "./words.ts";

const t = translator("es");
const names = namer(t, {});
/** Collection keys as his are: generated ids, never names. */
const KEY_A = "c_01k3vd9x7a8m2q4r6t0w";
const KEY_B = "c_01k3vd9x7b1n5p3s8u2y";
const KEY_C = "c_01k3vd9x7c4f6h8j0k2m";

/** «Leer correo» as Boni draws it (apps/server's drawReadMail): its pieces in order, the last with «Preguntar» cells. */
function readMail(keys: readonly string[] = [KEY_A, KEY_B]): Automation {
  const perRow = { [BONI_PARAMS.mode]: "perRow" };
  const step = (id: string, type: string, params: Step["params"] = {}): Step => ({
    id,
    name: id,
    type,
    params: { ...perRow, ...params },
  });
  return {
    id: "a_01k3vd9x7z0000000001",
    name: "Leer correo",
    steps: [
      { id: "trigger", name: "Llega un correo", type: BONI_TRIGGERS.mail, params: {} },
      step("p-rule", "boni.mailRule", { [BONI_PARAMS.rules]: [] }),
      step("p-reader", "boni.mailReader", {
        [BONI_PARAMS.modules]: ["tasks"],
        [BONI_PARAMS.instructions]: "",
        [BONI_PARAMS.model]: "",
      }),
      step("p-decider", "boni.mailDecider", {
        [BONI_PARAMS.collections]: keys.map((collection) => ({ collection })),
        [BONI_PARAMS.model]: "",
      }),
      {
        ...step("p-create", CREATE_CHOSEN, { [BONI_PARAMS.onlyKnown]: true }),
        connections: keys.map((collection) => ({
          collection,
          read: false,
          create: { mode: "ask" as const },
          update: false,
          remove: false,
        })),
      },
    ],
    arrows: [],
  } as unknown as Automation;
}
const stepOf = (a: Automation, id: string) => a.steps.find((s) => s.id === id) as Step;

describe("«Leer correo»'s panels", () => {
  it("AU-253 · the trigger's panel says the cap the code holds, never a parameter to change", () => {
    const words = capWords(t);
    for (const n of [MAIL_CAP.perDay, MAIL_CAP.perSender, MAIL_CAP.queue])
      expect(words).toContain(String(n));
    expect(words).toBe("150 llamadas al día · 20 por remitente · 500 en cola");
  });

  it("AU-249 · a rule is born «No leer», «No leer» names no collection, and one row changed leaves the others the same objects", () => {
    expect(newRule()).toEqual({ sender: "", do: "skip" });
    const rows: RuleRow[] = [
      { sender: "ejemplo.boletin@example.com", do: "skip" },
      { sender: "ejemplo.banco@example.org", do: "collection", collection: KEY_A },
    ];
    const sender = setRule(rows, 0, { sender: "ejemplo.otro@example.com" });
    expect(sender[0]).toEqual({ sender: "ejemplo.otro@example.com", do: "skip" });
    expect(sender[1]).toBe(rows[1]);
    const skip = setRule(rows, 1, { do: "skip" });
    expect(skip[1]).toEqual({ sender: "ejemplo.banco@example.org", do: "skip" });
    expect(skip[0]).toBe(rows[0]);
    expect(setRule(rows, 1, { collection: "" })[1]).toEqual({
      sender: "ejemplo.banco@example.org",
      do: "collection",
    });
    expect(setRule(rows, 1, { collection: KEY_B })[1]).toMatchObject({ collection: KEY_B });
    // What is not a row (an expression, a word) is left out of the table.
    expect(rulesOf([rows[0], "x", { expr: "{{ 1 }}" }, null] as never)).toEqual([rows[0]]);
    expect(rulesOf(undefined)).toEqual([]);
  });

  it("AU-249 · a parameter a piece's panel hides keeps its stored value when the step is saved: «Se ejecuta», and «Argumentos» and «Por qué» while empty", () => {
    const drawn = readMail();
    const hidden = {
      [BONI_PARAMS.mode]: "perRow",
      [BONI_PARAMS.args]: [],
      [BONI_PARAMS.why]: "",
    };
    const withHidden: Automation = {
      ...drawn,
      steps: drawn.steps.map((s) =>
        s.id === "p-reader" ? { ...s, params: { ...s.params, ...hidden } } : s,
      ),
    };
    const shown = rowsOf(stepOf(withHidden, "p-reader")).map((r) => r.param.key);
    for (const key of Object.keys(hidden)) expect(shown).not.toContain(key);
    // Changing what the panel shows, then saving (the draft goes as JSON), leaves what it hides as it was.
    const changed = setParam(
      withHidden,
      "p-reader",
      BONI_PARAMS.instructions,
      "Lee los correos de ejemplo.",
      names,
    );
    const saved = JSON.parse(JSON.stringify(changed)) as Automation;
    expect(stepOf(saved, "p-reader").params).toMatchObject({
      ...hidden,
      [BONI_PARAMS.instructions]: "Lee los correos de ejemplo.",
    });
    expect(stepOf(saved, "p-rule").params[BONI_PARAMS.mode]).toBe("perRow");
  });

  it("AU-249 · «A una colección» names the «Decisora»'s collections, in its order, each once", () => {
    const a = readMail([KEY_B, KEY_A, KEY_B]);
    expect(chosenAmong(a)).toEqual([KEY_B, KEY_A]);
  });

  it("AU-250 · «Crear en la elegida» has one row per collection of the «Decisora», each with the cell its connection holds; one with none is «No», never «Sí»", () => {
    const drawn = readMail();
    expect(chosenRows(drawn, stepOf(drawn, "p-create"))).toEqual([
      { collection: KEY_A, cell: "ask" },
      { collection: KEY_B, cell: "ask" },
    ]);
    // A collection added to the «Decisora» afterwards: a row, «No» until his hand says otherwise.
    const added = setParam(
      drawn,
      "p-decider",
      BONI_PARAMS.collections,
      [{ collection: KEY_A }, { collection: KEY_B }, { collection: KEY_C }],
      names,
    );
    const rows = chosenRows(added, stepOf(added, "p-create"));
    expect(rows.map((r) => r.cell)).toEqual(["ask", "ask", false]);
    expect(rows.some((r) => r.cell === "yes")).toBe(false);
  });

  it("AU-250 · «Sí» only by the table's hand: setting a cell makes «Sí» only where it was set, «No» takes the connection away, and nothing else turns a cell to «Sí»", () => {
    const drawn = readMail();
    // His hand on one row: that row, and only that one, says «Sí».
    const yes = setChosenCell(drawn, "p-create", KEY_B, "yes");
    expect(chosenRows(yes, stepOf(yes, "p-create")).map((r) => r.cell)).toEqual(["ask", "yes"]);
    // A collection with no connection, set by hand: born creating only, with the mode chosen.
    const added = setParam(
      yes,
      "p-decider",
      BONI_PARAMS.collections,
      [{ collection: KEY_A }, { collection: KEY_B }, { collection: KEY_C }],
      names,
    );
    const asked = setChosenCell(added, "p-create", KEY_C, "ask");
    const born = stepOf(asked, "p-create").connections?.find((c) => c.collection === KEY_C);
    expect(born).toMatchObject({
      collection: KEY_C,
      read: false,
      create: { mode: "ask" },
      update: false,
      remove: false,
    });
    // «No» takes the connection away; «No» on a collection with none leaves the draft as it is.
    const none = setChosenCell(asked, "p-create", KEY_A, false);
    expect(stepOf(none, "p-create").connections?.map((c) => c.collection)).toEqual([KEY_B, KEY_C]);
    expect(setChosenCell(none, "p-create", KEY_A, false)).toBe(none);
    // Other edits of the step (its option, the «Decisora»'s list) never turn a cell to «Sí».
    const edited = setParam(
      setParam(drawn, "p-create", BONI_PARAMS.onlyKnown, false, names),
      "p-decider",
      BONI_PARAMS.collections,
      [{ collection: KEY_C }, { collection: KEY_A }],
      names,
    );
    expect(chosenRows(edited, stepOf(edited, "p-create")).some((r) => r.cell === "yes")).toBe(
      false,
    );
    // An unknown step is left alone.
    expect(setChosenCell(drawn, "p-none", KEY_A, "yes")).toBe(drawn);
  });
});

describe("«Ver el cambio» of «Revisar instrucciones» (AU-211)", () => {
  const rule = (i: number) => ({ sender: `ejemplo.remitente${i}@example.com`, do: "skip" });
  const wire = {
    kind: "instructions",
    id: "r_01k3vd9x7a8m2q4r6t0w",
    automation: "leer-correo",
    name: "<b>Leer correo</b>",
    rules: {
      before: [rule(0)],
      added: [
        {
          sender: "<script>ejemplo@example.com</script>",
          do: "collection",
          collection: "<i>Tareas</i>",
        },
        "x",
        null,
      ],
    },
    examples: {
      before: [],
      added: [{ subject: "<img src=x>", want: ["<b>Pagar</b>", 3] }],
    },
    before: 14,
    after: 18,
    total: 20,
    at: 5,
    mayDecide: "true",
  };
  it("AU-211 · the card reads the server's fields as plain text, drops what is not a rule or an example, and decides only with the server's own true", () => {
    const [card] = instructionsCardOf(wire);
    expect(card).toMatchObject({
      name: "<b>Leer correo</b>",
      before: 14,
      after: 18,
      total: 20,
      mayDecide: false,
    });
    expect(card?.rules.added).toEqual([
      {
        sender: "<script>ejemplo@example.com</script>",
        do: "collection",
        collection: "<i>Tareas</i>",
      },
    ]);
    expect(card?.examples.added).toEqual([{ subject: "<img src=x>", want: ["<b>Pagar</b>"] }]);
    expect(instructionsCardOf({ ...wire, mayDecide: true })[0]?.mayDecide).toBe(true);
    expect(instructionsCardOf({ ...wire, kind: "suggested" })).toEqual([]);
    expect(instructionsCardOf({ ...wire, automation: "" })).toEqual([]);
    // A-15: his panel's most (500 rules, 20 examples), read each time the Bandeja looks, within a frame.
    const full = {
      ...wire,
      rules: { before: Array.from({ length: 480 }, (_, i) => rule(i)), added: [rule(500)] },
      examples: {
        before: Array.from({ length: 20 }, (_, i) => ({ subject: `Asunto ${i}`, want: ["Tarea"] })),
        added: [],
      },
    };
    instructionsCardOf(full);
    const t0 = cpu();
    const [big] = instructionsCardOf(full);
    under(cpu() - t0, 16, "cpu", "a suggestion over 480 rules and 20 examples");
    expect(big?.rules.before).toHaveLength(480);
  });
});
