import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import v8 from "node:v8";
import { runInNewContext } from "node:vm";
import { ensureSystemTypes } from "@boni/agent";
import { type FieldDef, label, type TypeDef } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { exportChunks, exportFiles } from "./export.ts";
import { importExport } from "./reimport.ts";
import { entryData, openZip, openZipFile, writeZip, type ZipEntry, zipChunks } from "./zip.ts";

/**
 * Task 101: a backup with files of up to 1 GB and more than 4 GB in total is written and read back whole, a part
 * at a time. CI cannot write 4 GB, so the ZIP64 path is taken with lowered limits, a real one past 4 GB is written
 * onto a sparse file (its gigabytes of zeros are holes, never on disk), and memory is measured, not assumed.
 */
const NOW = Date.UTC(2026, 10, 12, 12);
const MB = 1024 * 1024;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "boni-big-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
function store(path = ":memory:"): UserStore {
  const s = openUserStore(path, { now: () => NOW });
  ensureSystemTypes(s);
  cleanups.push(() => s.close());
  return s;
}

/** Python's zipfile (any CI runner has it), a reader that is not ours: its names, and one entry's bytes. */
const python = (zip: string, entry: string) =>
  JSON.parse(
    execFileSync(
      "python3",
      [
        "-I",
        "-c",
        "import sys,json,zipfile\nz=zipfile.ZipFile(sys.argv[1])\n" +
          "print(json.dumps({'names':len(z.namelist()),'entry':z.read(sys.argv[2]).decode('latin-1')}))",
        zip,
        entry,
      ],
      { encoding: "utf8" },
    ),
  ) as { names: number; entry: string };

/** The collection of files as Juan's is shaped (a generated id, «Archivos», «Carpeta»), invented. */
const L = label("imported", "public", [{ kind: "vault", id: "import" }]);
const OWN = label("user", "personal", []);
const TYPE = "t_01m70ejemplo0archivos00000a";
const fld = (id: string, key: string, name: string, type: FieldDef["type"]): FieldDef => ({
  id,
  key,
  name,
  type,
  label: L,
});
function filesType(s: UserStore) {
  const def: TypeDef = {
    id: TYPE,
    key: "archivos",
    name: "Archivos",
    fields: [
      fld("f_01m70ejemplotitulo0000000a", "titulo", "Título", "text"),
      fld("f_01m70ejemploarchivo000000a", "archivo", "Archivo", "file"),
      fld("f_01m70ejemplocarpeta000000a", "carpeta", "Carpeta", "text"),
    ],
    titleField: "f_01m70ejemplotitulo0000000a",
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
  };
  s.applySchema({ op: "create_type", type: def }, { actor: "import", run: "i1" });
}
const row = (s: UserStore, title: string, sha?: string) =>
  s.create(
    TYPE,
    {
      f_01m70ejemplotitulo0000000a: { value: title, label: OWN },
      ...(sha ? { f_01m70ejemploarchivo000000a: { value: sha, label: OWN } } : {}),
      f_01m70ejemplocarpeta000000a: { value: "registros/ejemplo", label: OWN },
    },
    { actor: "user" },
  ).entity.id;
/** A dropped file of `mb` megabytes, its bytes made from `seed` (each one different), kept a part at a time. */
function drop(s: UserStore, seed: number, mb: number): string {
  const w = s.fileWriter("application/pdf");
  const piece = Buffer.alloc(MB);
  for (let i = 0; i < mb; i++) {
    piece.fill((seed * 31 + i) & 0xff);
    piece.writeUInt32LE(seed, 0);
    w.write(piece);
  }
  return w.finish();
}
const shaOf = (s: UserStore, sha: string) => {
  const h = createHash("sha256");
  for (const c of s.fileChunks(sha)) h.update(c);
  return h.digest("hex");
};

/**
 * What is held, heap and buffers, above where it started: read after two collections. After one, the memory of
 * the buffers it found dead is still counted until V8 frees it on another thread, so on a busy or small machine
 * the 1 MB parts already sent were read as held: 56 and 63 MB on CI (task 105), 15-30 MB here on one core. A
 * second collection starts only once that is done, so its reading is what is reachable: 6.8 MB on one core,
 * every run.
 */
function meter() {
  v8.setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  const settle = () => {
    gc();
    gc();
    return process.memoryUsage();
  };
  const base = settle();
  let peak = 0;
  return {
    measure() {
      const m = settle();
      peak = Math.max(peak, m.heapUsed - base.heapUsed + (m.arrayBuffers - base.arrayBuffers));
    },
    get peak() {
      return peak;
    },
  };
}

describe("ZIP64", () => {
  it("with lowered limits, positions, the count and the directory go in ZIP64 records any reader opens", () => {
    const entries: ZipEntry[] = [];
    for (let i = 0; i < 30; i++)
      entries.push(
        i % 3 === 0
          ? { path: `files/${i}`, chunks: () => [Buffer.alloc(300, i), Buffer.alloc(200, i + 1)] }
          : {
              path: `json/${i}.ndjson`,
              data: Buffer.from(`{"n":${i}}\n`.repeat(20)),
              stored: i % 2 === 0,
            },
      );
    const zip = writeZip(entries, NOW, { bytes: 1000, entries: 10 });
    // The classic end record is still the last 22 bytes, its fields at their maximum; ZIP64's locator before it.
    const end = zip.subarray(zip.length - 22);
    expect([end.readUInt32LE(0), end.readUInt16LE(10), end.readUInt32LE(16)]).toEqual([
      0x06054b50, 0xffff, 0xffffffff,
    ]);
    expect(zip.readUInt32LE(zip.length - 42)).toBe(0x07064b50);
    const z = openZip(zip);
    expect(z.names).toHaveLength(30);
    for (const e of entries) expect(z.read(e.path)?.equals(entryData(e))).toBe(true);
    const dir = tmp();
    writeFileSync(join(dir, "x.zip"), zip);
    expect(python(join(dir, "x.zip"), "files/27")).toEqual({
      names: 30,
      entry: `${"\x1b".repeat(300)}${"\x1c".repeat(200)}`,
    });
    let tested = "";
    try {
      tested = execFileSync("unzip", ["-t", join(dir, "x.zip")], { encoding: "utf8" });
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
      tested = "No errors detected (no unzip here)";
    }
    expect(tested).toContain("No errors detected");
    // Under the limits nothing changes: the same bytes as before ZIP64 (an old reader opens what fits in zip32).
    expect(writeZip(entries.slice(0, 5), NOW).includes(Buffer.from([0x50, 0x4b, 6, 7]))).toBe(
      false,
    );
  });

  it("a real backup past 4 GB: four files of 1 GB stream through onto a sparse file, read back past 4 GB", () => {
    const t0 = performance.now();
    const zero = Buffer.alloc(16 * MB);
    const gb = (n: number): ZipEntry => ({
      path: `files/${"0".repeat(63)}${n}`,
      stored: true,
      chunks: function* () {
        for (let i = 0; i < 64; i++) yield zero;
      },
    });
    const entries: ZipEntry[] = [
      { path: "schema.json", data: Buffer.from('{"format":"boni-export"}\n') },
      gb(1),
      gb(2),
      gb(3),
      gb(4),
      { path: "json/al-final.ndjson", data: Buffer.from('{"id":"e_ejemplo"}\n') },
      gb(5),
      { path: "views.json", data: Buffer.from("{}\n") },
    ];
    const file = join(tmp(), "copia.zip");
    const fd = openSync(file, "w");
    let at = 0;
    try {
      // The writer's output as the CLI writes it, but its zeros are holes: CI's disk never holds the gigabytes.
      for (const c of zipChunks(entries, NOW)) {
        if (c !== zero) writeSync(fd, c, 0, c.length, at);
        at += c.length;
      }
    } finally {
      closeSync(fd);
    }
    const st = statSync(file);
    expect(st.size).toBe(at);
    expect(at).toBeGreaterThan(5 * 1024 * MB);
    expect(st.blocks * 512).toBeLessThan(16 * MB); // sparse: what it takes on disk
    const z = openZipFile(file);
    cleanups.push(() => z.close());
    expect(z.names).toHaveLength(8);
    expect(z.size(gb(5).path)).toBe(1024 * MB);
    expect(z.read("json/al-final.ndjson")?.toString()).toBe('{"id":"e_ejemplo"}\n');
    // The last 1 GB file, past 5 GB in the zip, read a part at a time with its CRC checked at the end.
    let n = 0;
    for (const part of z.chunks(gb(5).path, 16 * MB)) n += part.length;
    expect(n).toBe(1024 * MB);
    expect(python(file, "views.json")).toEqual({ names: 8, entry: "{}\n" });
    console.log(
      `5 GB backup (sparse) written and read back in ${Math.round(performance.now() - t0)} ms`,
    );
  }, 60_000);
});

describe("a backup with big files comes back whole", () => {
  it("export and import from disk, a part at a time: every file and record, memory far below the files", () => {
    const dir = tmp();
    const a = store(join(dir, "a.db"));
    filesType(a);
    // His volume of records (thousands), three big dropped files and many small ones, invented.
    const big = [drop(a, 1, 32), drop(a, 2, 32), drop(a, 3, 32)];
    const ids = big.map((sha, i) => row(a, `copia-ejemplo-${i}.bin`, sha));
    for (let i = 0; i < 200; i++)
      ids.push(row(a, `foto-ejemplo-${i}.jpg`, a.putFile(Buffer.from(`foto ${i}`), "image/jpeg")));
    a.batch(() => {
      for (let i = 0; i < 3000; i++) ids.push(row(a, `nota-ejemplo-${i}`));
    });
    const file = join(dir, "copia.zip");
    const m = meter();
    const t0 = performance.now();
    // ZIP64 with lowered limits: past 8 MB every position is ZIP64, and the 3,200-odd entries are past 1,000.
    const fd = openSync(file, "w");
    let written = 0;
    let next = 8 * MB;
    try {
      for (const c of exportChunks(a, { now: NOW, limits: { bytes: 8 * MB, entries: 1000 } })) {
        writeSync(fd, c);
        written += c.length;
        if (written >= next) {
          next += 8 * MB;
          m.measure();
        }
      }
    } finally {
      closeSync(fd);
    }
    const exported = performance.now() - t0;
    const exportPeak = m.peak;
    expect(readFileSync(file).subarray(-42).readUInt32LE(0)).toBe(0x07064b50); // it took the ZIP64 path

    const b = store(join(dir, "b.db"));
    const m2 = meter();
    const t1 = performance.now();
    const z = openZipFile(file);
    cleanups.push(() => z.close());
    let parts = 0;
    const measured = new Proxy(z, {
      get: (t, k) =>
        k === "chunks"
          ? function* (name: string) {
              for (const p of t.chunks(name)) {
                if (++parts % 8 === 0) m2.measure();
                yield p;
              }
            }
          : Reflect.get(t, k),
    });
    const r = importExport(measured, b, { apply: true, trustLabels: true });
    const imported = performance.now() - t1;
    expect(r.files).toEqual({ added: 203, present: 0, missing: [] });
    expect(r.failed).toEqual([]);
    expect(b.list(TYPE)).toHaveLength(ids.length);
    for (const sha of big) {
      expect(b.fileInfo(sha)).toEqual({ mime: "application/pdf", size: 32 * MB });
      expect(shaOf(b, sha)).toBe(sha);
    }
    console.log(
      `${ids.length} records and 96 MB of files: export ${Math.round(exported)} ms (held at most ` +
        `${(exportPeak / MB).toFixed(1)} MB), import ${Math.round(imported)} ms (at most ${(m2.peak / MB).toFixed(1)} MB)`,
    );
    // A file is never held whole, going out or coming in: far less than one of the 32 MB files (the export holds
    // about 7 MB, the records' entries; the import about 3 MB).
    expect([exportPeak < 12 * MB, m2.peak < 12 * MB]).toEqual([true, true]);
  }, 60_000);

  it("a backup made before ZIP64 (zip32, with an attachment kept in parts) still imports, its files too", () => {
    const z = openZipFile(new URL("./fixtures/backup-before-zip64.zip", import.meta.url).pathname);
    cleanups.push(() => z.close());
    const b = store();
    const r = importExport(z, b, { apply: true });
    expect(r).toMatchObject({
      created: 2,
      failed: [],
      files: { added: 2, present: 0, missing: [] },
    });
    const sha = "4ba5e33be6fc1454de43e67772675c793a553cb59559408adb2ee9c15198ec0e";
    expect(b.fileInfo(sha)).toEqual({ mime: "application/pdf", size: 216000 });
    expect(shaOf(b, sha)).toBe(sha);
  });
});

describe("an import that fails halfway", () => {
  /** A store with two files and their rows, exported as entries (to damage one of them). */
  function exported() {
    const a = store();
    filesType(a);
    const one = drop(a, 7, 2);
    const two = a.putFile(Buffer.from("%PDF-1.7 dos inventado"), "application/pdf");
    const ids = [row(a, "uno.pdf", one), row(a, "dos.pdf", two), row(a, "sin archivo")];
    return { a, one, two, ids, entries: exportFiles(a, { now: NOW }) };
  }

  it("a damaged file does not come back, the rest does, and the report says which and who names it", () => {
    const { one, two, ids, entries } = exported();
    const zip = writeZip(entries, NOW);
    // A byte of the first file flipped: its CRC no longer matches (found only once its last part is read).
    const at = zip.indexOf(Buffer.from(`files/${one}`)) + `files/${one}`.length + 1000;
    zip[at] = (zip[at] as number) ^ 0xff;
    const file = join(tmp(), "rota.zip");
    writeFileSync(file, zip);
    const z = openZipFile(file);
    cleanups.push(() => z.close());
    const b = store();
    const dry = importExport(z, b);
    expect(dry.files).toEqual({ added: 2, present: 0, missing: [] }); // a dry run reads no file's bytes
    const r = importExport(z, b, { apply: true });
    expect(r.files).toEqual({
      added: 1,
      present: 0,
      missing: [
        { sha256: one, mime: "application/pdf", error: `damaged: files/${one}`, records: [ids[0]] },
      ],
    });
    expect(b.fileInfo(one)).toBeNull(); // nothing kept cut short or under the wrong hash
    expect(b.fileInfo(two)).not.toBeNull();
    expect(b.list(TYPE)).toHaveLength(3);
  });

  it("a file missing from the zip, or not the bytes its hash says, is named; nothing is kept under that hash", () => {
    const { one, two, ids, entries } = exported();
    const files = new Map(entries.map((e) => [e.path, entryData(e)]));
    files.delete(`files/${one}`);
    files.set(`files/${two}`, Buffer.from("%PDF-1.7 cambiado"));
    const b = store();
    const r = importExport(files, b, { apply: true });
    // In the order of the export's files (by hash), so compared by hash.
    const bySha = (a: { sha256: string }, b: { sha256: string }) =>
      a.sha256.localeCompare(b.sha256);
    expect([...r.files.missing].sort(bySha)).toEqual(
      [
        { sha256: one, mime: "application/pdf", error: "not in the export", records: [ids[0]] },
        {
          sha256: two,
          mime: "application/pdf",
          error: "file damaged: not the bytes it was kept as",
          records: [ids[1]],
        },
      ].sort(bySha),
    );
    expect([b.fileInfo(one), b.fileInfo(two)]).toEqual([null, null]);
  });

  it("stopped while writing records (a damaged line) or by a full disk, it leaves the store's records as they were", () => {
    const { entries } = exported();
    const files = new Map(entries.map((e) => [e.path, entryData(e)]));
    const lines = (files.get("json/archivos.ndjson") as Buffer).toString().split("\n");
    lines.splice(2, 0, "{ cortado");
    files.set("json/archivos.ndjson", Buffer.from(lines.join("\n")));
    const b = store();
    const before = { types: Object.keys(b.schema().types).length, log: b.logPage(0, 1000).length };
    expect(() => importExport(files, b, { apply: true })).toThrow(SyntaxError);
    expect(b.schema().types[TYPE]).toBeUndefined();
    expect({ types: Object.keys(b.schema().types).length, log: b.logPage(0, 1000).length }).toEqual(
      before,
    );
    // A full disk while a file comes in stops before any record: the next try takes what came as it is.
    const c = store();
    let n = 0;
    const full = new Proxy(c, {
      get: (t, k) =>
        k === "fileWriter"
          ? (mime: string, max?: number) => {
              const w = t.fileWriter(mime, max);
              if (++n === 2)
                return {
                  ...w,
                  write: () => {
                    w.abort();
                    throw new Error("SQLITE_FULL: database or disk is full");
                  },
                };
              return w;
            }
          : Reflect.get(t, k),
    });
    const good = new Map(entries.map((e) => [e.path, entryData(e)]));
    expect(() => importExport(good, full, { apply: true })).toThrow("SQLITE_FULL");
    expect(c.schema().types[TYPE]).toBeUndefined();
    const again = importExport(good, c, { apply: true });
    expect(again.files).toEqual({ added: 1, present: 1, missing: [] });
    expect(c.list(TYPE)).toHaveLength(3);
  });
});
