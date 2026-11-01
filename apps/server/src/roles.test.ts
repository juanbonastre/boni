// The roles each collection gets from its calendar's definition and from the money's movements (docs/clases.md §6).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interfacesOf, rolesOf } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { taskDoneField } from "./calendarStore.ts";
import { applyRoles, rolesLines, rolesToSet, undoRoles } from "./roles.ts";
import { seed } from "./seed.test-util.ts";

/** Invented: one calendar, as its definition had it, and the money's movements. */
const AGENDA = {
  id: "agenda",
  name: "Agenda",
  folder: "agenda",
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Hora", type: "time" },
    { id: "completed", name: "Hecha", type: "checkbox" },
  ],
  mapping: {
    title: "title",
    when: { kind: "split", date: "date", startTime: "startTime" },
    task: { column: "completed" },
  },
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function env(): UserStore {
  const dir = mkdtempSync(join(tmpdir(), "boni-roles-"));
  const store = openUserStore(join(dir, "user.db"));
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  seed(
    store,
    [
      { key: "agenda", name: "Agenda", folder: "agenda/", calendar: AGENDA },
      {
        key: "movimiento",
        name: "Movimientos",
        folder: "finanzas/",
        fields: {
          date: "date",
          amount: "number",
          category: { type: "select", options: ["comida", "ocio"] },
        },
      },
      { key: "libro", name: "Libros", folder: "libros/" },
    ],
    {
      "agenda/2026-10-22 Clase.md":
        '---\ntitle: "Clase"\ndate: "2026-10-22"\nstartTime: "10:00"\ncompleted: false\n---\n',
      "finanzas/m1.md": "---\ndate: 2026-10-20\namount: -12.5\ncategory: comida\n---\n",
      "libros/l1.md": "---\nautor: Ejemplo\n---\n",
    },
  );
  return store;
}

describe("the roles each collection already has, said where they belong (docs/clases.md §6)", () => {
  it("come from its calendar and from the money, apply in one run, and are undone whole", () => {
    const store = env();
    const { found, problems } = rolesToSet(store);
    expect(problems).toEqual([]);
    expect(rolesLines(store, found)).toEqual([
      "Agenda: día → Fecha, hora → Hora, hecha → Hecha (de su calendario «Agenda»)",
      "Movimientos: importe → amount, día → date, categoría → category (del código del dinero)",
    ]);
    const run = applyRoles(store, found, "prueba");
    expect(run).not.toBeNull();
    const schema = store.schema();
    expect(interfacesOf(rolesOf(schema, "t_agenda"))).toEqual(["dated", "doable"]);
    expect(interfacesOf(rolesOf(schema, "t_movimiento"))).toEqual(["dated", "money"]);
    expect(rolesOf(schema, "t_libro")).toEqual({});
    // Nothing is left to set, and the task's box comes from the role.
    expect(rolesToSet(store).found).toEqual([]);
    expect(taskDoneField(store, "t_agenda")?.name).toBe("Hecha");
    expect(undoRoles(store, run as string)).toBe(2);
    expect(rolesOf(store.schema(), "t_agenda")).toEqual({});
  });
});
