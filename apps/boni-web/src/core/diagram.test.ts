/** (test) «Mis datos» as a diagram, computed from an invented schema (task 59a, D-40). */
import { describe, expect, it } from "vitest";
import type { DataType } from "./agent.ts";
import { cardOf, diagramOf, frameOf, layoutOf } from "./diagram.ts";

const rowUi = { open: false, hidden: [], related: false, folded: [], widths: {} };
const type = (t: Partial<DataType> & { id: string; name: string }): DataType => ({
  icon: "",
  titleField: "f_title",
  fields: [],
  count: 0,
  level: "visible",
  rules: [],
  rowUi,
  ...t,
});
const text = (id: string, name: string) => ({ id, name, type: "text" });
const TYPES: DataType[] = [
  type({ id: "t_area", name: "Área", count: 9, fields: [text("f_t", "Nombre")] }),
  type({
    id: "t_proyecto",
    name: "Proyecto",
    count: 81,
    fields: [
      text("f_t", "Título"),
      { id: "f_area", name: "Área", type: "relation", relation: { target: "t_area", many: false } },
    ],
  }),
  type({
    id: "t_agenda",
    name: "Agenda",
    fields: [
      text("f_t", "Título"),
      { id: "f_area", name: "Área", type: "relation", relation: { target: "t_area", many: false } },
    ],
  }),
  type({
    id: "t_tarea",
    name: "Tarea",
    parent: "t_agenda",
    count: 1722,
    level: "opaque",
    fields: [
      { ...text("f_t", "Título"), inherited: true },
      {
        id: "f_area",
        name: "Área",
        type: "relation",
        relation: { target: "t_area", many: false },
        inherited: true,
      },
      { id: "f_hecha", name: "Hecha", type: "checkbox" },
      {
        id: "f_proy",
        name: "Proyecto",
        type: "relation",
        relation: { target: "t_proyecto", many: false },
      },
    ],
  }),
  type({
    id: "t_evento",
    name: "Evento",
    parent: "t_agenda",
    count: 1125,
    fields: [{ id: "f_dia", name: "Día", type: "date" }],
  }),
  type({
    id: "t_correo",
    name: "Correos",
    readOnly: true,
    level: "private",
    fields: [
      text("f_asunto", "Asunto"),
      {
        id: "f_adj",
        name: "Adjuntos",
        type: "relation",
        relation: { target: "t_archivo", many: true },
      },
      { id: "f_otro", name: "Otro", type: "relation", relation: { target: "t_fuera", many: true } },
    ],
  }),
  type({ id: "t_archivo", name: "Archivos", count: 385 }),
  type({
    id: "t_calls",
    name: "Llamadas a modelos",
    system: true,
    fields: [text("f_t", "Modelo")],
  }),
];

describe("the diagram of the collections (task 59a)", () => {
  const d = diagramOf(TYPES);
  it("a card per collection with its own fields, a frame per mother, Boni's own records out", () => {
    expect(d.cards.map((c) => c.type)).toEqual([
      "t_area",
      "t_proyecto",
      "t_agenda",
      "t_tarea",
      "t_evento",
      "t_correo",
      "t_archivo",
    ]);
    expect(d.frames).toEqual([
      {
        id: frameOf("t_agenda"),
        type: "t_agenda",
        name: "Agenda",
        icon: "",
        level: "visible",
        frame: null,
      },
    ]);
    const tarea = d.cards.find((c) => c.type === "t_tarea");
    // The mother's fields are hers; the daughter's card lists only its own, inside her frame.
    expect(tarea?.fields.map((f) => f.name)).toEqual(["Hecha", "Proyecto"]);
    expect(tarea).toMatchObject({ frame: frameOf("t_agenda"), level: "opaque", count: 1722 });
    expect(d.cards.find((c) => c.type === "t_agenda")?.frame).toBe(frameOf("t_agenda"));
    expect(d.cards.find((c) => c.type === "t_area")?.frame).toBeNull();
    expect(d.cards.find((c) => c.type === "t_correo")?.readOnly).toBe(true);
  });
  it("an arrow per relation field, from the card that has it (never twice for an inherited one), to collections that exist", () => {
    expect(d.edges).toEqual([
      {
        id: "t_proyecto:f_area",
        from: cardOf("t_proyecto"),
        to: cardOf("t_area"),
        name: "Área",
        many: false,
      },
      {
        id: "t_agenda:f_area",
        from: cardOf("t_agenda"),
        to: cardOf("t_area"),
        name: "Área",
        many: false,
      },
      {
        id: "t_tarea:f_proy",
        from: cardOf("t_tarea"),
        to: cardOf("t_proyecto"),
        name: "Proyecto",
        many: false,
      },
      {
        id: "t_correo:f_adj",
        from: cardOf("t_correo"),
        to: cardOf("t_archivo"),
        name: "Adjuntos",
        many: true,
      },
    ]);
  });
  it("laid out: every card placed, no two overlapping, each frame around what it holds", () => {
    const l = layoutOf(d);
    expect(l.cards.map((c) => c.id).sort()).toEqual(d.cards.map((c) => c.id).sort());
    for (const a of l.cards)
      for (const b of l.cards)
        if (a !== b)
          expect(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y,
          ).toBe(true);
    const agenda = l.frames.find((f) => f.id === frameOf("t_agenda"));
    if (!agenda) throw new Error("no frame");
    for (const id of ["t_agenda", "t_tarea", "t_evento"].map(cardOf)) {
      const c = l.cards.find((x) => x.id === id);
      if (!c) throw new Error(id);
      expect(c.x).toBeGreaterThanOrEqual(agenda.x);
      expect(c.y).toBeGreaterThan(agenda.y + 20); // room for the frame's name
      expect(c.x + c.width).toBeLessThanOrEqual(agenda.x + agenda.width);
      expect(c.y + c.height).toBeLessThanOrEqual(agenda.y + agenda.height);
    }
    const area = l.cards.find((x) => x.id === cardOf("t_area"));
    expect(
      area &&
        (area.x >= agenda.x + agenda.width ||
          area.x + area.width <= agenda.x ||
          area.y >= agenda.y + agenda.height ||
          area.y + area.height <= agenda.y),
    ).toBe(true);
    // The same schema always gives the same picture.
    expect(layoutOf(d)).toEqual(l);
  });
});
