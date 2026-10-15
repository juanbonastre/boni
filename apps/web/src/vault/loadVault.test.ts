import { describe, expect, it } from "vitest";
import type { NoteStat, VaultBridge, VaultResult } from "../vaultBridge.ts";
import { parseIndex, serializeIndex } from "./index.ts";
import { loadVault } from "./loadVault.ts";

const definition = (id: string, folder: string) => `---
type: wiki
summary: Definition of ${id}.
collection:
  id: ${id}
  name: ${id}
  folder: ${folder}
  account: Agenda
  color: "#60a5fa"
  columns:
    - { id: title, name: Título, type: text }
    - { id: date, name: Fecha, type: date }
    - { id: startTime, name: Inicio, type: time }
    - { id: endTime, name: Fin, type: time }
    - { id: completed, name: Hecha, type: checkbox }
  mapping:
    title: title
    when: { kind: split, date: date, startTime: startTime, endTime: endTime }
    task: { column: completed }
---
`;

/** A vault in memory behind the same interface as the desktop bridge. */
function fakeVault(files: Record<string, string>): VaultBridge {
  const ok = <T>(value: T): VaultResult<T> => ({ ok: true, value });
  const fail = (code: string, message: string): VaultResult<never> => ({
    ok: false,
    code,
    message,
  });
  return {
    getRoot: async () => ok("/vault"),
    chooseRoot: async () => ok("/vault"),
    scan: async (dir): Promise<VaultResult<NoteStat[]>> => {
      const list = Object.keys(files).filter((p) => p.startsWith(`${dir}/`));
      return list.length || dir.startsWith("agenda")
        ? ok(list.map((path) => ({ path, mtimeMs: 1, size: 1 })))
        : fail("not-found", `No such folder: ${dir}`);
    },
    read: async (path) =>
      path in files ? ok({ text: files[path] as string, mtimeMs: 1 }) : fail("not-found", path),
    write: async () => fail("no", "read only"),
    create: async () => fail("no", "read only"),
  };
}

describe("loadVault", () => {
  const files = {
    "_system/colecciones/docencia.md": definition("docencia", "agenda/docencia"),
    "_system/colecciones/planes.md": definition("planes", "agenda/planes"),
    "_system/colecciones/notas.md": "---\ntype: wiki\nsummary: Not a definition.\n---\n",
    "agenda/docencia/2026-12-22 Clase.md":
      '---\ntitle: "Clase"\ndate: "2026-12-22"\nstartTime: "09:30"\nendTime: "10:30"\ncompleted:\n---\n',
    "agenda/docencia/sin-fecha.md": '---\ntitle: "Sin fecha"\n---\n',
    "agenda/docencia/README.md": "---\ntype: index\nsummary: Index.\n---\n",
    "agenda/docencia/rota.md": "---\ntitle: [oops\n---\n",
    "agenda/planes/2026-11-02 Tarea.md":
      '---\ntitle: "Tarea"\ndate: "2026-11-02"\ncompleted: false\n---\n',
  };

  it("builds rows per collection and lists the notes it cannot place", async () => {
    const r = await loadVault(fakeVault(files), { readOnly: true });
    expect(r.problems).toEqual([]);
    expect(r.snapshot.collections.map((c) => c.id).sort()).toEqual(["docencia", "planes"]);
    expect(r.snapshot.views.every((v) => v.readOnly)).toBe(true);
    expect(r.notes).toBe(3);
    expect(r.snapshot.rows.map((x) => x.id).sort()).toEqual([
      "agenda/docencia/2026-12-22 Clase.md",
      "agenda/docencia/sin-fecha.md",
      "agenda/planes/2026-11-02 Tarea.md",
    ]);
    expect(r.ignored.map((i) => i.path).sort()).toEqual([
      "agenda/docencia/rota.md",
      "agenda/docencia/sin-fecha.md",
    ]);
    expect(r.ignored.find((i) => i.path.endsWith("sin-fecha.md"))?.reason).toBe("no-date");
  });

  it("keeps loading when a definition or a folder is broken", async () => {
    const broken = {
      ...files,
      "_system/colecciones/mala.md": definition("mala", "agenda/docencia").replace(
        "type: text }",
        "type: wat }",
      ),
      "_system/colecciones/falta.md": definition("falta", "agenda/inexistente"),
    };
    const r = await loadVault(fakeVault(broken), { readOnly: false });
    expect(r.snapshot.collections.map((c) => c.id).sort()).toEqual(["docencia", "falta", "planes"]);
    expect(r.problems.some((p) => p.includes("mala.md"))).toBe(true);
    expect(r.problems.some((p) => p.includes("agenda/inexistente"))).toBe(false); // an empty folder is fine
    expect(r.snapshot.views.every((v) => !v.readOnly)).toBe(true);
  });

  it("reports a vault without definitions instead of showing nothing silently", async () => {
    const r = await loadVault(fakeVault({}), { readOnly: true });
    expect(r.snapshot.collections).toEqual([]);
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe("loadVault with an index", () => {
  const files: Record<string, string> = {
    "_system/colecciones/docencia.md": definition("docencia", "agenda/docencia"),
    "agenda/docencia/2026-12-22 Clase.md":
      '---\ntitle: "Clase"\ndate: "2026-12-22"\nstartTime: "09:30"\nendTime: "10:30"\n---\n',
    "agenda/docencia/2026-12-23 Otra.md": '---\ntitle: "Otra"\ndate: "2026-12-23"\n---\n',
    "agenda/docencia/rota.md": "---\ntitle: [oops\n---\n",
  };
  const counting = (stats: Record<string, number>) => {
    const reads: string[] = [];
    const base = fakeVault(files);
    const bridge: VaultBridge = {
      ...base,
      scan: async (dir) => {
        const r = await base.scan(dir);
        return r.ok
          ? { ok: true, value: r.value.map((n) => ({ ...n, mtimeMs: stats[n.path] ?? 1 })) }
          : r;
      },
      read: async (path) => {
        reads.push(path);
        return base.read(path);
      },
    };
    return { bridge, reads };
  };

  it("reads each note once and then reuses the very same rows", async () => {
    const stats: Record<string, number> = {};
    const { bridge, reads } = counting(stats);
    const first = await loadVault(bridge, { readOnly: true });
    expect(first.read).toBe(3);
    reads.length = 0;
    const second = await loadVault(bridge, { readOnly: true }, first.index);
    expect(second.read).toBe(0);
    expect(reads.filter((p) => p.startsWith("agenda"))).toEqual([]);
    expect(second.snapshot.rows).toHaveLength(2);
    for (const [i, row] of second.snapshot.rows.entries()) expect(row).toBe(first.snapshot.rows[i]);
    expect(second.ignored.map((i) => i.path)).toEqual(["agenda/docencia/rota.md"]);
  });

  it("re-reads only the notes whose modification time changed", async () => {
    const stats: Record<string, number> = {};
    const { bridge, reads } = counting(stats);
    const first = await loadVault(bridge, { readOnly: true });
    reads.length = 0;
    stats["agenda/docencia/2026-12-23 Otra.md"] = 99;
    files["agenda/docencia/2026-12-23 Otra.md"] =
      '---\ntitle: "Otra cambiada"\ndate: "2026-12-23"\n---\n';
    const second = await loadVault(bridge, { readOnly: true }, first.index);
    expect(second.read).toBe(1);
    expect(reads.filter((p) => p.startsWith("agenda"))).toEqual([
      "agenda/docencia/2026-12-23 Otra.md",
    ]);
    const [a, b] = second.snapshot.rows;
    expect(a).toBe(first.snapshot.rows[0]);
    expect(b).not.toBe(first.snapshot.rows[1]);
    expect(b?.values.title).toBe("Otra cambiada");
  });

  it("drops notes that disappeared and lists the folders to watch", async () => {
    const stats: Record<string, number> = {};
    const { bridge } = counting(stats);
    const first = await loadVault(bridge, { readOnly: true });
    expect(first.folders).toEqual(["_system/colecciones", "agenda/docencia"]);
    const saved = { ...files };
    delete files["agenda/docencia/2026-12-22 Clase.md"];
    const second = await loadVault(bridge, { readOnly: true }, first.index);
    expect(second.snapshot.rows.map((r) => r.id)).toEqual(["agenda/docencia/2026-12-23 Otra.md"]);
    expect(second.index.has("agenda/docencia/2026-12-22 Clase.md")).toBe(false);
    Object.assign(files, saved);
  });

  it("survives a round trip through the saved form", async () => {
    const { bridge } = counting({});
    const first = await loadVault(bridge, { readOnly: true });
    const restored = parseIndex(serializeIndex(first.index));
    expect(restored.size).toBe(first.index.size);
    const again = await loadVault(bridge, { readOnly: true }, restored);
    expect(again.read).toBe(0);
    expect(again.snapshot.rows.map((r) => r.values)).toEqual(
      first.snapshot.rows.map((r) => r.values),
    );
    expect(again.ignored).toEqual(first.ignored);
  });

  it("starts cold from anything unexpected", () => {
    expect(parseIndex(null).size).toBe(0);
    expect(parseIndex("not json").size).toBe(0);
    expect(
      parseIndex(JSON.stringify({ version: 99, notes: { a: [1, 1, {}, "", true, null] } })).size,
    ).toBe(0);
    expect(parseIndex(JSON.stringify({ version: 1, notes: { a: ["x"] } })).size).toBe(0);
  });
});
