import type { NoteStat, VaultBridge, VaultResult } from "../vaultBridge.ts";

/** A vault in memory behind the same interface as the desktop bridge (tests only). */
export function memoryVault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const mtimes = new Map<string, number>();
  const trashed: string[] = [];
  let clock = 1000;
  const touch = (path: string): number => {
    clock += 10;
    mtimes.set(path, clock);
    return clock;
  };
  for (const p of files.keys()) touch(p);
  const ok = <T>(value: T): VaultResult<T> => ({ ok: true, value });
  const fail = (code: string, message: string): VaultResult<never> => ({
    ok: false,
    code,
    message,
  });
  const size = (text: string) => new TextEncoder().encode(text).length;

  const bridge: VaultBridge = {
    getRoot: async () => ok("/vault"),
    chooseRoot: async () => ok("/vault"),
    scan: async (dir): Promise<VaultResult<NoteStat[]>> =>
      ok(
        [...files.keys()]
          .filter((p) => p.startsWith(`${dir}/`))
          .map((path) => ({
            path,
            mtimeMs: mtimes.get(path) ?? 0,
            size: size(files.get(path) ?? ""),
          })),
      ),
    read: async (path) =>
      files.has(path)
        ? ok({ text: files.get(path) as string, mtimeMs: mtimes.get(path) ?? 0 })
        : fail("not-found", path),
    write: async (path, text, expected) => {
      if (!files.has(path)) return fail("not-found", path);
      if (expected != null && Math.abs((mtimes.get(path) ?? 0) - expected) > 1) {
        return ok({ conflict: true, mtimeMs: mtimes.get(path) ?? 0, size: 0 });
      }
      files.set(path, text);
      return ok({ conflict: false, mtimeMs: touch(path), size: size(text) });
    },
    create: async (path, text) => {
      if (files.has(path)) return ok({ exists: true as const });
      files.set(path, text);
      return ok({ exists: false as const, mtimeMs: touch(path), size: size(text) });
    },
    rename: async (from, to) => {
      if (!files.has(from)) return fail("not-found", from);
      if (files.has(to)) return ok({ exists: true as const });
      files.set(to, files.get(from) as string);
      mtimes.set(to, mtimes.get(from) ?? 0);
      files.delete(from);
      mtimes.delete(from);
      return ok({
        exists: false as const,
        mtimeMs: mtimes.get(to) ?? 0,
        size: size(files.get(to) ?? ""),
      });
    },
    trash: async (path) => {
      if (!files.has(path)) return fail("not-found", path);
      trashed.push(path);
      files.delete(path);
      mtimes.delete(path);
      return ok(null);
    },
  };
  return {
    bridge,
    files,
    trashed,
    /** Changes a note as another program would (new modification time). */
    editOutside(path: string, text: string) {
      files.set(path, text);
      touch(path);
    },
  };
}

export const definitionNote = (id: string, name: string, folder: string, area: string) => `---
type: wiki
summary: Definition of ${name}.
collection:
  id: ${id}
  name: ${name}
  folder: ${folder}
  account: Agenda
  color: "#60a5fa"
  columns:
    - { id: title, name: Título, type: text }
    - { id: date, name: Fecha, type: date }
    - { id: startTime, name: Inicio, type: time }
    - { id: endTime, name: Fin, type: time }
    - { id: endDate, name: Fecha de fin, type: date }
    - { id: allDay, name: Todo el día, type: checkbox }
    - { id: timezone, name: Zona, type: text }
    - { id: completed, name: Hecha, type: checkbox }
    - { id: location, name: Lugar, type: text }
    - { id: series, name: Serie, type: text }
    - { id: series_rule, name: Regla, type: text }
  mapping:
    title: title
    location: location
    when: { kind: split, date: date, startTime: startTime, endTime: endTime, endDate: endDate, allDay: allDay, timezone: timezone }
    task: { column: completed }
    series: { id: series, rule: series_rule }
  newNote:
    name: "{date} {title}"
    body: "Area: [[${area}]]\\n\\n## Notas\\n"
---
`;
