/**
 * (test) Where the boxes of Boni's flow pictures go (docs/sistema.md §4.4): a flow downwards in its run's order with
 * the steps of each choice side by side, and the map with its lenses; computed, the same every time.
 */
import { describe, expect, it } from "vitest";
import {
  choiceOf,
  groupOf,
  LENS,
  lensOf,
  type MapEdgeLike,
  type MapNodeLike,
  mapLayout,
  segmentsOf,
  stepLayout,
  withTold,
} from "./flowLayout.ts";

const choice = { fn: "first", args: [{ ref: "$only" }, { ref: "$c.choice" }] };
const goesTo = (v: string) => ({ fn: "eq", args: [choice, { lit: v }] });
/** «Leer correo» as the mail reading writes it (apps/server mail.ts), with two collections to choose from. */
const mail = [
  { id: "m", op: "call", tool: "entities.get" },
  { id: "only", op: "call", tool: "mail.rule" },
  { id: "known", op: "call", tool: "mail.known" },
  { id: "inv", op: "call", tool: "mail.invitation" },
  { id: "prefill", op: "call", tool: "mail.relations" },
  { id: "r", op: "read", reader: "read_message" },
  { id: "c", op: "read", reader: "classify", when: { fn: "and", args: [{ ref: "$r.all" }] } },
  { id: "n0_tasks_f", op: "read", reader: "fill", when: goesTo("Tarea") },
  { id: "n0_tasks", op: "call", tool: "entities.create", when: goesTo("Tarea") },
  { id: "n1_tasks_f", op: "read", reader: "fill", when: goesTo("Evento") },
  { id: "n1_tasks", op: "call", tool: "entities.create", when: goesTo("Evento") },
  {
    id: "inv0",
    op: "call",
    tool: "entities.create",
    when: { fn: "and", args: [{ ref: "$inv.uid" }, goesTo("Tarea")] },
  },
  {
    id: "inv1",
    op: "call",
    tool: "entities.create",
    when: { fn: "and", args: [{ ref: "$inv.uid" }, goesTo("Evento")] },
  },
  { id: "fold", op: "call", tool: "inbox.fold" },
  { id: "alone", op: "call", tool: "inbox.accept_alone" },
];

describe("a flow's steps, downwards in the order they run", () => {
  it("knows the choice a step runs for, alone or inside an «and»", () => {
    expect(choiceOf(mail[7] as never)).toEqual({ on: JSON.stringify(choice), value: "Tarea" });
    expect(choiceOf(mail[11] as never)?.value).toBe("Tarea");
    expect(choiceOf(mail[6] as never)).toBeNull();
    expect(choiceOf(mail[0] as never)).toBeNull();
  });

  it("gathers the steps of each choice into lanes, the rest one after another", () => {
    expect(segmentsOf(mail as never)).toEqual([
      { kind: "step", id: "m" },
      { kind: "step", id: "only" },
      { kind: "step", id: "known" },
      { kind: "step", id: "inv" },
      { kind: "step", id: "prefill" },
      { kind: "step", id: "r" },
      { kind: "step", id: "c" },
      {
        kind: "lanes",
        lanes: [
          { value: "Tarea", steps: ["n0_tasks_f", "n0_tasks", "inv0"] },
          { value: "Evento", steps: ["n1_tasks_f", "n1_tasks", "inv1"] },
        ],
      },
      { kind: "step", id: "fold" },
      { kind: "step", id: "alone" },
    ]);
    // A choice with one value is a step like any other.
    expect(segmentsOf([mail[7], mail[8]] as never).map((s) => s.kind)).toEqual(["step", "step"]);
  });

  it("puts each step under the one before it, lanes side by side, and joins them in order", () => {
    const l = stepLayout(mail as never, {
      trigger: { id: "trigger", height: 60 },
      width: 200,
      height: () => 50,
    });
    const at = (id: string) => l.at.get(id) as { x: number; y: number };
    // Down in the order they run: «Aceptar solas» last, not where nothing points to it.
    const order = [
      "trigger",
      "m",
      "only",
      "known",
      "inv",
      "prefill",
      "r",
      "c",
      "n0_tasks_f",
      "fold",
      "alone",
    ];
    for (let i = 1; i < order.length; i++)
      expect(at(order[i] as string).y).toBeGreaterThan(at(order[i - 1] as string).y);
    // Lanes side by side, each down in its own order.
    expect(at("n0_tasks_f").y).toBe(at("n1_tasks_f").y);
    expect(at("n1_tasks_f").x).toBeGreaterThan(at("n0_tasks_f").x);
    expect(at("inv0").y).toBeGreaterThan(at("n0_tasks").y);
    expect(at("fold").y).toBeGreaterThan(at("inv1").y);
    expect(l.links).toContainEqual({ from: "trigger", to: "m" });
    expect(l.links).toContainEqual({ from: "c", to: "n0_tasks_f", lane: "Tarea" });
    expect(l.links).toContainEqual({ from: "c", to: "n1_tasks_f", lane: "Evento" });
    expect(l.links).toContainEqual({ from: "inv0", to: "fold" });
    expect(l.links).toContainEqual({ from: "inv1", to: "fold" });
    expect(l.width).toBe(2 * 200 + 32);
    expect(stepLayout(mail as never, { width: 200, height: () => 50 })).toEqual(
      stepLayout(mail as never, { width: 200, height: () => 50 }),
    );
  });
});

const n = (
  id: string,
  kind: MapNodeLike["kind"],
  more: Partial<MapNodeLike> = {},
): MapNodeLike => ({
  id,
  kind,
  ...more,
});
const e = (
  from: string,
  to: string,
  kind: MapEdgeLike["kind"],
  more: Partial<MapEdgeLike> = {},
): MapEdgeLike => ({
  from,
  to,
  kind,
  n: 1,
  outside: false,
  ...more,
});
/** A map like Juan's: the mail coming in, «Leer correo», his flow by hand, the conversation, a page; what is
 * proposed waits in the Bandeja, whose decisions teach the guide's reviewer. */
const map = {
  nodes: [
    n("conn:mail", "connector"),
    n("col:correo", "collection"),
    n("col:tarea", "collection", { parent: "col:trabajo" }),
    n("col:evento", "collection", { parent: "col:trabajo" }),
    n("col:libros", "collection"),
    n("flow:leer", "flow", {
      on: true,
      roles: ["reader"],
      pack: "correo",
      trigger: { created: "correo" },
    }),
    n("flow:apuntar", "flow", { on: false, roles: [], trigger: { manual: true } }),
    n("boni:chat", "boni", { roles: ["planner"] }),
    n("actor:user", "actor"),
    n("page:agenda", "page"),
    n("boni:inbox", "boni", { through: true }),
    n("boni:review", "boni", { roles: ["reviewer"], pack: "correo" }),
  ],
  edges: [
    e("conn:mail", "col:correo", "brings"),
    e("col:correo", "flow:leer", "starts"),
    e("flow:leer", "boni:inbox", "proposes", { into: ["col:tarea", "col:evento"] }),
    e("boni:chat", "boni:inbox", "proposes", { into: ["col:libros"] }),
    e("boni:inbox", "col:tarea", "accepts"),
    e("boni:inbox", "col:evento", "accepts"),
    e("boni:inbox", "col:libros", "accepts"),
    e("actor:user", "boni:inbox", "decides"),
    e("boni:inbox", "boni:review", "learns", { via: ["flow:leer"] }),
    e("boni:review", "flow:leer", "improves"),
    e("flow:apuntar", "col:tarea", "writes"),
    e("boni:chat", "col:tarea", "writes"),
    e("col:tarea", "boni:chat", "reads"),
    e("actor:user", "col:tarea", "writes"),
    e("col:tarea", "page:agenda", "shows"),
  ],
};
const ids = (x: { nodes: { id: string }[] }) => x.nodes.map((y) => y.id).sort();

describe("the map's lenses (docs/sistema.md §4.4)", () => {
  it("without a centre, everything joined to something; pages only when asked for", () => {
    expect(ids(lensOf(map, LENS))).toEqual(
      [
        "conn:mail",
        "col:correo",
        "col:tarea",
        "col:evento",
        "col:libros",
        "flow:leer",
        "flow:apuntar",
        "boni:chat",
        "boni:inbox",
        "boni:review",
        "actor:user",
      ].sort(),
    );
    expect(ids(lensOf(map, { ...LENS, pages: true }))).toContain("page:agenda");
  });

  it("«¿Quién escribe en Tarea?»: Tarea in the centre, one arrow back, the Bandeja crossed", () => {
    const v = lensOf(map, { ...LENS, center: "col:tarea", before: 1, after: 0 });
    expect(ids(v)).toEqual([
      "actor:user",
      "boni:chat",
      "boni:inbox",
      "col:tarea",
      "flow:apuntar",
      "flow:leer",
    ]);
    // Through the Bandeja only what proposes into Tarea: the conversation's proposals go to Libros.
    expect(v.edges.some((x) => x.from === "flow:leer" && x.to === "boni:inbox")).toBe(true);
    expect(v.edges.some((x) => x.from === "boni:chat" && x.to === "boni:inbox")).toBe(false);
    // «Antes: 1» of Evento (docs/sistema.md §4.4): «Leer correo (propone)», not the conversation.
    expect(ids(lensOf(map, { ...LENS, center: "col:evento", before: 1, after: 0 }))).toEqual([
      "boni:inbox",
      "col:evento",
      "flow:leer",
    ]);
  });

  it("«Ver en el mapa» on a block: its values, what it paints and who writes there (§4.6 point 7)", () => {
    const withBlocks = {
      nodes: [
        ...map.nodes,
        n("block:agenda:mes", "block", { page: "page:agenda" }),
        n("block:agenda:total", "block", { page: "page:agenda" }),
        n("block:otra:total", "block", { page: "page:otra" }),
      ],
      edges: [
        ...map.edges,
        e("block:agenda:mes", "block:agenda:total", "controls"),
        e("col:tarea", "block:agenda:total", "shows"),
        e("col:tarea", "block:otra:total", "shows"),
      ],
    };
    // No block is drawn around anything that is not one, nor another page's around one.
    expect(
      ids(lensOf(withBlocks, { ...LENS, center: "col:tarea" })).some((x) => x.startsWith("block:")),
    ).toBe(false);
    const v = lensOf(withBlocks, { ...LENS, center: "block:agenda:total", before: 1, after: 0 });
    expect(ids(v)).toEqual(
      [
        "block:agenda:mes",
        "block:agenda:total",
        "col:tarea",
        // Who writes in Tarea, one step past it: the Bandeja crossed to what proposes there.
        "actor:user",
        "boni:chat",
        "boni:inbox",
        "flow:apuntar",
        "flow:leer",
      ].sort(),
    );
    expect(v.edges.some((x) => x.kind === "controls" && x.to === "block:agenda:total")).toBe(true);
  });

  it("«¿Qué pasa cuando llega un correo?»: the connector in the centre, everything after it", () => {
    const v = lensOf(map, {
      ...LENS,
      center: "conn:mail",
      before: 0,
      after: Number.POSITIVE_INFINITY,
    });
    // To the Bandeja and on to Tarea and Evento, the reviewer its decisions teach, and what reads Tarea.
    expect(ids(v)).toEqual(
      [
        "boni:chat",
        "boni:inbox",
        "boni:review",
        "col:correo",
        "col:evento",
        "col:libros",
        "col:tarea",
        "conn:mail",
        "flow:leer",
      ].sort(),
    );
    // Two arrows after: the mail, its collection and the flow it starts, no further.
    expect(ids(lensOf(map, { ...LENS, center: "conn:mail", before: 0, after: 2 }))).toEqual(
      ["col:correo", "conn:mail", "flow:leer"].sort(),
    );
    // The conversation's proposals teach no reviewer: through the Bandeja, only to where they go.
    expect(ids(lensOf(map, { ...LENS, center: "boni:chat", before: 0, after: 3 }))).not.toContain(
      "boni:review",
    );
    expect(ids(lensOf(map, { ...LENS, center: "flow:leer", before: 0, after: 2 }))).toContain(
      "boni:review",
    );
    // What the reviewer learns from, back through the Bandeja: the reading whose proposals were decided.
    const learns = lensOf(map, { ...LENS, center: "boni:review", before: 1, after: 0 });
    expect(ids(learns)).toEqual(["boni:inbox", "boni:review", "flow:leer"]);
    expect(learns.edges.some((x) => x.from === "flow:leer" && x.to === "boni:inbox")).toBe(true);
    // Three: the Bandeja, and through it where the reading's proposals go, in the same step.
    expect(ids(lensOf(map, { ...LENS, center: "conn:mail", before: 0, after: 3 }))).toEqual(
      ["boni:inbox", "col:correo", "col:evento", "col:tarea", "conn:mail", "flow:leer"].sort(),
    );
  });

  it("only what happened in the period: an arrow with no number goes, and what it alone joined", () => {
    const quiet = {
      ...map,
      edges: map.edges.map((x) => (x.from === "actor:user" ? { ...x, n: 0 } : x)),
    };
    expect(ids(lensOf(quiet, { ...LENS, happened: true }))).not.toContain("actor:user");
    expect(ids(lensOf(quiet, { ...LENS, happened: true }))).toContain("flow:leer");
  });

  it("filters: only what is on, only with a model, only what changes data", () => {
    expect(ids(lensOf(map, { ...LENS, on: true }))).not.toContain("flow:apuntar");
    expect(ids(lensOf(map, { ...LENS, ai: true }))).not.toContain("flow:apuntar");
    expect(ids(lensOf(map, { ...LENS, ai: true }))).toContain("boni:chat");
    // The Bandeja is no work with or without a model: it stays, and the way through it.
    expect(ids(lensOf(map, { ...LENS, ai: true }))).toContain("boni:inbox");
    const w = lensOf(map, { ...LENS, writes: true });
    expect(w.edges.some((x) => x.kind === "reads")).toBe(false);
    expect(w.edges.some((x) => x.kind === "proposes")).toBe(true);
    // The centre stays even when its filters would leave it out.
    expect(ids(lensOf(map, { ...LENS, center: "page:agenda" }))).toContain("page:agenda");
  });

  it("what tells goes to the devices («avisa»): a flow that only tells is joined by that arrow, which changes no data", () => {
    // Boni's «Aviso del presupuesto» reads and writes no collection: its one arrow is what it tells.
    const told = {
      nodes: [
        ...map.nodes,
        n("flow:aviso", "flow", { on: true, roles: [], boni: true, trigger: { spending: "warn" } }),
        n("dev:all", "device"),
      ],
      edges: [
        ...map.edges,
        e("flow:aviso", "dev:all", "tells"),
        e("boni:chat", "dev:all", "tells"),
      ],
    };
    // Without a centre both are on the map: joined to something.
    expect(ids(lensOf(told, LENS))).toEqual(expect.arrayContaining(["flow:aviso", "dev:all"]));
    // The devices in the centre, one arrow back: who tells, and nothing after them.
    expect(ids(lensOf(told, { ...LENS, center: "dev:all", before: 1, after: 3 }))).toEqual(
      ["boni:chat", "dev:all", "flow:aviso"].sort(),
    );
    // Telling changes no data: «Solo lo que escribe» takes the arrow away, and the flow it alone joined.
    const w = lensOf(told, { ...LENS, writes: true });
    expect(w.edges.some((x) => x.kind === "tells")).toBe(false);
    expect(ids(w)).not.toContain("flow:aviso");
    expect(ids(w)).not.toContain("dev:all");
    // «Solo lo que ha pasado»: a flow that told nothing in the period goes with its arrow.
    const quiet = {
      ...told,
      edges: told.edges.map((x) => (x.from === "flow:aviso" ? { ...x, n: 0 } : x)),
    };
    expect(ids(lensOf(quiet, { ...LENS, happened: true }))).not.toContain("flow:aviso");
    expect(ids(lensOf(quiet, { ...LENS, happened: true }))).toContain("dev:all");
    // They are no flow and nothing of Boni's own work: no frame by what starts them, and «solo con IA» keeps them
    // only while something with a model tells them (the conversation here).
    expect(groupOf(told.nodes.at(-1) as MapNodeLike, "trigger")).toBeNull();
    expect(ids(lensOf(told, { ...LENS, ai: true }))).toContain("dev:all");
    expect(ids(lensOf(told, { ...LENS, ai: true }))).not.toContain("flow:aviso");
  });

  it("a run that told is drawn to the devices («avisa»), from the steps that told in it: the arrow and the devices are added when the period's map has neither", () => {
    const devices = n("dev:all", "device");
    const arrow = (steps: string[]) => e("flow:apuntar", "dev:all", "tells", { n: null, steps });
    // Nothing told in the period: no devices on the map. A run of «Apuntar» that told gets them and its arrow, with no
    // number (the period's notices are not this run's).
    const one = withTold(map, {
      owner: "flow:apuntar",
      steps: ["aviso"],
      devices,
      arrow: arrow(["aviso"]),
    });
    expect(one.nodes).toEqual([...map.nodes, devices]);
    expect(one.edges).toEqual([
      ...map.edges,
      {
        from: "flow:apuntar",
        to: "dev:all",
        kind: "tells",
        n: null,
        steps: ["aviso"],
        outside: false,
      },
    ]);
    // Centred on the flow, as «Recorrido» opens it: the devices are one arrow after it.
    expect(ids(lensOf(one, { ...LENS, center: "flow:apuntar" }))).toContain("dev:all");
    // The map already draws that flow's «avisa» (from today's «Avisar», with the period's number): the steps of the
    // run that told join its ends (it ran an earlier version, whose «Avisar» was another step), nothing twice.
    const has = {
      nodes: [...map.nodes, devices],
      edges: [
        ...map.edges,
        e("flow:apuntar", "dev:all", "tells", { n: 4, steps: ["notify"] }),
        e("boni:chat", "dev:all", "tells", { n: 2 }),
      ],
    };
    const two = withTold(has, {
      owner: "flow:apuntar",
      steps: ["aviso", "notify"],
      devices,
      arrow: arrow(["aviso", "notify"]),
    });
    expect(two.nodes).toEqual(has.nodes);
    expect(two.edges.filter((x) => x.kind === "tells")).toEqual([
      {
        from: "flow:apuntar",
        to: "dev:all",
        kind: "tells",
        n: 4,
        steps: ["notify", "aviso"],
        outside: false,
      },
      { from: "boni:chat", to: "dev:all", kind: "tells", n: 2, outside: false },
    ]);
    // A run that told nothing, or of something the map does not have (a flow deleted since): the map as it was.
    const same = { nodes: map.nodes, edges: map.edges };
    expect(withTold(map, { owner: "flow:apuntar", steps: [], devices, arrow: arrow([]) })).toEqual(
      same,
    );
    expect(
      withTold(map, { owner: "flow:borrado", steps: ["a"], devices, arrow: arrow(["a"]) }),
    ).toEqual(same);
  });

  it("groups by what starts a flow, by the collection a collection is in, by package", () => {
    const leer = map.nodes[5] as MapNodeLike;
    expect(groupOf(leer, "trigger")).toBe("on:created:correo");
    expect(groupOf(map.nodes[6] as MapNodeLike, "trigger")).toBe("on:manual");
    // Boni's «Traer correo» is started by the mail connector, never «by the user».
    expect(groupOf({ ...leer, trigger: { connector: "mail" } } as MapNodeLike, "trigger")).toBe(
      "on:connector:mail",
    );
    // «Revisar la guía» is started by Juan's decisions.
    expect(groupOf({ ...leer, trigger: { learning: "mail" } } as MapNodeLike, "trigger")).toBe(
      "on:learning:mail",
    );
    // «Aviso del presupuesto» is started by the month's spending.
    expect(groupOf({ ...leer, trigger: { spending: "warn" } } as MapNodeLike, "trigger")).toBe(
      "on:spending:warn",
    );
    expect(groupOf(map.nodes[7] as MapNodeLike, "trigger")).toBe("on:boni");
    expect(groupOf(map.nodes[10] as MapNodeLike, "trigger")).toBeNull();
    expect(groupOf(map.nodes[2] as MapNodeLike, "collection")).toBe("in:col:trabajo");
    expect(groupOf(map.nodes[4] as MapNodeLike, "collection")).toBeNull();
    expect(groupOf(leer, "pack")).toBe("pack:correo");
    expect(groupOf(leer, "none")).toBeNull();
    // By flow: each unfolded in its own frame, nothing else framed.
    expect(groupOf(leer, "flow")).toBeNull();
  });

  it("lays the map out left to right, a frame around each group, the same every time", () => {
    const v = lensOf(map, LENS);
    const boxes = v.nodes.map((x) => ({ id: x.id, width: 180, height: 60 }));
    const groups = new Map(
      v.nodes.flatMap((x) => {
        const g = groupOf(x, "collection");
        return g ? [[x.id, g] as [string, string]] : [];
      }),
    );
    const l = mapLayout(boxes, v.edges, groups);
    const at = (id: string) => l.at.get(id) as { x: number; y: number };
    expect(at("col:correo").x).toBeGreaterThan(at("conn:mail").x);
    expect(at("flow:leer").x).toBeGreaterThan(at("col:correo").x);
    expect(at("col:tarea").x).toBeGreaterThan(at("flow:leer").x);
    const frame = l.frames.find((f) => f.id === "in:col:trabajo");
    expect(frame).toBeTruthy();
    for (const id of ["col:tarea", "col:evento"]) {
      const p = at(id);
      expect(p.x).toBeGreaterThanOrEqual(frame?.x ?? 0);
      expect(p.y).toBeGreaterThanOrEqual(frame?.y ?? 0);
    }
    expect(mapLayout(boxes, v.edges, groups)).toEqual(l);
    // Who acts on the left: the conversation reads Tarea, and still sits before it, as what it writes.
    const acting = mapLayout(boxes, v.edges, groups, new Set(["boni:chat", "actor:user"]));
    const pos = (id: string) => acting.at.get(id) as { x: number; y: number };
    expect(pos("boni:chat").x).toBeLessThan(pos("col:tarea").x);
    expect(pos("actor:user").x).toBeLessThan(pos("col:tarea").x);
  });
});
