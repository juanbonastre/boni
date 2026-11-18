// The policy for what a published automation writes (docs/automatizaciones.md §6: AU-167, AU-186, AU-195, AU-193's
// accepted removal, and the decision 11 of its §10; docs/nucleo.md §7.5, the row P28 and the new sentences of P4, P5,
// P7 and P15; docs/principios.md A-36; phase F14d). `decide` learns one origin, `automation`, the same for a run the
// user starts and for one that starts alone, and what it answers is one test per row of the rule. The tables over
// the server's acts (`ACTS`) are apps/server's (automations.test.ts): the core knows no app (A-02).
import { type Label, label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { type Call, decide, type Origin } from "../src/policy.ts";
import type { ToolDef } from "../src/tools.ts";
import { leaf, rec, type Val } from "../src/values.ts";
import { testRegistry } from "./fixture.ts";

const reg = testRegistry();
const tool = (name: string): ToolDef => {
  const t = reg.get(name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const CREATE = tool("entities.create");
const UPDATE = tool("entities.update");
const TRASH = tool("entities.delete");
const QUERY = tool("entities.query");
const MEMORY = tool("memory.save");
const SEND = tool("mail.send");
const FETCH = tool("web.fetch");
/** Something that cannot be undone: no tool of the core is one, so the test makes it from the trash's. */
const PURGE: ToolDef = { ...TRASH, name: "ejemplo.purge", effect: "write_irreversible" };

const user = label("user", "personal", [{ kind: "turn", id: "t" }]);
const own = label("own", "personal", []);
const ext = label("external", "personal", [{ kind: "mail", id: "m" }]);
const model = label("model", "public", [{ kind: "model", id: "r" }]);
const ambient = label("ambient", "public", []);

const AUTOMATION: Origin = { kind: "automation", trust: "personal" };
const OTHERS: readonly Origin[] = [
  { kind: "turn", trust: "personal" },
  { kind: "background", trust: "personal" },
  { kind: "miniapp", trust: "personal" },
  { kind: "assistant", trust: "personal" },
];
const fresh = () => ({ writes: 0, sensitiveReads: 0 });

/** A call as the server's policy makes one for a step's write: the collection (own), its fields with their labels. */
function write(t: ToolDef, fields: Label | null, more: Partial<Call> = {}): Call {
  const args: Record<string, Val> = {};
  if (t === CREATE) args.type = leaf("tarea", own);
  if (t === UPDATE) args.id = leaf("e_ejemplo1", own);
  if (fields && (t === CREATE || t === UPDATE))
    args.values = rec({ titulo: leaf("x", fields, true), nota: leaf("y", own) }, fields, true);
  return { tool: t, args, control: null, flow: true, ...more };
}
const ruled = (c: Call, origin = AUTOMATION, counters = fresh()) => {
  const d = decide(c, origin, counters);
  return `${d.kind} ${d.rule}`;
};

describe("what a step of a published version writes (P28, F14d)", () => {
  it("AU-167 · from the origin `automation`, creating or modifying is allowed (P28) when the call carries the «Sí» of the published version for that collection and that action, and reading is allowed as in the background", () => {
    for (const t of [CREATE, UPDATE])
      expect(ruled(write(t, user, { yes: true })), t.name).toBe("allow P28");
    expect(
      ruled({ tool: QUERY, args: { type: leaf("tarea", own) }, control: null, flow: true }),
    ).toBe("allow P1");
  });
  it("AU-167 · with that «Sí», a value from outside (P4) and a path that depends on something from outside (P15) are allowed too, for create, update and remove: P28 is the one exception to both rules", () => {
    for (const t of [CREATE, UPDATE]) {
      expect(ruled(write(t, ext, { yes: true })), `${t.name} P4`).toBe("allow P28");
      expect(ruled(write(t, user, { yes: true, control: ext })), `${t.name} P15`).toBe("allow P28");
    }
    expect(ruled(write(TRASH, null, { yes: true, control: ext }))).toBe("allow P28");
  });
  it("AU-167 · without that «Sí», the origin `automation` gets a proposal for a create or an update and a confirmation for a removal, whatever its values carry", () => {
    for (const fields of [user, ext]) {
      for (const t of [CREATE, UPDATE]) {
        expect(ruled(write(t, fields)), t.name).toBe("propose P28");
        expect(ruled(write(t, fields, { yes: false })), t.name).toBe("propose P28");
      }
      expect(ruled(write(TRASH, null, { control: fields }))).toBe("confirm P5");
    }
  });
  it("AU-167 · from the origin `automation`, a value of an ambient turn is proposed with or without the «Sí», and a value a model wrote follows the «Sí» as any other since F15 (AU-204)", () => {
    for (const yes of [true, false]) {
      for (const t of [CREATE, UPDATE]) {
        expect(ruled(write(t, ambient, { yes })), `${t.name} ambient ${yes}`).toBe("propose P28");
        expect(ruled(write(t, user, { yes, control: ambient })), `${t.name} control`).toBe(
          "propose P28",
        );
        expect(ruled(write(t, model, { yes })), `${t.name} model ${yes}`).toBe(
          yes ? "allow P28" : "propose P28",
        );
      }
      expect(ruled(write(TRASH, null, { yes, control: ambient }))).toBe("propose P28");
      expect(ruled(write(TRASH, null, { yes, control: model }))).toBe(
        yes ? "allow P28" : "confirm P5",
      );
    }
    // Hidden under a value from outside in the joined label (external is lower than ambient), it is still seen.
    const mixed = write(CREATE, null, { yes: true });
    mixed.args = {
      ...mixed.args,
      values: rec({ a: leaf("x", ext, true), b: leaf("y", ambient, true) }, ext, true),
    };
    expect(ruled(mixed)).toBe("propose P28");
  });
  it("AU-167 · from the origin `automation`, the policy's count of writes (P11) asks nothing, at 20 rows or at 3,000: the cap is the run's own limit; from a turn it still asks", () => {
    for (const writes of [20, 3000]) {
      const counters = { writes, sensitiveReads: 0 };
      expect(ruled(write(UPDATE, user, { yes: true, rows: 3000 }), AUTOMATION, counters)).toBe(
        "allow P28",
      );
      expect(ruled(write(UPDATE, user, { rows: 3000 }), OTHERS[0], counters)).toBe("confirm P11");
    }
  });
  it("AU-167 · from the origin `automation`, sending, going outside and what cannot be undone are denied, a destination from outside or from a model is denied (P2, P14) and memory with something from outside is denied (P9), with the «Sí» too", () => {
    const to = {
      to: leaf("ejemplo.ana@example.com", user),
      subject: leaf("x", user),
      body: leaf("y", user),
    };
    for (const yes of [true, false]) {
      expect(
        decide({ tool: SEND, args: pick(SEND, to), control: null, yes }, AUTOMATION, fresh()),
      ).toMatchObject({
        kind: "deny",
      });
      expect(
        decide(
          {
            tool: FETCH,
            args: pick(FETCH, { url: leaf("https://example.com", user) }),
            control: null,
            yes,
          },
          AUTOMATION,
          fresh(),
        ),
      ).toMatchObject({ kind: "deny" });
      expect(ruled({ ...write(PURGE, null), yes })).toBe("deny P28");
      expect(ruled({ tool: MEMORY, args: { text: leaf("z", ext) }, control: null, yes })).toBe(
        "deny P9",
      );
      expect(ruled({ tool: MEMORY, args: { text: leaf("z", user) }, control: null, yes })).toBe(
        "deny P28",
      );
      // A destination taken from outside or made of something: P14, then P2, before any origin's rule.
      for (const [v, rule] of [
        [leaf("ejemplo.ana@example.com", ext), "P2"],
        [leaf("ejemplo.ana@example.com", model), "P2"],
        [leaf("ejemplo.ana@example.com", user, true), "P14"],
      ] as const)
        expect(ruled({ tool: SEND, args: pick(SEND, { ...to, to: v }), control: null, yes })).toBe(
          `deny ${rule}`,
        );
    }
  });
  it("AU-167 · no other origin gains the exception: from a turn, the background of before, a mini-app or an assistant, a write with something from outside is answered as before (P4, P15, P7, P24), with or without a «Sí» in the call", () => {
    for (const origin of OTHERS)
      for (const t of [CREATE, UPDATE]) {
        const before = ruled(write(t, ext), origin);
        expect(before, `${origin.kind} ${t.name}`).not.toBe("allow P28");
        expect(before.startsWith("allow"), `${origin.kind} ${t.name}`).toBe(false);
        expect(ruled(write(t, ext, { yes: true }), origin), `${origin.kind} ${t.name}`).toBe(
          before,
        );
        const path = ruled(write(t, user, { control: ext }), origin);
        expect(ruled(write(t, user, { control: ext, yes: true }), origin)).toBe(path);
      }
  });
});

describe("the trash with the user's «Sí» (P5, F14d)", () => {
  it("AU-186 · from the origin `automation`, sending a row to the trash is allowed only when the call carries the «Sí» of the published version for that collection; without it, it is confirmed (P5)", () => {
    expect(ruled(write(TRASH, null, { yes: true }))).toBe("allow P28");
    expect(ruled(write(TRASH, null))).toBe("confirm P5");
    expect(ruled(write(TRASH, null, { yes: false }))).toBe("confirm P5");
  });
  it("AU-186 · with that «Sí», a removal whose rows were chosen by something from outside (values or path) is allowed as one with none: the two conditions are the published version and the «Sí»", () => {
    expect(ruled(write(TRASH, null, { yes: true, control: ext }))).toBe(
      ruled(write(TRASH, null, { yes: true })),
    );
  });
  it("AU-186 · the «Sí» counts for no other origin: from a turn, the background, a mini-app or an assistant, the same call is answered as before (P5, P24)", () => {
    for (const origin of OTHERS) {
      const before = ruled(write(TRASH, null), origin);
      expect(ruled(write(TRASH, null, { yes: true }), origin), origin.kind).toBe(before);
      expect(before, origin.kind).not.toBe("allow P28");
    }
  });
  it("AU-193 · a removal accepted inside the proposal of a run, from a personal device, is not confirmed again (P5's new sentence); accepted in any other proposal, or from a device that is not personal, it is answered as before", () => {
    const accepted: Origin = { kind: "accepted", trust: "personal" };
    const shared: Origin = { kind: "accepted", trust: "shared" };
    expect(ruled(write(TRASH, null, { ofRun: true }), accepted)).toBe("allow P5");
    expect(ruled(write(TRASH, null), accepted)).toBe("confirm P5");
    expect(ruled(write(TRASH, null, { ofRun: true }), shared)).toBe(
      ruled(write(TRASH, null), shared),
    );
    // Nothing that cannot be undone is lifted by it.
    expect(ruled(write(PURGE, null, { ofRun: true }), accepted)).toBe("confirm P5");
    // And from any other origin it means nothing.
    for (const origin of OTHERS)
      expect(ruled(write(TRASH, null, { ofRun: true }), origin)).toBe(
        ruled(write(TRASH, null), origin),
      );
  });
});

describe("what saves a run's proposal (AU-193, F14d P3b)", () => {
  /** A tool as `automations.accept_run` is registered (apps/server's proposal.ts): only an acceptance calls it. */
  const ACCEPT_RUN: ToolDef = {
    ...CREATE,
    name: "ejemplo.accept_run",
    acceptsRun: true,
    alwaysConfirm: true,
    args: {
      automation: { role: "option", required: true, describe: "id" },
      run: { role: "option", required: true, describe: "id" },
    },
  };
  const call = (): Call => ({
    tool: ACCEPT_RUN,
    args: { automation: leaf("a_ejemplo", own), run: leaf("r_ejemplo", own) },
    control: null,
  });
  it("AU-193 · no plan can call the acceptance of a run's proposal: from a turn, the background, a mini-app, an assistant, a hand or a run it is denied (P28), with any trust; only Juan's acceptance in the inbox passes", () => {
    const planned: Origin[] = [
      ...OTHERS,
      AUTOMATION,
      { kind: "hand", trust: "personal" },
      { kind: "turn", trust: "ambient" },
    ];
    for (const origin of planned) {
      const d = decide({ ...call(), yes: true }, origin, fresh());
      expect(d, origin.kind).toEqual({ kind: "deny", rule: "P28", reason: "only-accepted" });
    }
    expect(ruled(call(), { kind: "accepted", trust: "personal" })).not.toBe("deny P28");
  });
});

describe("who starts a run (A-36, F14d)", () => {
  it("AU-195 · who started the run is no input of `decide`: a real run by hand no longer asks as `hand` (P25), and with «Preguntar» both a run by hand and a run that starts alone propose", () => {
    // The one origin carries no starter: whatever trust or device it is given, the answer is the same.
    const variants: Origin[] = [
      AUTOMATION,
      { kind: "automation", trust: "shared" },
      { kind: "automation", trust: "personal", device: "d_ejemplo" },
    ];
    for (const c of [
      write(CREATE, user),
      write(UPDATE, ext),
      write(TRASH, null),
      write(UPDATE, ext, { yes: true }),
    ]) {
      const answers = new Set(variants.map((o) => ruled(c, o)));
      expect(answers.size).toBe(1);
      expect([...answers][0]?.endsWith("P25")).toBe(false);
    }
    expect(ruled(write(UPDATE, user))).toBe("propose P28");
  });
});

/** Only the arguments a tool declares, with a value for each it requires. */
function pick(t: ToolDef, args: Record<string, Val>): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const [name, spec] of Object.entries(t.args))
    if (args[name]) out[name] = args[name];
    else if ((spec as { required?: boolean }).required) out[name] = leaf("x", user);
  return out;
}

describe("a notice of a run (AU-201, F15 S2)", () => {
  it("AU-201 · from the origin `automation`, a notice to his own devices (no recipient) is allowed as from a turn or the background (P1), whatever its text's label; a send with a recipient stays denied", () => {
    const NOTIFY = tool("notify");
    for (const l of [user, own, ext, model, ambient]) {
      const call: Call = {
        tool: NOTIFY,
        args: { text: leaf("Listo", l) },
        control: null,
        flow: true,
      };
      expect(ruled(call), l.integrity).toBe("allow P1");
      expect(ruled({ ...call, control: ext }), l.integrity).toBe("allow P1");
      for (const origin of OTHERS.slice(0, 2))
        expect(ruled(call, origin), origin.kind).toBe("allow P1");
    }
    expect(ruled({ tool: SEND, args: pick(SEND, {}), control: null, flow: true })).toBe("deny P28");
  });
});
