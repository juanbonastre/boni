import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, leaf, type ToolDef } from "@boni/agent";
import {
  INTEGRITY_ORDER,
  integrityRank,
  label,
  SENSITIVITY_ORDER,
  sensitivityRank,
  type TypeDef,
} from "@boni/entities";
import type { ExtensionManifest, FunctionInput, FunctionSpec } from "@boni/extensions";
import { openUserStore, type UserStore } from "@boni/store";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyChangeSet,
  callFunction,
  decideApply,
  derivedLabel,
  dryRun,
  inputFor,
  type Runner,
  runTests,
} from "./functions.ts";
import { codeHash } from "./sandbox.ts";
import { seed } from "./seed.test-util.ts";

/**
 * An extension's functions in the server (E2), with a stand-in for the box that runs each function as plain
 * TypeScript here (the box itself is tested in apps/sandbox): what a function gets, what it may give back, the
 * policy, one run with Undo, and the labels of what it makes.
 */
const dir = mkdtempSync(join(tmpdir(), "boni-funciones-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let store: UserStore;
let ids: Map<string, string>;
let n = 0;
beforeEach(() => {
  store = openUserStore(join(dir, `u${++n}.db`));
  ids = seed(
    store,
    [
      {
        key: "movimiento",
        name: "Movimiento",
        folder: "finanzas/",
        fields: {
          fecha: "date",
          importe: "number",
          concepto: "text",
          cuenta: "text",
          estado: { type: "select", options: ["pendiente", "conciliado"] },
        },
      },
      {
        key: "deuda",
        name: "Deuda",
        folder: "deudas/",
        fields: { saldada: "checkbox", importe: "number" },
      },
      { key: "salud", name: "Salud", folder: "salud/", fields: { fecha: "date" }, ai: "private" },
      { key: "diario", name: "Diario", folder: "diario/", fields: { animo: "text" }, ai: "opaque" },
    ],
    {
      "finanzas/cafe.md":
        '---\nfecha: "2026-10-01"\nimporte: -1.5\nconcepto: "café"\ncuenta: "ING"\nestado: pendiente\n---\n# Café\n\nCon leche.\n',
      "deudas/ana.md": "---\nsaldada: false\nimporte: 20\n---\n# Cena con Ana\n",
      "salud/cita.md": '---\nfecha: "2026-11-02"\n---\n# Dentista\n',
      "diario/hoy.md": '---\nanimo: "bien"\n---\n# Hoy\n',
    },
  );
});

const fnSpec = (more: Partial<FunctionSpec> = {}): FunctionSpec => {
  const code = `function ${more.name ?? "importar"}() {}`;
  return {
    name: "importar",
    code,
    hash: codeHash(code),
    reads: [
      { collection: "movimiento", fields: ["fecha", "importe", "concepto"] },
      { collection: "deuda", fields: ["saldada", "importe"] },
    ],
    writes: [
      { collection: "movimiento", fields: ["fecha", "importe", "concepto"], create: true },
      { collection: "deuda", fields: ["saldada"], update: true },
    ],
    asks: true,
    ...more,
  };
};
const ext = (fn: FunctionSpec = fnSpec()): ExtensionManifest => ({
  id: "banco",
  name: "Banco",
  version: 1,
  functions: [fn],
  tests: [{ function: fn.name, name: "una cena", input: {}, expect: {} }],
  needs: { reads: fn.reads.map((r) => r.collection), proposes: false },
});

/** The stand-in box: each function as code here, its output as the box would give it. */
const box =
  (impl: Record<string, (input: FunctionInput) => unknown>): Runner =>
  async (req) => ({
    id: req.id,
    ok: true,
    output: impl[req.fn]?.(req.input as FunctionInput),
    steps: 1,
    ms: 1,
  });
const importa = box({
  importar: (input) => ({
    summary: "Una cena y la deuda de Ana saldada",
    changes: [
      {
        op: "create",
        collection: "movimiento",
        values: { fecha: "2026-10-30", importe: -12.5, concepto: "cena" },
      },
      {
        op: "update",
        id: input.rows.deuda?.[0]?.id,
        version: input.rows.deuda?.[0]?.version,
        values: { saldada: true },
      },
      { op: "ask", question: "¿Era la cena del sábado?", options: ["Sí", "No"] },
    ],
  }),
});
const turn = { kind: "turn", trust: "personal" } as const;

describe("what a function gets", () => {
  it("its declared fields of its declared collections, each row with its id and version", () => {
    const got = inputFor(store, fnSpec());
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.input.rows.movimiento).toEqual([
      {
        id: ids.get("finanzas/cafe.md"),
        version: 1,
        values: { fecha: "2026-10-01", importe: -1.5, concepto: "café" },
      },
    ]);
    expect(got.input.rows.deuda?.[0]?.values).toEqual({ saldada: false, importe: 20 });
    expect(got.label.integrity).toBe("imported");
  });

  it("an option by its name, and a row's title and text whatever their fields are called", () => {
    const got = inputFor(
      store,
      fnSpec({ reads: [{ collection: "movimiento", fields: ["$title", "$text", "estado"] }] }),
    );
    if (!got.ok) throw new Error(got.message);
    const values = got.input.rows.movimiento?.[0]?.values;
    expect(values).toMatchObject({ $title: "Café", estado: "pendiente" });
    expect(String(values?.$text)).toContain("Con leche.");
  });

  it("nothing private or restricted (until Juan opens it for it, E5); opaque only for code", () => {
    const salud = fnSpec({ reads: [{ collection: "salud", fields: ["fecha"] }] });
    expect(inputFor(store, salud)).toMatchObject({ ok: false, error: "closed" });
    const diario = inputFor(
      store,
      fnSpec({ reads: [{ collection: "diario", fields: ["animo"] }] }),
    );
    expect(diario.ok && diario.label.noModel).toBe(true);
  });
});

describe("what it gives back", () => {
  it("a change set checked against what it declared, labelled as made by it", async () => {
    const r = await callFunction(store, ext(), "importar", { run: importa });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.label.integrity).toBe("model");
    expect(r.label.sources).toContainEqual({ kind: "extension", id: "banco/importar" });
    expect(dryRun(store, r.changeSet, r.read)).toEqual({
      creates: { movimiento: 1 },
      updates: 1,
      asks: ["¿Era la cena del sábado?"],
      stale: [],
    });
  });

  it("anything outside what it declared is refused whole", async () => {
    const sneaky = box({
      importar: () => ({
        changes: [{ op: "create", collection: "deuda", values: { saldada: true } }],
      }),
    });
    expect(await callFunction(store, ext(), "importar", { run: sneaky })).toMatchObject({
      ok: false,
      error: "scope",
    });
    const tampered = { ...fnSpec(), code: "function importar() { return 1 }" };
    expect(await callFunction(store, ext(tampered), "importar", { run: importa })).toMatchObject({
      ok: false,
      error: "invalid",
    });
  });
});

describe("applying it", () => {
  it("goes through the policy: from outside it waits in the inbox, many ask first, in the background it is proposed", async () => {
    const r = await callFunction(store, ext(), "importar", { run: importa });
    if (!r.ok) throw new Error(r.message);
    expect(decideApply(r.changeSet, r.label, turn)).toEqual({ kind: "allow", rule: "P1" });
    expect(decideApply(r.changeSet, r.label, { kind: "background", trust: "personal" })).toEqual({
      kind: "propose",
      rule: "P7",
    });
    const fromBank = { ...r.label, integrity: "external" as const };
    expect(decideApply(r.changeSet, fromBank, turn)).toEqual({ kind: "propose", rule: "P4" });
    const many = {
      changes: Array.from({ length: 25 }, () => ({
        op: "create" as const,
        collection: "movimiento",
        values: { importe: 1 },
      })),
    };
    expect(decideApply(many, r.label, turn)).toEqual({ kind: "confirm", rule: "P11" });
  });

  it("is one run that Undo takes back whole; what it wrote is never a destination", async () => {
    const r = await callFunction(store, ext(), "importar", { run: importa });
    if (!r.ok) throw new Error(r.message);
    const done = applyChangeSet(store, ext(), "importar", r.changeSet, r.label, r.read, {
      device: "portatil",
    });
    expect(done).toMatchObject({ ok: true, updated: [ids.get("deudas/ana.md")] });
    if (!done.ok) return;
    const made = store.get(done.created[0] as string);
    expect(made?.labels.f_importe?.integrity).toBe("model");
    expect(store.get(ids.get("deudas/ana.md") as string)?.entity.values.f_saldada).toBe(true);
    // A value it made, as where a message goes: refused (P2).
    const send: ToolDef<"send"> = {
      name: "mail.send",
      effect: "send",
      describe: "",
      title: "",
      args: { to: { role: "recipient", required: true, describe: "" } },
      run: () => leaf(null, r.label),
    };
    expect(
      decide(
        {
          tool: send,
          args: { to: leaf("x@ejemplo.invalid", made?.labels.f_importe ?? r.label) },
          control: null,
        },
        turn,
        {
          writes: 0,
          sensitiveReads: 0,
        },
      ),
    ).toMatchObject({ kind: "deny", rule: "P2" });
    store.undoRun(done.run, { actor: "user", device: "portatil" });
    expect(store.get(done.created[0] as string)?.entity.deleted).toBeTruthy();
    expect(store.get(ids.get("deudas/ana.md") as string)?.entity.values.f_saldada).toBe(false);
  });

  it("writes an option by its name, a title and a text; an option the field does not have stops it all", async () => {
    const spec = fnSpec({
      reads: [{ collection: "movimiento", fields: ["estado"] }],
      writes: [
        {
          collection: "movimiento",
          fields: ["$title", "$text", "estado", "importe"],
          create: true,
          update: true,
        },
      ],
    });
    const cafe = ids.get("finanzas/cafe.md") as string;
    const writes = (estado: string) =>
      box({
        importar: (input) => ({
          changes: [
            {
              op: "create",
              collection: "movimiento",
              values: {
                $title: "Taxi",
                $text: "Del aeropuerto.",
                estado: "conciliado",
                importe: -20,
              },
            },
            {
              op: "update",
              id: input.rows.movimiento?.[0]?.id,
              version: input.rows.movimiento?.[0]?.version,
              values: { estado },
            },
          ],
        }),
      });
    const lost = await callFunction(store, ext(spec), "importar", { run: writes("perdido") });
    if (!lost.ok) throw new Error(lost.message);
    expect(
      applyChangeSet(store, ext(spec), "importar", lost.changeSet, lost.label, lost.read),
    ).toMatchObject({ ok: false, error: "scope" });
    expect(store.list("t_movimiento")).toHaveLength(1);
    const r = await callFunction(store, ext(spec), "importar", { run: writes("conciliado") });
    if (!r.ok) throw new Error(r.message);
    const done = applyChangeSet(store, ext(spec), "importar", r.changeSet, r.label, r.read);
    if (!done.ok) throw new Error(done.message);
    const t = store.schema().types.t_movimiento as TypeDef;
    const taxi = store.get(done.created[0] as string)?.entity;
    const conciliado = t.fields
      .find((f) => f.key === "estado")
      ?.options?.find((o) => o.name === "conciliado")?.id;
    expect(taxi?.values[t.titleField]).toBe("Taxi");
    expect(taxi?.body).toBe("Del aeropuerto.");
    expect(taxi?.values.f_estado).toBe(conciliado);
    expect(store.get(cafe)?.entity.values.f_estado).toBe(conciliado);
  });

  it("is made again when a row it read changed since, and never leaves what no model may read more open", async () => {
    const r = await callFunction(store, ext(), "importar", { run: importa });
    if (!r.ok) throw new Error(r.message);
    const deuda = ids.get("deudas/ana.md") as string;
    store.update(
      deuda,
      { f_importe: { value: 25, label: label("user", "personal", []) } },
      { actor: "user", device: "movil" },
    );
    expect(dryRun(store, r.changeSet, r.read).stale).toEqual([deuda]);
    expect(applyChangeSet(store, ext(), "importar", r.changeSet, r.label, r.read)).toMatchObject({
      ok: false,
      error: "stale",
    });
    const fromDiary = fnSpec({
      reads: [{ collection: "diario", fields: ["animo"] }],
      writes: [{ collection: "movimiento", fields: ["concepto"], create: true }],
    });
    const leak = box({
      importar: () => ({
        changes: [{ op: "create", collection: "movimiento", values: { concepto: "bien" } }],
      }),
    });
    const l = await callFunction(store, ext(fromDiary), "importar", { run: leak });
    if (!l.ok) throw new Error(l.message);
    expect(
      applyChangeSet(store, ext(fromDiary), "importar", l.changeSet, l.label, l.read),
    ).toMatchObject({
      ok: false,
      error: "more-open",
    });
  });
});

describe("its tests", () => {
  it("run in the box, each giving back exactly what it expects", async () => {
    const e: ExtensionManifest = {
      ...ext(),
      tests: [
        { function: "importar", name: "nada", input: { rows: {} }, expect: { changes: [] } },
        {
          function: "importar",
          name: "algo",
          input: { rows: {} },
          expect: { changes: [{ op: "ask", question: "?" }] },
        },
      ],
    };
    const empty = box({ importar: () => ({ changes: [] }) });
    expect(await runTests(e, empty)).toEqual([
      { function: "importar", name: "nada", ok: true },
      { function: "importar", name: "algo", ok: false, message: "no da lo esperado" },
    ]);
  });
});

describe("the label of what a function makes, whatever it read", () => {
  it("at most `model`, at least as sensitive, kept from the models when its input was, never a destination", () => {
    const send: ToolDef<"send"> = {
      name: "mail.send",
      effect: "send",
      describe: "",
      title: "",
      args: { to: { role: "recipient", required: true, describe: "" } },
      run: () => leaf(null, label("user", "public", [])),
    };
    for (const integrity of INTEGRITY_ORDER)
      for (const sensitivity of SENSITIVITY_ORDER)
        for (const noModel of [false, true]) {
          const from = {
            ...label(integrity, sensitivity, [{ kind: "vault" as const, id: "x" }]),
            ...(noModel ? { noModel: true as const } : {}),
          };
          const made = derivedLabel(from, "banco", "importar");
          expect(integrityRank(made.integrity)).toBeLessThanOrEqual(integrityRank("model"));
          expect(integrityRank(made.integrity)).toBeLessThanOrEqual(integrityRank(integrity));
          expect(sensitivityRank(made.sensitivity)).toBe(sensitivityRank(sensitivity));
          expect(!!made.noModel).toBe(noModel);
          expect(
            decide(
              { tool: send, args: { to: leaf("x@ejemplo.invalid", made) }, control: null },
              turn,
              {
                writes: 0,
                sensitiveReads: 0,
              },
            ).kind,
          ).toBe("deny");
        }
  });
});
