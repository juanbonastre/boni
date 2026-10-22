import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { definitionNote } from "../apps/calendar-web/src/vault/testing.ts";

/**
 * The area as a property (Juan, 2026-10-22), rehearsed with the commands the NAS session runs: a vault already
 * moved to Boni (calendar included), its calendars taken out of core mode, imported again (the template's
 * "Area: [[x]]" line becomes the `area` property), switched back (the mirror writes `area:` into each note and
 * takes the line out), and the definitions copied again with `newNote.properties` (keeping the reminders Boni
 * has). Then a new event gets its calendar's area.
 */
const PASSWORD = "una contraseña larga de ejemplo";
const CLASS = "agenda/docencia/2025-09-17 Clase de ejemplo.md";
const DEF = "_system/colecciones/docencia.md";
test.describe.configure({ mode: "serial" });

let dir: string;
let proc: ChildProcess | null = null;
let url: string;
const read = (rel: string) =>
  existsSync(join(dir, "vault", rel)) ? readFileSync(join(dir, "vault", rel), "utf8") : null;
function write(rel: string, text: string) {
  mkdirSync(dirname(join(dir, "vault", rel)), { recursive: true });
  writeFileSync(join(dir, "vault", rel), text);
}
const node = (args: string[]) =>
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", ...args], {
    env: { ...process.env, BONI_DB: join(dir, "db.sqlite"), BONI_PASSWORD: PASSWORD },
  }).toString();
const cli = (...args: string[]) => node(["apps/server/src/cli.ts", ...args]);
const importVault = (apply: boolean) =>
  node([
    "packages/vault-import/src/cli.ts",
    "--vault",
    join(dir, "vault"),
    "--store",
    join(dir, "users", "1.db"),
    ...(apply ? ["--apply"] : []),
  ]);
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
async function startServer() {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  proc = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "apps/server/src/main.ts"],
    {
      env: {
        ...process.env,
        BONI_DB: join(dir, "db.sqlite"),
        BONI_PORT: String(port),
        BONI_WRITE: "1",
        ANTHROPIC_API_KEY: "sk-invented-for-tests",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    proc?.stdout?.on("data", (d) => String(d).includes("boni-calendar-server on") && resolve());
    proc?.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
}
async function api(method: string, path: string, body?: unknown) {
  const login = await fetch(`${url}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "portatil-area" }),
  });
  const { token } = (await login.json()) as { token: string };
  const r = await fetch(`${url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r.json();
}

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-e2e-area-"));
  write(DEF, definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"));
  write(
    CLASS,
    '---\ntitle: "Clase de ejemplo"\ndate: "2025-09-17"\nstartTime: "09:00"\nendTime: "10:00"\ntimezone: "Europe/Madrid"\ncompleted:\n---\nArea: [[docencia]]\n\n## Notas\nTema 3.\n',
  );
  write("areas/docencia.md", "---\ntype: area\n---\n# Docencia\n\nLo de la docencia.\n");
  cli("add-user", "juan", join(dir, "vault"));
  mkdirSync(join(dir, "users"));
  // Where the NAS was: everything in Boni, the calendar too, imported before the line was a property (a template
  // without it reads like the import of then).
  const template = read(DEF) as string;
  write(
    DEF,
    template.replace('body: "Area: [[docencia]]\\n\\n## Notas\\n"', 'body: "## Notas\\n"'),
  );
  importVault(true);
  write(DEF, template);
  for (const t of ["t_docencia", "t_area"]) cli("mirror", "juan", t, "--apply");
  cli("mirror", "juan", "--calendar", "--apply");
  await startServer();
  // Boni has its own reminders for the calendar by now.
  await api("PUT", "/api/collections/reminders", {
    collectionId: "docencia",
    reminders: { timed: "15m", allDay: "0d@09:00" },
  });
});

test.afterAll(() => {
  proc?.kill();
  rmSync(dir, { recursive: true, force: true });
});

test("the session: out of core mode, imported again, back with `area:` in each note", async () => {
  expect(read(CLASS)).toContain("Area: [[docencia]]");
  cli("mirror", "juan", "t_docencia", "--stop");
  const dry = importVault(false);
  expect(dry).toContain("1 changed");
  importVault(true);
  const switched = cli("mirror", "juan", "t_docencia");
  expect(switched).toContain("1 notes would change");
  expect(switched).toContain(`${CLASS}: area, (body)`);
  expect(switched).toContain('area: null -> "[[docencia]]"');
  expect(switched).toContain("0 notes the core does not have");
  cli("mirror", "juan", "t_docencia", "--apply");
  const text = read(CLASS) as string;
  expect(text).toContain('area: "[[docencia]]"');
  expect(text).not.toContain("Area:");
  expect(text).toContain("---\n## Notas\nTema 3.\n");

  // The definitions: new notes get the area as a property, not as a line.
  write(
    DEF,
    (read(DEF) as string).replace(
      'body: "Area: [[docencia]]\\n\\n## Notas\\n"',
      'body: "## Notas\\n"\n    properties: { area: "[[docencia]]" }',
    ),
  );
  expect(cli("mirror", "juan", "--calendar", "--apply")).toContain(
    "The calendar comes from Boni now",
  );
});

test("after it: the reminders Boni had stay, a new event gets its calendar's area", async () => {
  // The running server reads the copied definitions on its next look at the store (no restart, as on the NAS).
  const snap = (await api("GET", "/api/snapshot")) as {
    version: number;
    views: { id: string; reminders?: unknown }[];
    rows: { id: string; values: Record<string, unknown> }[];
  };
  expect(snap.views.find((v) => v.id === "docencia")?.reminders).toMatchObject({
    timed: [{ kind: "before", minutes: 15 }],
    allDay: [{ kind: "day", days: 0, at: 540 }],
  });
  expect(snap.rows.find((r) => r.id === CLASS)?.values.area).toBe("[[Docencia]]");
  const r = (await api("POST", "/api/apply", {
    base: snap.version,
    changes: [
      {
        op: "upsert",
        row: {
          id: "ev-nuevo",
          collectionId: "docencia",
          values: { title: "Tutoría inventada", date: "2025-09-19" },
          created: 0,
          updated: 0,
        },
      },
    ],
  })) as { ok: boolean; aliases: Record<string, string> };
  expect(r.ok).toBe(true);
  const id = r.aliases["ev-nuevo"] as string;
  await expect
    .poll(async () => {
      const s = (await api("GET", "/api/snapshot")) as typeof snap;
      return s.rows.find((x) => x.id === id)?.values.area;
    })
    .toBe("[[Docencia]]");
});
