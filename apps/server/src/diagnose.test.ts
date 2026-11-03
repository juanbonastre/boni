// The diagnosis (task 35): it says how much there is and how long the heavy reads take, and changes nothing.
import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnose.ts";
import { seed, type TypeSpec } from "./seed.test-util.ts";

describe("diagnose (cli.ts diagnose <name>)", () => {
  it("counts and times an account's data without writing or recording anything", async () => {
    const store = openUserStore(":memory:");
    const types: TypeSpec[] = [
      { key: "area", name: "Área", folder: "areas/" },
      {
        key: "agenda",
        name: "Agenda",
        folder: "agenda/",
        fields: { area: { type: "relation", to: "area" } },
        calendar: {
          id: "agenda",
          name: "Agenda",
          folder: "agenda",
          account: "Agenda",
          color: "#60a5fa",
          columns: [
            { id: "title", name: "Título", type: "text" },
            { id: "date", name: "Fecha", type: "date" },
          ],
          mapping: { title: "title", when: { kind: "split", date: "date" } },
        },
      },
    ];
    seed(store, types, {
      "areas/docencia.md": "---\ntype: area\n---\n# Docencia\n",
      "agenda/2026-10-22 Clase.md":
        '---\ntitle: "Clase"\ndate: "2026-10-22"\narea: "[[docencia]]"\n---\n',
    });
    const before = {
      version: store.version(),
      actions: store.audit.storage().audit.actions,
      runs: store.journal.runs(1000).length,
    };
    const lines = await diagnose(store, {
      now: Date.parse("2026-11-03T12:00:00Z"),
      tz: "Europe/Madrid",
      usdToEur: 0.92,
    });
    expect(lines[0]).toMatch(/^datos: \d+ registros, \d+ MB; las colecciones con más: /);
    expect(
      lines.some((l) =>
        /^calendarios: 1; leerlos \d+ ms \(la primera vez\), \d+ ms \(de memoria\)$/.test(l),
      ),
    ).toBe(true);
    expect(lines.some((l) => l.startsWith("calendario: 1 filas; la instantánea"))).toBe(true);
    expect(lines.some((l) => l.startsWith("registros de Boni: "))).toBe(true);
    expect(lines.some((l) => l.startsWith("página «Actividad»: "))).toBe(true);
    expect(lines.some((l) => l.startsWith("Registro (las 50 últimas ejecuciones): "))).toBe(true);
    expect({
      version: store.version(),
      actions: store.audit.storage().audit.actions,
      runs: store.journal.runs(1000).length,
    }).toEqual(before);
    store.close();
  });
});
