import { describe, expect, it } from "vitest";
import {
  calendarDefs,
  daysFromCivil,
  generateCollectionSample,
  generateSample,
  makeModel,
  makeProjector,
  mappedColumns,
  projectsOf,
  validateModel,
  withSchema,
} from "./index.ts";

const opts = { anchorDay: daysFromCivil(2025, 9, 17), tz: "Europe/Madrid" };

describe("the sample as collections", () => {
  const snap = generateCollectionSample(opts);
  const old = generateSample(opts);

  it("has valid definitions", () => {
    expect(
      validateModel(snap.collections, snap.views).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });

  it("projects to exactly the events of the original sample", () => {
    const model = makeModel(snap.collections, snap.views, { defaultTz: opts.tz });
    const events = makeProjector(model).project(snap.rows);
    expect(events).toHaveLength(old.events.length);
    expect(events).toEqual(old.events);
  });

  it("keeps the calendars, accounts and projects", () => {
    expect(snap.accounts).toEqual(old.accounts);
    expect(snap.views.map((v) => [v.id, v.accountId, v.color, v.visible, !!v.readOnly])).toEqual(
      old.calendars.map((c) => [c.id, c.accountId, c.color, c.visible, !!c.readOnly]),
    );
    expect(snap.collections.find((c) => c.id === "projects")?.name).toBe("Proyectos");
    expect(
      snap.rows.filter((r) => r.collectionId === "projects").map((r) => r.values.title),
    ).toEqual(old.projects.map((p) => p.name));
  });

  it("uses both mapping forms", () => {
    const kinds = new Set(snap.views.map((v) => v.mapping.when.kind));
    expect(kinds).toEqual(new Set(["split", "range"]));
  });
});

describe("calendars as the UI sees them", () => {
  const snap = generateCollectionSample(opts);
  const old = generateSample(opts);

  it("derive the original calendar definitions (name, colour, free properties)", () => {
    const norm = (cs: { readOnly?: boolean }[]) =>
      cs.map((c) => ({ ...c, readOnly: !!c.readOnly }));
    expect(norm(calendarDefs(snap.collections, snap.views))).toEqual(norm(old.calendars));
    expect(projectsOf(snap.rows)).toEqual(old.projects);
  });

  it("replace only the free columns when the schema changes", () => {
    const teaching = snap.collections.find((c) => c.id === "teaching");
    const view = snap.views.find((v) => v.id === "teaching");
    if (!teaching || !view) throw new Error("sample changed");
    const next = withSchema(teaching, view, [{ id: "extra", name: "Extra", type: "text" }]);
    const kept = teaching.columns.filter((c) => mappedColumns(view.mapping).has(c.id));
    expect(next.columns).toEqual([...kept, { id: "extra", name: "Extra", type: "text" }]);
  });
});
