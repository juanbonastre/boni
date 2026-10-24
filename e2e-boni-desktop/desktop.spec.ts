import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { readZip } from "../packages/export/src/zip.ts";

const ROOT = join(import.meta.dirname, "..");
const SHOTS = join(ROOT, "e2e-boni", "screenshots");
const PASSWORD = "una contraseña larga de ejemplo";
const PORT = 18000 + Math.floor(Math.random() * 1000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const tomorrow = new Date(Date.now() + 86_400_000);

/** An invented vault with the shapes of the real one (never real notes): the agenda, people, a note. */
const DEF = `---
type: wiki
collection:
  id: docencia
  name: Docencia
  folder: agenda/docencia
  account: Agenda
  color: "#60a5fa"
  columns:
    - { id: title, name: Título, type: text }
    - { id: date, name: Fecha, type: date }
    - { id: startTime, name: Hora de inicio, type: time }
    - { id: endTime, name: Hora de fin, type: time }
    - { id: completed, name: Hecha, type: checkbox }
  mapping:
    title: title
    when: { kind: split, date: date, startTime: startTime, endTime: endTime }
    task: { column: completed }
---
`;
const VAULT: Record<string, string> = {
  "_system/colecciones/agenda-docencia.md": DEF,
  [`agenda/docencia/${iso(today)} Clase de ejemplo.md`]: `---\ntitle: "Clase de ejemplo"\ndate: "${iso(today)}"\nstartTime: "10:00"\nendTime: "11:30"\ncompleted: false\n---\nPreparar los ejercicios del tema 3.\n\n## Material\n\n- Proyector\n- [ ] Fotocopias\n`,
  [`agenda/docencia/${iso(tomorrow)} Tutoría.md`]: `---\ntitle: "Tutoría"\ndate: "${iso(tomorrow)}"\nstartTime: "16:00"\ncompleted: false\n---\n`,
  "registros/personas/ana-ejemplo.md":
    "---\ntype: person\nsummary: Invented colleague.\n---\n# Ana\n",
};

/** An invented `private/` folder (the AI never reads Juan's): a note and a PDF in a folder. */
const ZONE: Record<string, string> = {
  "Documentos/seguro.md": '---\nvence: "2027-01-01"\n---\nPóliza inventada.\n',
  "Documentos/poliza.pdf": "%PDF-1.7 inventado",
};

let dir = "";
let server: ChildProcess | null = null;
let app: ElectronApplication | null = null;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-desktop-"));
  const vault = join(dir, "vault");
  for (const [p, text] of Object.entries(VAULT)) {
    mkdirSync(dirname(join(vault, p)), { recursive: true });
    writeFileSync(join(vault, p), text);
  }
  const env = { ...process.env, BONI_DB: join(dir, "boni-calendar.db"), BONI_PASSWORD: PASSWORD };
  execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo", vault], {
    cwd: ROOT,
    env,
  });
  mkdirSync(join(dir, "users"), { recursive: true });
  execFileSync(
    "node",
    [
      "packages/vault-import/src/cli.ts",
      "--vault",
      vault,
      "--store",
      join(dir, "users", "1.db"),
      "--apply",
    ],
    { cwd: ROOT, env },
  );
  // A zone, as Juan imports it himself: its own folder, every type kept from the AI.
  const zone = join(dir, "zone");
  for (const [p, text] of Object.entries(ZONE)) {
    mkdirSync(dirname(join(zone, p)), { recursive: true });
    writeFileSync(join(zone, p), text);
  }
  execFileSync(
    "node",
    [
      "packages/vault-import/src/cli.ts",
      "--zone",
      "private",
      "--vault",
      zone,
      "--store",
      join(dir, "users", "1.db"),
      "--apply",
    ],
    { cwd: ROOT, env },
  );
  server = spawn("node", ["apps/server/src/main.ts"], {
    cwd: ROOT,
    env: { ...env, BONI_PORT: String(PORT), BONI_WRITE: "1", ANTHROPIC_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 20_000);
    server?.stdout?.on("data", (b: Buffer) => {
      if (b.toString().includes(`127.0.0.1:${PORT}`)) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  // The desktop app as it runs on Juan's computer, with a profile of its own (never his).
  // BONI_DESKTOP_BIN: the packaged app (release/linux-unpacked/boni) instead of the source.
  const bin = process.env.BONI_DESKTOP_BIN;
  mkdirSync(join(dir, "tmp"));
  app = await electron.launch({
    cwd: join(ROOT, "apps", "boni-desktop"),
    ...(bin ? { executablePath: bin } : {}),
    args: [...(bin ? [] : ["."]), `--user-data-dir=${join(dir, "electron")}`],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_DATA_HOME: join(dir, "data"),
      TMPDIR: join(dir, "tmp"),
      BONI_TEST_FILES: "1", // an attachment is saved, not opened in a viewer
    },
  });
});

test.afterAll(async () => {
  await app?.close();
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

const shot = (w: Page, name: string) => w.screenshot({ path: join(SHOTS, `desktop-${name}.png`) });

test("the desktop app: logs in, makes a page, the agenda as a calendar, a note opened with its text", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.setViewportSize({ width: 1280, height: 860 });
  // Log in (Settings → Account), as a new device of the account.
  await w.getByRole("button", { name: "Configurar servidor" }).click();
  await w.getByPlaceholder("https://boni.example.ts.net").fill(`http://127.0.0.1:${PORT}`);
  const form = w.locator(".server-form");
  await form.locator("input").nth(1).fill("ejemplo");
  await form.locator('input[type="password"]').fill(PASSWORD);
  await form.locator("input").nth(3).fill("portatil-ejemplo");
  await w.getByRole("button", { name: "Entrar" }).click();
  await w.keyboard.press("Escape");
  // No pages yet: the welcome; the first page from there.
  await expect(w.locator(".welcome")).toBeVisible();
  await w.locator(".welcome").getByRole("button", { name: "Nueva página" }).click();
  await w.keyboard.type("Mi agenda", { delay: 20 });
  await w.keyboard.press("Enter");
  await w.keyboard.type("/docencia", { delay: 20 });
  await expect(w.locator(".slash-menu")).toContainText("Docencia");
  await w.keyboard.press("Enter");
  const db = w.locator(".db");
  await expect(db.locator(".db-table tbody tr")).toHaveCount(2);
  await shot(w, "table");
  // The calendar: the class today at its time.
  await db.getByRole("radio", { name: "Calendario" }).click();
  await expect(db.locator(".db-cal-day.today")).toContainText("10:00");
  await expect(db.locator(".db-cal-day.today")).toContainText("Clase de ejemplo");
  await shot(w, "calendar");
  // The week, as Boni Calendar's: seven days, every item with its time.
  await db.getByRole("radio", { name: "Semana" }).click();
  await expect(db.locator(".db-cal-grid.week .db-cal-day")).toHaveCount(7);
  await expect(db.locator(".db-cal-day.today")).toContainText("10:00");
  await shot(w, "week");
  await db.getByRole("radio", { name: "Mes" }).click();
  // Opened as a page: its properties and the note's text, written and kept.
  await db.locator(".db-cal-day.today .db-cal-item").first().click();
  // Its text as a page (Juan, 2026-10-22): a paragraph, a heading, a bullet, a to-do.
  const doc = w.locator(".row-doc .doc-editor");
  await expect(doc.locator(".blk-input").first()).toHaveValue(
    "Preparar los ejercicios del tema 3.",
  );
  await expect(doc.locator(".blk-h2 .blk-input")).toHaveValue("Material");
  await expect(doc.locator(".blk-bullet .blk-input")).toHaveValue("Proyector");
  await expect(doc.locator(".blk-todo .blk-input")).toHaveValue("Fotocopias");
  // Written at the end as on a page: a new block, kept as Markdown.
  await doc.locator(".doc-tail").click();
  await w.keyboard.type("Llevar el proyector.", { delay: 15 });
  await shot(w, "row");
  await w.waitForTimeout(1200);
  await w.locator(".topbar .crumb", { hasText: "Mi agenda" }).click();
  await db.locator(".db-cal-day.today .db-cal-item").first().click();
  await expect(doc.locator(".blk-input").last()).toHaveValue("Llevar el proyector.");
  await expect(doc.locator(".blk-h2 .blk-input")).toHaveValue("Material");
});

test("a zone moved into Boni: marked as private, its attachment opened from the app", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Nueva página" }).first().click();
  await w.keyboard.type("Papeles", { delay: 20 });
  await w.keyboard.press("Enter");
  await w.keyboard.type("/documentos", { delay: 20 });
  await expect(w.locator(".slash-menu")).toContainText("Documentos");
  await w.keyboard.press("Enter");
  const db = w.locator(".db").last();
  await expect(db.locator(".protect-pill")).toHaveText("Privada");
  // Locked where it is used: no level lower than Privada from here.
  await db.locator(".protect-pill").click();
  await expect(w.locator(".protect-menu")).toContainText("ábrela desde Colecciones");
  await w.locator(".protect-menu").getByRole("menuitemradio", { name: "Visible" }).click();
  await expect(db.locator(".protect-pill")).toHaveText("Privada");
  await expect(db.locator(".db-table tbody tr")).toHaveCount(2);
  const file = db.getByRole("button", { name: "Abrir archivo: poliza.pdf" });
  await file.click();
  await expect(w.locator(".toast")).toHaveCount(0);
  await shot(w, "zone");
  // Saved in a private temporary folder of its own, with its name and bytes.
  const saved = execFileSync("find", [join(dir, "tmp"), "-name", "poliza.pdf"])
    .toString()
    .trim();
  expect(saved).toContain("boni-files-");
  expect(execFileSync("cat", [saved]).toString()).toBe("%PDF-1.7 inventado");
});

test("Colecciones: every collection, filtered by what the AI sees; private unlocked only on its page", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Colecciones" }).click();
  const table = w.locator(".cols-table");
  await expect(table.locator("tbody tr")).toHaveCount(3); // Docencia, Persona, Documentos
  await w
    .locator(".cols-filter")
    .getByRole("radio", { name: /Privada/ })
    .click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("private/ del vault");
  await shot(w, "collections");
  await w.getByRole("button", { name: "Abrir Documentos" }).click();
  await expect(w.locator(".db-table tbody tr")).toHaveCount(2);
  // On its own page: unlock, choosing the new level and typing its name.
  await w.locator(".col-protect .protect-pill").click();
  await w.locator(".protect-menu").getByRole("menuitemradio", { name: "Desbloquear…" }).click();
  const dialog = w.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Desbloquear" })).toBeDisabled();
  await dialog.locator("select").selectOption("opaque");
  await dialog.locator("input").fill("Documentos");
  await shot(w, "unlock");
  await dialog.getByRole("button", { name: "Desbloquear" }).click();
  await expect(w.locator(".col-protect .protect-pill")).toHaveText("Opaca");
  // And back to private from the list, in one click (raising is never locked).
  await w.locator(".topbar").getByRole("button", { name: "Colecciones" }).click();
  await w.locator(".cols-filter").getByRole("radio", { name: "Todas" }).click();
  const row = table.locator("tbody tr", { hasText: "Documentos" });
  await row.locator(".protect-pill").click();
  await w.locator(".protect-menu").getByRole("menuitemradio", { name: "Privada" }).click();
  await expect(row.locator(".protect-pill")).toHaveText("Privada");
});

test("«Modelos» over the real server: the budget and a key, kept sealed and never shown again", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Modelos" }).click();
  const spend = w.locator("button.kpi").first();
  await expect(spend).toContainText("0,00 €");
  await expect(spend).toContainText("de 10,00 €");
  // The agent is off on this server: no model, and it says so.
  await expect(w.locator(".content.dash")).toContainText("el agente está apagado");
  await spend.click();
  await w.getByRole("button", { name: "Cambiar el presupuesto" }).click();
  await w.getByRole("textbox", { name: "Al mes (€)" }).fill("20");
  await w.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(spend).toContainText("de 20,00 €");
  await w.getByRole("button", { name: /^Claves/ }).click();
  const router = w.locator(".models-conn", { hasText: "OpenRouter" });
  await expect(router).toContainText("Sin clave");
  await router.getByRole("button", { name: "Poner tu clave" }).click();
  await router
    .getByRole("textbox", { name: "Clave de OpenRouter" })
    .pressSequentially("clave-inventada-0003");
  await router.getByRole("button", { name: "Guardar" }).click();
  await expect(router).toContainText("Tu clave");
  await shot(w, "models");
  expect(await w.content()).not.toContain("clave-inventada-0003");
  // Back as it was, for the tests after this one.
  await router.getByRole("button", { name: "Quitar tu clave" }).click();
  await expect(router).toContainText("Sin clave");
});

test("«Actividad» and «Auditoría» over the real server: Juan's read of a private row, the chain verified", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Actividad" }).click();
  await expect(w.locator(".kpi")).toHaveCount(4);
  // The earlier tests changed rows: there are changes, by this device.
  await expect(w.locator(".kpi").nth(2)).not.toContainText(/Cambios\s*0$/);
  await shot(w, "activity");
  await w.getByRole("button", { name: "Abrir la auditoría" }).click();
  const rows = w.locator(".audit-tr:not(.audit-th)");
  await expect(rows.first()).toBeVisible();
  // Opening the private collection's attachment was recorded (Juan's reads of private collections are).
  await expect(rows.filter({ hasText: "Abrió un adjunto" }).first()).toContainText("Tú ·");
  await w.getByRole("button", { name: "Verificar la cadena" }).click();
  await expect(w.locator(".audit-chain.ok")).toHaveText("Cadena verificada");
  await rows.filter({ hasText: "Abrió un adjunto" }).first().click();
  await expect(w.locator(".audit-panel .audit-seen li").first()).toBeVisible();
  await shot(w, "audit");
  await w.keyboard.press("Escape");
});

test("the notes explorer over the real server: the vault's paths, a note's history", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Notas" }).click();
  const tree = w.locator(".notes-tree");
  await expect(tree.getByRole("button", { name: /^registros/ })).toBeVisible();
  await tree.getByRole("button", { name: /^registros/ }).click();
  await tree.getByRole("button", { name: /^personas/ }).click();
  await tree.getByRole("button", { name: /ana-ejemplo\.md/ }).click();
  await expect(w.locator(".topbar .crumbs")).toContainText("Notas");
  await w.getByRole("button", { name: "Historial" }).click();
  const h = w.locator(".history-panel");
  // Imported from the vault: made by the import, its text written by it.
  await expect(h.locator(".history-cols")).toContainText("Creado porImportación");
  await expect(h.locator(".audit-seen").first()).toContainText("Importación · Crear");
  await shot(w, "history");
  await w.keyboard.press("Escape");
  await w.keyboard.press("Escape");
});

test("a part of a collection with its own level: a rule made from Notion's filter", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Colecciones" }).click();
  await w.getByRole("button", { name: "Abrir Docencia" }).click();
  await w.locator(".col-protect .protect-pill").click();
  await w
    .locator(".protect-menu")
    .getByRole("menuitemradio", { name: /Una parte con otro nivel/ })
    .click();
  const dialog = w.getByRole("dialog", { name: /Partes de «Docencia»/ });
  await expect(dialog).toContainText("Ninguna regla");
  await dialog.getByRole("button", { name: "Añadir regla" }).click();
  await dialog.getByRole("combobox", { name: "Propiedad" }).selectOption({ label: "Título" });
  await dialog.getByRole("combobox", { name: "Condición" }).selectOption({ label: "contiene" });
  await dialog.getByRole("textbox", { name: "Valor" }).fill("Tutoría");
  await dialog.locator(".rule-level select").selectOption("restricted");
  await shot(w, "rule");
  // A double click (Juan's report): the rule is saved once.
  await dialog.getByRole("button", { name: "Guardar regla" }).dblclick();
  await expect(dialog.locator(".rule-row")).toHaveCount(1);
  await expect(dialog.locator(".rule-row")).toContainText("Título contiene Tutoría");
  await expect(dialog.locator(".rule-row")).toContainText("Restringida");
  await w.keyboard.press("Escape");
  await expect(w.locator(".col-protect .protect-pill")).toContainText("+1");
});

/** A second start with a link, as the system does: it hands the link to the running app and leaves. */
function openLink(link: string) {
  const bin = process.env.BONI_DESKTOP_BIN;
  const electronBin =
    bin ??
    (createRequire(join(ROOT, "apps", "boni-desktop", "package.json"))("electron") as string);
  execFileSync(
    electronBin,
    [...(bin ? [] : ["."]), `--user-data-dir=${join(dir, "electron")}`, link],
    {
      cwd: join(ROOT, "apps", "boni-desktop"),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: join(dir, "config"),
        XDG_DATA_HOME: join(dir, "data"),
        TMPDIR: join(dir, "tmp"),
      },
      timeout: 20_000,
    },
  );
}

test("the daily copy on this computer: its folder first, then on; a whole zip lands there", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  const real = "/SamsungSSD/Copias/Boni";
  const before = existsSync(real) ? readdirSync(real).length : -1;
  await w.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await w.locator(".settings-nav").getByRole("tab", { name: "Tus datos" }).click();
  await expect(w.locator(".backup-status")).toHaveText("Todavía no hay ninguna");
  // The folder first (never the default one on Juan's disk in a test), then on.
  const copies = join(dir, "copias", "Boni");
  await w.getByRole("button", { name: /^Carpeta/ }).click();
  await w.locator("#backup-dir").fill(copies);
  await w.locator("#backup-dir").press("Enter");
  await expect(w.getByRole("button", { name: /^Carpeta/ })).toContainText(copies);
  await w.getByRole("checkbox", { name: "Copia diaria en este equipo" }).check();
  await expect(w.locator(".backup-status")).not.toHaveText(/Haciendo|Todavía/, { timeout: 30_000 });
  await shot(w, "backup");
  const zips = readdirSync(copies).filter((f) => /^boni-\d{4}-\d{2}-\d{2}\.zip$/.test(f));
  expect(zips).toHaveLength(1);
  expect(readdirSync(copies).some((f) => f.endsWith(".partial"))).toBe(false);
  const files = readZip(readFileSync(join(copies, zips[0] as string)));
  expect(files.has("schema.json")).toBe(true);
  expect([...files.keys()].some((k) => k.startsWith("files/"))).toBe(true); // the attachments too
  await expect(w.locator(".backup-status")).toContainText("MB");
  expect(existsSync(real) ? readdirSync(real).length : -1).toBe(before);
  await w.keyboard.press("Escape");
});

test("a boni:// link opens the note's row in the running app", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Colecciones" }).click();
  const note = `agenda/docencia/${iso(today)} Clase de ejemplo.md`;
  openLink(`boni://note?path=${encodeURIComponent(note)}`);
  await expect(w.locator(".row-doc .blk-input").first()).toHaveValue(
    /Preparar los ejercicios del tema 3/,
  );
  await expect(w.locator(".topbar")).toContainText("Clase de ejemplo");
});

test("a boni:// link with the window closed: the window opens on the note at the first click", async () => {
  const a = app as ElectronApplication;
  const main = () =>
    a.windows().find((x) => !x.url().includes("peek=1") && !x.url().includes("widget="));
  await main()?.close(); // Boni goes on in the tray
  await expect.poll(() => main()).toBeUndefined();
  const note = `agenda/docencia/${iso(today)} Clase de ejemplo.md`;
  openLink(`boni://note?path=${encodeURIComponent(note)}`);
  await expect.poll(() => main()).toBeDefined();
  const w = main() as NonNullable<ReturnType<typeof main>>;
  await expect(w.locator(".row-doc .blk-input").first()).toHaveValue(
    /Preparar los ejercicios del tema 3/,
  );
});

test("Boni Calendar's link with peek=1: a small window with the note; it stays when another window takes the focus, a click in the calendar puts it away", async () => {
  const a = app as ElectronApplication;
  const note = `agenda/docencia/${iso(tomorrow)} Tutoría.md`;
  openLink(`boni://note?path=${encodeURIComponent(note)}&peek=1`);
  const peekPage = async () => {
    for (let i = 0; i < 100; i++) {
      const p = a.windows().find((x) => x.url().includes("peek=1"));
      if (p) return p;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("no peek window");
  };
  const peek = await peekPage();
  await expect(peek.locator(".peek-head")).toContainText("Docencia");
  await expect(peek.locator(".row-title, .doc-title").first()).toHaveValue("Tutoría");
  // The note opens on its text: the properties are folded.
  await expect(peek.locator(".row-props-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(peek.locator(".row-prop")).toHaveCount(0);
  await peek.screenshot({ path: join(SHOTS, "desktop-peek.png") });
  const visible = () =>
    a.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (x) => x.webContents.getURL().includes("peek=1") && x.isVisible(),
      ),
    );
  expect(await visible()).toBe(true);
  // Another window takes the focus (Juan goes to another app): the peek stays (Juan, 2026-10-22).
  await a.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find(
        (x) =>
          !x.webContents.getURL().includes("peek=1") && !x.webContents.getURL().includes("widget="),
      )
      ?.focus(),
  );
  await new Promise((r) => setTimeout(r, 1000));
  expect(await visible()).toBe(true);
  // A click in Boni Calendar sends boni://peek?hide=1: it goes.
  openLink("boni://peek?hide=1");
  await expect.poll(visible).toBe(false);
  // The next one opens again, with its own note.
  openLink(
    `boni://note?path=${encodeURIComponent(`agenda/docencia/${iso(today)} Clase de ejemplo.md`)}&peek=1`,
  );
  await expect.poll(visible).toBe(true);
  await expect(peek.locator(".row-doc .blk-input").first()).toHaveValue(/Preparar los ejercicios/);
  // A hide that arrives just after opening (the same click in the calendar) does not take the new note away.
  openLink("boni://peek?hide=1");
  expect(await visible()).toBe(true);
});
