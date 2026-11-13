import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import v8 from "node:v8";
import { runInNewContext } from "node:vm";
import { fakePlanner } from "@boni/agent";
import { label, newId } from "@boni/entities";
import { MAX_UPLOAD_BYTES } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { cpu } from "./cpu.test-util.ts";
import { createRow } from "./data.ts";
import { type Db, openDb } from "./db.ts";
import { DROP_FOLDER, dropName } from "./drops.ts";
import { Feeds } from "./feeds.ts";
import { fileFacts } from "./fileActions.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { FILE_FIELD, FOLDER_FIELD } from "./paths.ts";

/**
 * A file dropped on Boni's window (docs/sistema.md §4.7, A-24), over HTTP: kept in his files as it arrives, in a
 * folder by month, whether or not its message is sent; refused past 1 GB with a word; and never whole in the server's
 * memory, going in or coming out. The files collection is shaped like his (a generated id, «Archivos», «Carpeta»).
 */
const PASSWORD = "una contraseña larga de ejemplo";
const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
const ARCHIVOS = newId("t");
const NOMBRE = newId("f");
const NOW = Date.UTC(2026, 10, 12, 9, 0);
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
let server: Server;
let base: string;
let token: string;

async function login() {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "portatil-ejemplo" }),
  });
  return ((await r.json()) as { token: string }).token;
}
/** A name as the apps put it in the query: every character but letters, digits and `-_.` escaped. */
const queryName = (name: string) =>
  encodeURIComponent(name).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
const upload = async (name: string, body: BodyInit, init: RequestInit = {}) => {
  const r = await fetch(`${base}/api/data/files/upload?name=${queryName(name)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
    ...init,
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-drops-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  host = new AgentHost({
    dataDir: dir,
    providers: { planner: fakePlanner([]), reader: fakePlanner([]) },
    now: () => NOW,
    tz: "Europe/Madrid",
  });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
    now: () => NOW,
  });
  server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  host.store(1).applySchema(
    {
      op: "create_type",
      type: {
        id: ARCHIVOS,
        key: "archivos",
        name: "Archivos",
        fields: [
          { id: NOMBRE, key: "nombre", name: "Nombre", type: "text", label: own },
          { id: FILE_FIELD, key: "boni-archivo", name: "Archivo", type: "file", label: own },
          { id: FOLDER_FIELD, key: "carpeta", name: "Carpeta", type: "text", label: own },
        ],
        titleField: NOMBRE,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  token = await login();
}, 120_000);

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const FOLDER = `${DROP_FOLDER}/2026-11`;
const rowsIn = () =>
  host
    .store(1)
    .entities(ARCHIVOS)
    .map((e) => ({
      name: e.values[NOMBRE],
      folder: e.values[FOLDER_FIELD],
      sha: e.values[FILE_FIELD] as string,
    }));

describe("a file dropped on Boni's window (A-24)", () => {
  it("is kept in his files as it is dropped, sent or not, in the month's folder; a second of that name is «(2)»", async () => {
    const pdf = Buffer.from("%PDF-1.7 factura inventada\n%%EOF\n", "latin1");
    const a = await upload("Factura FAC-2026-0142 (taller).pdf", pdf);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({
      name: "Factura FAC-2026-0142 (taller).pdf",
      type: ARCHIVOS,
      mime: "application/pdf",
      size: pdf.length,
      folder: FOLDER,
      state: "text",
    });
    const b = await upload("Factura FAC-2026-0142 (taller).pdf", pdf);
    expect(b.body.name).toBe("Factura FAC-2026-0142 (taller) (2).pdf");
    const photo = await upload("tique ñ.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(photo.body).toMatchObject({ mime: "image/jpeg", state: "image" });
    // No message was sent, no turn ran: the rows are there.
    expect(rowsIn().map((r) => [r.name, r.folder])).toEqual([
      ["Factura FAC-2026-0142 (taller).pdf", FOLDER],
      ["Factura FAC-2026-0142 (taller) (2).pdf", FOLDER],
      ["tique ñ.jpg", FOLDER],
    ]);
    const got = await fetch(`${base}/api/data/files/${rowsIn()[0]?.sha}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect([got.status, got.headers.get("content-length")]).toEqual([200, String(pdf.length)]);
    expect(Buffer.from(await got.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it("refuses a bad name, an empty file, and one that says it is over 1 GB before reading any of it", async () => {
    expect(dropName("../../etc/passwd")).toBeNull();
    expect(dropName(".oculto")).toBeNull();
    expect(dropName("  extracto noviembre.csv ")).toBe("extracto noviembre.csv");
    expect((await upload("carpeta/archivo.pdf", "x")).body).toEqual({ error: "bad-name" });
    expect((await upload("vacío.txt", "")).body).toEqual({ error: "empty" });
    const before = rowsIn().length;
    // Only the headers go: the answer comes without a byte of the body.
    const answer = await new Promise<{ status?: number; body: string }>((ok, fail) => {
      const req = request(
        `${base}/api/data/files/upload?name=${queryName("vídeo grande.mp4")}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-length": String(MAX_UPLOAD_BYTES + 1),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => ok({ status: res.statusCode, body }));
        },
      );
      req.on("error", fail);
      req.flushHeaders();
    });
    expect(answer).toEqual({ status: 413, body: JSON.stringify({ error: "too-big" }) });
    expect(rowsIn().length).toBe(before);
  });

  it("with his volume (A-15): a drop among 3,000 of his files, and the facts of twenty pointed at, take milliseconds", async () => {
    const store = host.store(1);
    const sha = store.putFile(Buffer.from("adjunto inventado"), "application/pdf");
    const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
    const ids: string[] = [];
    for (let i = 0; i < 3000; i++) {
      // Most come with mail (by month under «correo/»); some were dropped this month.
      const folder = i % 10 === 0 ? FOLDER : `correo/${months[i % 4]}`;
      const e = createRow(store, ARCHIVOS, {
        [NOMBRE]: `Adjunto ${i}.pdf`,
        [FILE_FIELD]: sha,
        [FOLDER_FIELD]: folder,
      });
      ids.push(e.id);
    }
    const t0 = cpu();
    const a = await upload("Adjunto 10.pdf", Buffer.from("%PDF-1.7 otra\n%%EOF\n", "latin1"));
    const drop = cpu() - t0;
    expect(a.body.name).toBe("Adjunto 10 (2).pdf");
    const t1 = cpu();
    for (const id of ids.slice(0, 20)) expect(fileFacts(store, id)).not.toBeNull();
    const facts = cpu() - t1;
    console.log(
      `drop among 3,000: ${Math.round(drop)} ms; twenty files' facts: ${Math.round(facts)} ms`,
    );
    expect([drop < 300, facts < 50]).toEqual([true, true]);
  }, 120_000);

  it("streams: 128 MB in and out with the server's memory growing by far less", async () => {
    const MB = 1024 * 1024;
    const total = 128;
    const piece = randomBytes(MB);
    // What is held, not what waits to be collected: measured after a collection, every 8 MB, while the server takes
    // it (it runs in this process). Sent by a plain client: fetch keeps a streamed body whole until it is answered.
    v8.setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    gc();
    const base0 = process.memoryUsage();
    let peak = 0;
    const measure = () => {
      gc();
      const m = process.memoryUsage();
      peak = Math.max(peak, m.heapUsed - base0.heapUsed + (m.arrayBuffers - base0.arrayBuffers));
    };
    {
      const r = await new Promise<{ body: Record<string, unknown> }>((ok, fail) => {
        const req = request(
          `${base}/api/data/files/upload?name=${queryName("copia del disco.bin")}`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-length": String(total * MB) },
          },
          (res) => {
            let b = "";
            res.on("data", (c) => {
              b += c;
            });
            res.on("end", () => ok({ body: JSON.parse(b) }));
          },
        );
        req.on("error", fail);
        let sent = 0;
        const more = () => {
          while (sent < total) {
            if (++sent % 8 === 0) measure();
            if (!req.write(piece)) return void req.once("drain", more);
          }
          req.end();
        };
        more();
      });
      expect(r.body).toMatchObject({ size: total * MB, state: "unreadable" });
      const sha = rowsIn().at(-1)?.sha;
      const got = await fetch(`${base}/api/data/files/${sha}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(got.headers.get("content-length")).toBe(String(total * MB));
      let read = 0;
      let next = 8 * MB;
      for await (const c of got.body as unknown as AsyncIterable<Uint8Array>) {
        read += c.length;
        if (read >= next) {
          next += 8 * MB;
          measure();
        }
      }
      expect(read).toBe(total * MB);
    }
    // Whole in memory it would be 128 MB at least; a part at a time it stays near a few parts.
    expect(peak).toBeLessThan(32 * MB);
  }, 60_000);
});
