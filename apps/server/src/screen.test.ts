/**
 * (test) What is on Juan's screen as he writes (F9, task 85): the app sends references, the server makes them values
 * through the models' view (nothing closed, what came from outside as a handle) and a plan may name them as
 * `$screen`: «¿qué me pide el de arriba?» answers about the Bandeja's first card.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codeLabel,
  deepLabel,
  ensureSystemTypes,
  fakePlanner,
  leaf,
  plain,
  rec,
  ScriptedProvider,
  type Val,
} from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { openDb } from "./db.ts";
import { createPage } from "./pages.ts";
import { MAX_POINTED, type SavedChart, screenOf, screenRefs } from "./screen.ts";
import { seed } from "./seed.test-util.ts";
import { V1Service } from "./v1/service.ts";
import { V1Store } from "./v1/store.ts";
import { StoreMoney } from "./v1/storeMoney.ts";

let dir = "";
let host: AgentHost | null = null;
afterEach(() => {
  host?.close();
  host = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const mail = label("external", "personal", [{ kind: "mail", id: "m1" }]);
const lit = (v: string) => ({ lit: v });

function setUp(planner = fakePlanner([])) {
  dir = mkdtempSync(join(tmpdir(), "boni-pantalla-"));
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: fakePlanner([]) } });
  const store = host.store(1);
  seed(
    store,
    [
      { key: "tarea", name: "Tarea", folder: "tareas/", fields: { titulo: "text" } },
      { key: "privado", name: "Privado", folder: "privado/", fields: { titulo: "text" } },
      { key: "opaca", name: "Opaca", folder: "opaca/", fields: { titulo: "text" } },
      {
        key: "libro",
        name: "Libros",
        folder: "libros/",
        fields: {
          estado: { type: "select", options: ["Leído", "Pendiente"] },
          paginas: "number",
          fin: "date",
        },
      },
    ],
    {
      "tareas/uno.md": "---\ntitulo: Preparar el examen\n---\n",
      "privado/dos.md": "---\ntitulo: Lo que no ve nadie\n---\n",
      "opaca/tres.md": "---\ntitulo: Lo que solo el código ve\n---\n",
      "libros/a.md": "---\nestado: Leído\npaginas: 300\nfin: 2026-10-02\n---\n\n# El primero\n",
      "libros/b.md": "---\nestado: Leído\npaginas: 120\nfin: 2026-10-20\n---\n\n# El segundo\n",
      "libros/c.md": "---\nestado: Pendiente\npaginas: 80\nfin: 2026-11-01\n---\n\n# El tercero\n",
    },
  );
  const typeOf = (key: string) => {
    const t = Object.values(store.schema().types).find((x) => x.key === key);
    if (!t) throw new Error(`no ${key}`);
    return t;
  };
  store.setAiAccess(typeOf("privado").id, "restricted", "portatil");
  store.setAiAccess(typeOf("opaca").id, "opaque", "portatil");
  const rowOf = (key: string) => store.list(typeOf(key).id)[0]?.entity.id ?? "";
  // A proposal from a mail, waiting at the top of the Bandeja: its title came from outside.
  const proposal = host.agent(1).propose({
    tool: "entities.create",
    args: {
      type: leaf("tarea", codeLabel("plan")),
      values: rec({ title: leaf("Revisar las actas", mail) }, mail),
    },
    origin: "test",
  });
  // One into a collection closed to the models, whose values a flow wrote (Juan's own words).
  const closed = host.agent(1).propose({
    tool: "entities.create",
    args: {
      type: leaf("privado", codeLabel("plan")),
      values: rec({ title: leaf("Lo que no ve nadie", codeLabel("flow")) }, codeLabel("flow")),
    },
    origin: "test",
  });
  return { host, store, typeOf, rowOf, proposal, closed };
}

describe("the screen as data (F9, task 85)", () => {
  it("takes only references, bounded; anything else is refused", () => {
    expect(screenRefs({ open: { kind: "collection", id: "t_x" } })).toEqual({
      open: { kind: "collection", id: "t_x" },
      inbox: [],
      chosen: [],
    });
    expect(screenRefs({ open: { kind: "otra" } })).toBeNull();
    expect(screenRefs({ inbox: [{ kind: "proposal", id: 3 }] })).toBeNull();
    expect(screenRefs({ chosen: ["x".repeat(81)] })).toBeNull();
    expect(screenRefs("pantalla")).toBeNull();
    const many = screenRefs({ chosen: Array.from({ length: 80 }, (_, i) => `e${i}`) });
    expect(many?.chosen).toHaveLength(50);
  });

  it("is made of what the store holds, through the models' view: rows by reference, nothing closed or opaque, a card as `inbox.pending` gives it", () => {
    const { store, typeOf, rowOf, proposal, closed } = setUp();
    const screen = screenOf(store, {
      open: { kind: "collection", id: typeOf("tarea").id },
      inbox: [
        { kind: "proposal", id: proposal },
        { kind: "proposal", id: closed },
      ],
      chosen: [rowOf("tarea"), rowOf("privado"), rowOf("opaca")],
    });
    if (screen?.t !== "rec") throw new Error("no screen");
    expect(plain(screen.fields.open as Val)).toEqual({
      kind: "collection",
      collection: "tarea",
      name: "Tarea",
    });
    // Only the open collection's row, by reference: the restricted one and the opaque one are not there.
    const chosen = plain(screen.fields.chosen as Val) as { id: string; type: string }[];
    expect(chosen).toEqual([expect.objectContaining({ id: rowOf("tarea"), type: "tarea" })]);
    expect(Object.keys(chosen[0] ?? {}).sort()).toEqual(["id", "title", "type"]);
    // The card: its title from outside, its collection; never what it would write. The closed one is not there.
    const inbox = screen.fields.inbox as Val;
    if (inbox.t !== "list" || inbox.items[0]?.t !== "rec") throw new Error("no cards");
    expect(inbox.items).toHaveLength(1);
    const card = inbox.items[0];
    expect(plain(card.fields.collection as Val)).toBe("tarea");
    expect(deepLabel(card.fields.title as Val).integrity).toBe("external");
    expect(card.fields.args).toBeUndefined();
    expect(JSON.stringify(plain(screen))).not.toContain("Lo que no ve nadie");
    // A collection closed to the models says only that something is open.
    const shut = screenOf(store, {
      open: { kind: "collection", id: typeOf("privado").id },
      inbox: [],
      chosen: [],
    });
    expect(plain(shut as Val)).toEqual({ open: { kind: "collection" } });
  });

  it("«¿qué me pide el de arriba?»: the planner sees the first card as a handle, and its plan answers with it", async () => {
    const planner = new ScriptedProvider("planner", () => ({
      version: 1,
      steps: [
        {
          id: "r",
          op: "reply",
          component: "text",
          data: {
            template: lit("Te pide: {a}"),
            a: { ref: "$screen.inbox[0].title" },
          },
        },
      ],
    }));
    const { host, proposal } = setUp(planner);
    const r = await host.agent(1).turn({
      text: "¿qué me pide el de arriba?",
      origin: { kind: "turn", trust: "personal", device: "portatil" },
      screen: screenOf(host.store(1), {
        open: { kind: "inbox", id: null },
        inbox: [{ kind: "proposal", id: proposal }],
        chosen: [],
      }) as Val,
    });
    expect(r.status).toBe("done");
    expect(JSON.stringify(r.replies)).toContain("Revisar las actas");
    // The planner got the card by its handle: never the mail's words themselves.
    const input = JSON.stringify(planner.requests[0]?.input);
    expect(input).toContain('"$handle":"$screen.inbox[0].title","integrity":"external"');
    expect(input).not.toContain("Revisar las actas");
  });

  it("what is pointed at comes as typed references, bounded; anything else is refused", () => {
    const refs = screenRefs({
      pointed: [
        { kind: "block", page: "p1", block: "b1", title: "Lo que diga la app" },
        { kind: "row", id: "e1" },
        { kind: "proposal", id: "pr1" },
        { kind: "question", id: "q1" },
      ],
    });
    expect(refs?.pointed).toEqual([
      { kind: "block", page: "p1", block: "b1" },
      { kind: "row", id: "e1" },
      { kind: "proposal", id: "pr1" },
      { kind: "question", id: "q1" },
    ]);
    expect(screenRefs({ pointed: [{ kind: "block", page: 1, block: "b1" }] })).toBeNull();
    expect(screenRefs({ pointed: [{ kind: "node", id: "n1" }] })).toBeNull();
    expect(screenRefs({ pointed: [{ page: "p1", block: "b1" }] })).toBeNull();
    expect(screenRefs({ pointed: ["e1"] })).toBeNull();
    const many = screenRefs({
      pointed: Array.from({ length: 40 }, (_, i) => ({ kind: "row", id: `e${i}` })),
    });
    expect(many?.pointed).toHaveLength(MAX_POINTED);
    // Nothing pointed at: no list at all.
    expect(screenRefs({ pointed: [] })).toEqual({ open: null, inbox: [], chosen: [] });
  });

  it("a block pointed at is what the store holds of it: what it is, what it counts and its numbers, never what the app says", () => {
    const { store, typeOf } = setUp();
    const libro = typeOf("libro");
    const field = (key: string) => {
      const f = libro.fields.find((x) => x.key === key);
      if (!f) throw new Error(`no ${key}`);
      return f;
    };
    const read = field("estado").options?.find((x) => x.name === "Leído");
    const page = createPage(store, {
      title: "Lecturas",
      spec: {
        version: 1,
        blocks: [
          {
            id: "pages",
            type: "number",
            collection: libro.id,
            title: "Páginas leídas",
            measure: "sum",
            field: field("paginas").id,
            filterField: field("estado").id,
            filterValue: read?.id,
            period: "all",
          },
          {
            id: "by",
            type: "bars",
            collection: libro.id,
            title: "Por estado",
            measure: "count",
            groupBy: field("estado").id,
            period: "all",
          },
          {
            id: "table",
            type: "database",
            source: libro.id,
            view: { layout: "board", group: field("estado").id },
          },
          { id: "words", type: "text", text: "Lo que quiero leer este año" },
          { id: "go", type: "action", screen: "capture-expense", label: "Apuntar" },
          { id: "line", type: "divider" },
        ],
      },
    });
    const point = (...blocks: string[]) =>
      screenRefs({
        pointed: blocks.map((block) => ({
          kind: "block",
          page: page.id,
          block,
          title: "Forged",
          collection: "privado",
        })),
      });
    const screen = screenOf(store, point("pages", "by", "table", "words", "go") as never, {
      mailAccount: null,
      today: "2026-11-10",
    });
    const pointed = (plain(screen as Val) as { pointed: Record<string, unknown>[] }).pointed;
    expect(pointed[0]).toEqual({
      kind: "number",
      page: page.id,
      block: "pages",
      title: "Páginas leídas",
      collection: "libro",
      measure: "sum",
      field: "paginas",
      period: "all",
      date: "fin",
      filter: { field: "estado", equals: "Leído" },
      unit: "",
      // What the block says under its name, as Juan reads it.
      span: "ene 2000 - nov 2026 - hasta hoy",
      total: 420,
    });
    expect(pointed[1]).toMatchObject({
      kind: "bars",
      title: "Por estado",
      collection: "libro",
      measure: "count",
      group: "estado",
      labels: ["Leído", "Pendiente"],
      values: [2, 1],
      total: 3,
    });
    expect(pointed[2]).toEqual({
      kind: "view",
      page: page.id,
      block: "table",
      collection: "libro",
      name: "Libros",
      view: { layout: "board", group: "estado" },
    });
    expect(pointed[3]).toEqual({
      kind: "text",
      page: page.id,
      block: "words",
      text: "Lo que quiero leer este año",
    });
    expect(pointed[4]).toEqual({ kind: "button", page: page.id, block: "go", title: "Apuntar" });
    expect(JSON.stringify(pointed)).not.toContain("Forged");
    // A line says only that it is one; a block or a page that is not there, that it is gone.
    const none = screenOf(store, {
      open: null,
      inbox: [],
      chosen: [],
      pointed: [
        { kind: "block", page: page.id, block: "line" },
        { kind: "block", page: page.id, block: "missing" },
        { kind: "block", page: "e_nada", block: "pages" },
      ],
    });
    expect(plain(none as Val)).toEqual({
      pointed: [{ kind: "line", page: page.id, block: "line" }, { kind: "gone" }, { kind: "gone" }],
    });
  });

  it("nothing closed or opaque to the models is pointed at: a block, a row or a card of it says only «closed», and what is no longer there, «gone»", () => {
    const { store, typeOf, rowOf, proposal, closed } = setUp();
    const number = (id: string, key: string) => ({
      id,
      type: "number" as const,
      collection: typeOf(key).id,
      title: `Cuenta de ${key}`,
      measure: "count" as const,
      period: "all" as const,
    });
    const page = createPage(store, {
      title: "Resumen",
      spec: {
        version: 1,
        blocks: [number("open", "tarea"), number("shut", "privado"), number("dim", "opaca")],
      },
    });
    const screen = screenOf(store, {
      open: null,
      inbox: [],
      chosen: [],
      pointed: [
        { kind: "block", page: page.id, block: "open" },
        { kind: "block", page: page.id, block: "shut" },
        { kind: "block", page: page.id, block: "dim" },
        { kind: "row", id: rowOf("tarea") },
        { kind: "row", id: rowOf("privado") },
        { kind: "row", id: rowOf("opaca") },
        { kind: "proposal", id: proposal },
        { kind: "proposal", id: closed },
        { kind: "question", id: "q_nada" },
        { kind: "row", id: "e_nada" },
        { kind: "proposal", id: "p_nada" },
      ],
    });
    if (screen?.t !== "rec" || screen.fields.pointed?.t !== "list") throw new Error("no screen");
    const items = screen.fields.pointed.items;
    const said = plain(screen.fields.pointed) as Record<string, unknown>[];
    expect(said.map((x) => x.kind)).toEqual([
      "number",
      "closed",
      "closed",
      "row",
      "closed",
      "closed",
      "proposal",
      "closed",
      "gone",
      "gone",
      "gone",
    ]);
    expect(said[0]).toMatchObject({ collection: "tarea", total: 1 });
    // A row, by reference: the planner reads the rest with its tools, and an «open» reply may name it whole.
    expect(said[3]).toEqual({
      kind: "row",
      id: rowOf("tarea"),
      type: "tarea",
      title: "uno",
    });
    // The card as `inbox.pending` gives it: its title from outside, never what it would write.
    const card = items[6];
    if (card?.t !== "rec") throw new Error("no card");
    expect(deepLabel(card.fields.title as Val).integrity).toBe("external");
    expect(card.fields.args).toBeUndefined();
    const all = JSON.stringify(said);
    expect(all).not.toContain("Lo que no ve nadie");
    expect(all).not.toContain("Lo que solo el código ve");
    expect(all).not.toContain("privado");
    expect(all).not.toContain("opaca");
    // A row sent to the trash and a card decided since they were pointed at are gone, not closed.
    const row = rowOf("tarea");
    store.remove(row, { actor: "user" });
    host?.agent(1).rejectProposal(proposal);
    const later = screenOf(store, {
      open: null,
      inbox: [],
      chosen: [],
      pointed: [
        { kind: "row", id: row },
        { kind: "proposal", id: proposal },
      ],
    });
    expect(plain(later as Val)).toEqual({ pointed: [{ kind: "gone" }, { kind: "gone" }] });
  });

  it("a block's numbers count only the rows the models may read, and carry the label of what they read", () => {
    const { store, typeOf } = setUp();
    const libro = typeOf("libro");
    const estado = libro.fields.find((x) => x.key === "estado");
    const pending = estado?.options?.find((x) => x.name === "Pendiente");
    const page = createPage(store, {
      title: "Lecturas",
      spec: {
        version: 1,
        blocks: [
          {
            id: "by",
            type: "bars",
            collection: libro.id,
            measure: "count",
            groupBy: estado?.id,
            period: "all",
          },
        ],
      },
    });
    const refs = {
      open: null,
      inbox: [],
      chosen: [],
      pointed: [{ kind: "block" as const, page: page.id, block: "by" }],
    };
    const before = screenOf(store, refs);
    if (before?.t !== "rec" || before.fields.pointed?.t !== "list") throw new Error("no screen");
    const block = before.fields.pointed.items[0];
    if (block?.t !== "rec") throw new Error("no block");
    // What Juan's notes said (imported): the planner may read it. Nothing is left out: nothing says so.
    expect(deepLabel(block.fields.values as Val).integrity).toBe("imported");
    expect(deepLabel(block.fields.values as Val).noModel).toBeUndefined();
    expect(block.fields.partial).toBeUndefined();
    // Juan closes a part of the collection to the models (a rule): its rows are not counted here.
    store.setAiRule(
      {
        type: libro.id,
        level: "restricted",
        filter: [{ field: estado?.id ?? "", op: "is", value: pending?.id ?? "" }],
      },
      "portatil",
    );
    const after = plain(screenOf(store, refs) as Val) as { pointed: Record<string, unknown>[] };
    // Its numbers are no longer the ones on Juan's screen (3 books): it says so, never how many nor which.
    expect(after.pointed[0]).toMatchObject({
      labels: ["Leído"],
      values: [2],
      total: 2,
      partial: true,
    });
    // A rule that closes rows the block does not count changes nothing of it: nothing to say.
    const page2 = createPage(store, {
      title: "Leídos",
      spec: {
        version: 1,
        blocks: [
          {
            id: "read",
            type: "number",
            collection: libro.id,
            measure: "count",
            filterField: estado?.id,
            filterValue: estado?.options?.find((x) => x.name === "Leído")?.id,
            period: "all",
          },
        ],
      },
    });
    const only = plain(
      screenOf(store, {
        open: null,
        inbox: [],
        chosen: [],
        pointed: [{ kind: "block", page: page2.id, block: "read" }],
      }) as Val,
    ) as { pointed: Record<string, unknown>[] };
    expect(only.pointed[0]).toMatchObject({ kind: "number", total: 2 });
    expect(only.pointed[0]).not.toHaveProperty("partial");
  });

  it("«¿cuánto suma esto?»: the planner reads the block pointed at, and its plan answers with its number", async () => {
    const planner = new ScriptedProvider("planner", () => ({
      version: 1,
      steps: [
        {
          id: "r",
          op: "reply",
          component: "number",
          data: {
            value: { ref: "$screen.pointed[0].total" },
            caption: { ref: "$screen.pointed[0].title" },
          },
        },
      ],
    }));
    const { host, typeOf } = setUp(planner);
    const store = host.store(1);
    const page = createPage(store, {
      title: "Resumen",
      spec: {
        version: 1,
        blocks: [
          {
            id: "n",
            type: "number",
            collection: typeOf("libro").id,
            title: "Libros",
            measure: "count",
            period: "all",
          },
        ],
      },
    });
    const r = await host.agent(1).turn({
      text: "¿cuánto suma esto?",
      origin: { kind: "turn", trust: "personal", device: "portatil" },
      screen: screenOf(store, {
        open: { kind: "page", id: page.id },
        inbox: [],
        chosen: [],
        pointed: [{ kind: "block", page: page.id, block: "n" }],
      }) as Val,
    });
    expect(r.status).toBe("done");
    expect(JSON.stringify(r.replies)).toContain('"value":3');
    const input = JSON.stringify(planner.requests[0]?.input);
    expect(input).toContain('"kind":"number"');
    expect(input).toContain('"total":3');
  });

  it("many blocks over a collection of thousands of rows read it once (A-15)", () => {
    const store = openUserStore(":memory:");
    ensureSystemTypes(store);
    try {
      // The collection as an import leaves it (its list, its number, its day), then 3,000 rows at once.
      seed(
        store,
        [
          {
            key: "agenda",
            name: "Agenda",
            folder: "agenda/",
            fields: {
              estado: { type: "select", options: ["Hecha", "Pendiente"] },
              horas: "number",
              dia: "date",
            },
          },
        ],
        {
          "agenda/a.md": "---\nestado: Hecha\nhoras: 1\ndia: 2026-01-01\n---\n\n# Tarea a\n",
          "agenda/b.md": "---\nestado: Pendiente\nhoras: 2\ndia: 2026-01-02\n---\n\n# Tarea b\n",
        },
      );
      const def = Object.values(store.schema().types).find((x) => x.key === "agenda");
      if (!def) throw new Error("no agenda");
      const f = (key: string) => def.fields.find((x) => x.key === key)?.id ?? "";
      const option = (name: string) =>
        def.fields.find((x) => x.key === "estado")?.options?.find((x) => x.name === name)?.id ?? "";
      const own = label("imported", "personal", [{ kind: "vault", id: "seed" }]);
      store.batch(() => {
        for (let i = 0; i < 3000; i++) {
          const day = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
          store.create(
            def.id,
            {
              [def.titleField]: { value: `Tarea ${i}`, label: own },
              [f("estado")]: { value: option(i % 3 ? "Hecha" : "Pendiente"), label: own },
              [f("horas")]: { value: (i % 7) + 1, label: own },
              [f("dia")]: { value: day, label: own },
            },
            { actor: "user" },
          );
        }
      });
      const page = createPage(store, {
        title: "Agenda en cifras",
        spec: {
          version: 1,
          blocks: Array.from({ length: MAX_POINTED }, (_, i) => ({
            id: `b${i}`,
            type: i % 2 ? ("graph" as const) : ("bars" as const),
            collection: def.id,
            ...(i % 2
              ? { groupBy: "@month", date: f("dia"), shape: "bar" as const }
              : { groupBy: f("estado") }),
            measure: "sum" as const,
            field: f("horas"),
            period: "all" as const,
          })),
        },
      });
      const refs = screenRefs({
        pointed: Array.from({ length: MAX_POINTED }, (_, i) => ({
          kind: "block",
          page: page.id,
          block: `b${i}`,
        })),
      });
      const lists: string[] = [];
      const list = store.list.bind(store);
      store.list = ((type: string, o?: { deep?: boolean }) => {
        lists.push(type);
        return list(type, o);
      }) as typeof store.list;
      const t0 = performance.now();
      const screen = plain(
        screenOf(store, refs as never, { mailAccount: null, today: "2026-11-10" }) as Val,
      );
      const ms = performance.now() - t0;
      const pointed = (screen as { pointed: { kind: string; total: number }[] }).pointed;
      expect(pointed).toHaveLength(MAX_POINTED);
      expect(pointed.every((x) => x.kind !== "closed" && x.total > 0)).toBe(true);
      // Its rows are read once for the twenty blocks, never once per block.
      expect(lists.filter((x) => x === def.id)).toHaveLength(1);
      // Twenty charts over 3,000 rows, well under a second on any machine (a turn takes seconds).
      expect(ms).toBeLessThan(1500);
    } finally {
      store.close();
    }
  }, 20_000);

  it("without a screen there is no `$screen` for a plan to name", async () => {
    const planner = new ScriptedProvider("planner", () => ({
      version: 1,
      steps: [
        {
          id: "r",
          op: "reply",
          component: "text",
          data: { template: lit("{a}"), a: { ref: "$screen.open.kind" } },
        },
      ],
    }));
    const { host } = setUp(planner);
    const r = await host.agent(1).turn({
      text: "¿qué tengo abierto?",
      origin: { kind: "turn", trust: "personal", device: "portatil" },
    });
    expect(r.error).toBe("plan-invalid");
    expect(JSON.stringify(planner.requests[0]?.input)).not.toContain('"screen"');
  });
});

describe("a chart of the first pages pointed at (F9, task 85)", () => {
  const NOW = Date.UTC(2026, 9, 19, 10, 0);
  /** Invented money, shaped as Boni keeps Juan's: movements with their category as a row of Categorías. */
  function money() {
    const store = openUserStore(":memory:");
    ensureSystemTypes(store);
    const notes: Record<string, string> = {
      "registros/finanzas/categorias/comida.md": "---\nnombre: comida\n---\n\n# comida\n",
      "registros/finanzas/categorias/ocio.md": "---\nnombre: ocio\n---\n\n# ocio\n",
    };
    const rows = [
      ["2026-10-02-mercado", "2026-10-02", -40, "comida", "Mercado"],
      ["2026-10-05-cine", "2026-10-05", -12.5, "ocio", "Cine"],
      ["2026-10-11-cena", "2026-10-11", -30, "comida", "Bar"],
    ] as const;
    for (const [name, date, amount, category, merchant] of rows)
      notes[`registros/finanzas/movimientos/2026/10/${name}.md`] =
        `---\ntype: movement\ndate: ${date}\namount: ${amount}\ncategory: ${category}\nmerchant: "${merchant}"\nstatus: conciliado\nsource: manual\n---\n`;
    seed(
      store,
      [
        { key: "categoria", name: "Categorías", folder: "registros/finanzas/categorias/" },
        {
          key: "movimiento",
          name: "Movimiento",
          folder: "registros/finanzas/movimientos/",
          fields: { date: "date", category: { type: "relation", to: "categoria" } },
        },
      ],
      notes,
    );
    const svc = new V1Service({
      store: new V1Store(openDb(":memory:")),
      tz: "Europe/Madrid",
      writable: false,
      now: () => NOW,
      moneyOf: () => new StoreMoney(store),
    });
    const chart = (id: string): SavedChart | null => {
      const spec = svc.savedChart(1, id);
      return spec
        ? { spec, collection: "t_movimiento", over: (m) => svc.computeOver(m, spec) }
        : null;
    };
    const page = createPage(store, {
      title: "Gastos",
      spec: {
        version: 1,
        blocks: [
          { id: "b3", type: "chart", chart: "spending-by-category" },
          { id: "b5", type: "chart", chart: "eating-out" },
        ],
      },
    });
    const pointed = (block = "b3") =>
      (
        plain(
          screenOf(
            store,
            {
              open: { kind: "page", id: page.id },
              inbox: [],
              chosen: [],
              pointed: [{ kind: "block", page: page.id, block }],
            },
            { mailAccount: null, today: "2026-10-19", chart },
          ) as Val,
        ) as { pointed: Record<string, unknown>[] }
      ).pointed[0];
    return { store, svc, pointed, page };
  }

  it("is the chart Juan sees: its name, what it counts and the same numbers", () => {
    const { store, svc, pointed, page } = money();
    try {
      const mine = svc.chartData({ account: 1, device: "portatil" }, "spending-by-category", null);
      const got = pointed();
      expect(got).toMatchObject({
        kind: "chart",
        page: page.id,
        block: "b3",
        title: "Gasto del mes",
        // The collection it counts, by the key the tools take.
        collection: "movimiento",
        period: "this_month",
        group: "group",
        unit: mine.unit,
        total: mine.total,
        labels: mine.series[0]?.points.map((x) => x.label),
        values: mine.series[0]?.points.map((x) => x.value),
      });
      expect(got?.total).toBe(82.5);
      expect(got).not.toHaveProperty("partial");
      // A chart with a filter says what it names, while nothing of the money is kept from the models.
      expect(pointed("b5")).toMatchObject({
        title: "Comida fuera",
        period: "last_months",
        months: 12,
        filter: [
          { field: "category", op: "prefix", values: ["comida/", "bebida/cafe", "bebida/alcohol"] },
          { field: "category", op: "not_prefix", values: ["comida/supermercado"] },
        ],
      });
    } finally {
      store.close();
    }
  });

  it("counts only what the models may read, and is not there when its collection is closed to them", () => {
    const { store, pointed } = money();
    try {
      const def = store.schema().types.t_movimiento;
      const merchant = def?.fields.find((f) => f.name === "merchant");
      // A part of the movements closed by a rule: its rows are not in the numbers.
      const rule = store.setAiRule(
        {
          type: "t_movimiento",
          level: "restricted",
          filter: [{ field: merchant?.id ?? "", op: "is", value: "Cine" }],
        },
        "portatil",
      );
      // Other numbers than the ones on Juan's screen (82.5): it says so; and its filter no longer says what it
      // names, which may be a row kept from the models.
      expect(pointed()).toMatchObject({ kind: "chart", total: 70, partial: true });
      expect(pointed("b5")).toMatchObject({
        filter: [
          { field: "category", op: "prefix" },
          { field: "category", op: "not_prefix" },
        ],
      });
      expect(JSON.stringify(pointed("b5"))).not.toContain("supermercado");
      store.removeAiRule(rule, "portatil");
      expect(pointed()).not.toHaveProperty("partial");
      // Opaque: only code computes with it; nothing of it is on the screen.
      store.setAiAccess("t_movimiento", "opaque", "portatil");
      expect(pointed()).toEqual({ kind: "closed" });
      store.setAiAccess("t_movimiento", "restricted", "portatil");
      expect(pointed()).toEqual({ kind: "closed" });
    } finally {
      store.close();
    }
  });

  it("a chart that is no more says only that", () => {
    const { store, page } = money();
    try {
      const gone = screenOf(
        store,
        {
          open: null,
          inbox: [],
          chosen: [],
          pointed: [{ kind: "block", page: page.id, block: "b3" }],
        },
        { mailAccount: null, chart: () => null },
      );
      expect(plain(gone as Val)).toEqual({ pointed: [{ kind: "gone" }] });
    } finally {
      store.close();
    }
  });
});
