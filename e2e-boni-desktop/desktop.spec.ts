import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { seed } from "../apps/server/src/seed.test-util.ts";
import { readZip } from "../packages/export/src/zip.ts";
import { BODY, openUserStore } from "../packages/store/src/index.ts";
import { applies, CATALOGUE } from "../packages/views/src/catalogue.ts";

const ROOT = join(import.meta.dirname, "..");
const SHOTS = join(ROOT, "e2e-boni", "screenshots");
const PASSWORD = "una contraseña larga de ejemplo";
const PORT = 18000 + Math.floor(Math.random() * 1000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const tomorrow = new Date(Date.now() + 86_400_000);

/**
 * Invented data with the shapes of Juan's (never real notes), as it came into Boni: the agenda (a calendar),
 * people, belongings, and a folder of the private zone with a note and a PDF.
 */
const DOCENCIA = {
  id: "docencia",
  name: "Docencia",
  folder: "agenda/docencia",
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Hora de inicio", type: "time" },
    { id: "endTime", name: "Hora de fin", type: "time" },
    { id: "completed", name: "Hecha", type: "checkbox" },
  ],
  mapping: {
    title: "title",
    when: { kind: "split", date: "date", startTime: "startTime", endTime: "endTime" },
    task: { column: "completed" },
  },
};
const NOTES: Record<string, string> = {
  [`agenda/docencia/${iso(today)} Clase de ejemplo.md`]: `---\ntitle: "Clase de ejemplo"\ndate: "${iso(today)}"\nstartTime: "10:00"\nendTime: "11:30"\ncompleted: false\n---\nPreparar los ejercicios del tema 3.\n\n## Material\n\n- Proyector\n- [ ] Fotocopias\n`,
  [`agenda/docencia/${iso(tomorrow)} Tutoría.md`]: `---\ntitle: "Tutoría"\ndate: "${iso(tomorrow)}"\nstartTime: "16:00"\ncompleted: false\n---\n`,
  "registros/personas/ana-ejemplo.md":
    "---\ntype: person\nsummary: Invented colleague.\n---\n# Ana\n",
  // Invented belongings: a number, a date and a list (its values become a select's options).
  "registros/pertenencias/cafetera.md": `---\nprecio: 210\ncomprado: "${iso(today)}"\ntipo: [cocina]\nRegalo de: "[[ana-ejemplo]]"\n---\n# Cafetera\n`,
  "registros/pertenencias/cortacesped.md": `---\nprecio: 180\ncomprado: "${iso(today)}"\ntipo: [jardín]\n---\n# Cortacésped\n`,
  "registros/pertenencias/horno.md": `---\nprecio: 240\ncomprado: "${iso(new Date(Date.now() - 86_400_000))}"\ntipo: [cocina]\n---\n# Horno\n`,
  // The private zone (the AI never reads Juan's): a note and a PDF in a folder.
  "private/Documentos/seguro.md": '---\nvence: "2027-01-01"\n---\nPóliza inventada.\n',
  "private/Documentos/poliza.pdf": "%PDF-1.7 inventado",
  // An invented picture (a capture of Boni's own settings) that a belonging's text shows in place.
  "adjuntos/plano.png": readFileSync(join(ROOT, "e2e-boni", "__screens__", "ajustes.png")),
};

let dir = "";
/** The records of the class and the tutorial (links into Boni name a record by its id). */
let classId = "";
let tutorialId = "";
/** A person something points to («Relacionado») and a belonging whose text shows a picture. */
let anaId = "";
let hornoId = "";
let server: ChildProcess | null = null;
let app: ElectronApplication | null = null;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-desktop-"));
  const env = { ...process.env, BONI_DB: join(dir, "boni-calendar.db"), BONI_PASSWORD: PASSWORD };
  execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo"], { cwd: ROOT, env });
  mkdirSync(join(dir, "users"), { recursive: true });
  const store = openUserStore(join(dir, "users", "1.db"));
  const ids = seed(
    store,
    [
      { key: "docencia", name: "Docencia", folder: "agenda/docencia/", calendar: DOCENCIA },
      { key: "persona", name: "Persona", folder: "registros/personas/", thirdParty: true },
      {
        key: "pertenencia",
        name: "Pertenencia",
        folder: "registros/pertenencias/",
        fields: {
          precio: "number",
          comprado: "date",
          tipo: { type: "multiselect" },
          "Regalo de": { type: "relation", to: "persona" },
        },
      },
      { key: "adjuntos", name: "Adjuntos", folder: "adjuntos/", files: true },
      // A folder of the zone, as Juan imported it himself: every type kept from the AI.
      {
        key: "private_documentos",
        name: "Documentos",
        folder: "private/Documentos/",
        sensitivity: "sensitive",
        zone: "private",
        files: true,
        fields: { vence: "date" },
      },
    ],
    NOTES,
  );
  classId = ids.get(`agenda/docencia/${iso(today)} Clase de ejemplo.md`) as string;
  tutorialId = ids.get(`agenda/docencia/${iso(tomorrow)} Tutoría.md`) as string;
  anaId = ids.get("registros/personas/ana-ejemplo.md") as string;
  hornoId = ids.get("registros/pertenencias/horno.md") as string;
  // The oven's text shows the picture by its row's id, as the conversion of the vault's embeds leaves it.
  store.update(
    hornoId,
    {
      [BODY]: {
        value: `Instrucciones del horno.\n\n![plano.png|320](boni:${ids.get("adjuntos/plano.png")})\n`,
        label: store.schema().types.t_pertenencia?.label as never,
      },
    },
    { actor: "user", device: "seed" },
  );
  store.close();
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
  mkdirSync(join(dir, "tmp"));
  app = await launch();
});

/** The desktop app as it runs on Juan's computer, with a profile of its own (never his). */
function launch() {
  const bin = process.env.BONI_DESKTOP_BIN;
  return electron.launch({
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
}

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
  // A new account has only Boni's template pages (the server made them, in the tree's «Boni» branch). The window
  // opens on the first of them, so the branch is unfolded down to it (what is open is lit in the tree); a page of
  // the user's from the sidebar.
  const tree = w.locator(".sidebar");
  await expect(inTree(w).getByRole("button", { name: "Uso de la IA", exact: true })).toBeVisible();
  await expect(inTree(w).getByRole("button", { name: "Actividad", exact: true })).toBeVisible();
  await tree.getByRole("button", { name: "Nueva página" }).first().click();
  await w.keyboard.type("Mi agenda", { delay: 20 });
  await w.keyboard.press("Enter");
  await w.keyboard.type("/docencia", { delay: 20 });
  await expect(w.locator(".slash-menu")).toContainText("Docencia");
  await w.keyboard.press("Enter");
  const db = w.locator(".db");
  await expect(db.locator(".db-table tbody tr")).toHaveCount(2);
  await shot(w, "table");
  // The calendar: the class today at its time. A page's block keeps one view: its tab changes its layout (task 69).
  await db.locator(".db-head").getByRole("button", { name: "Diseño", exact: true }).click();
  await w
    .getByRole("dialog", { name: "Diseño" })
    .getByRole("radio", { name: "Calendario" })
    .click();
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
  await expect(doc.locator(".blk-input").first()).toHaveText("Preparar los ejercicios del tema 3.");
  await expect(doc.locator(".blk-h2 .blk-input")).toHaveText("Material");
  await expect(doc.locator(".blk-bullet .blk-input")).toHaveText("Proyector");
  await expect(doc.locator(".blk-todo .blk-input")).toHaveText("Fotocopias");
  // Written at the end as on a page: a new block, kept as Markdown.
  await doc.locator(".doc-tail").click();
  await w.keyboard.type("Llevar el proyector.", { delay: 15 });
  await shot(w, "row");
  await w.waitForTimeout(1200);
  await w.locator(".topbar .crumb", { hasText: "Mi agenda" }).click();
  await db.locator(".db-cal-day.today .db-cal-item").first().click();
  await expect(doc.locator(".blk-input").last()).toHaveText("Llevar el proyector.");
  await expect(doc.locator(".blk-h2 .blk-input")).toHaveText("Material");
});

test("a page of numbers and charts from a collection: each block's panel from the catalogue, side by side on the grid", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Nueva página" }).first().click();
  await w.keyboard.type("Lectura", { delay: 20 });
  await w.keyboard.press("Enter");
  // From "/": a number, and its panel opens at once.
  await w.keyboard.type("/cifra", { delay: 20 });
  await expect(w.locator(".slash-menu")).toContainText("Cifra");
  await w.keyboard.press("Enter");
  const panel = w.locator(".side-panel");
  await expect(panel.locator("h2")).toHaveText("Cifra");
  const choose = (label: string, option: string) =>
    panel.getByRole("combobox", { name: label, exact: true }).selectOption({ label: option });
  await choose("Colección", "Pertenencia");
  await panel.getByRole("textbox", { name: "Nombre", exact: true }).fill("Cosas");
  await choose("Periodo", "Desde siempre");
  const number = w.locator(".blk-number");
  await expect(number.locator(".kpi-value")).toHaveText("3");
  // Every setting of the catalogue that applies has its control (Juan, 2026-10-24): the sum reveals «De».
  await choose("Qué cuenta", "La suma de…");
  await expect(number.locator(".kpi-value")).toHaveText("630");
  await panel.getByRole("button", { name: "Solo algunas filas" }).click();
  await choose("Solo las filas con", "tipo");
  const kind = CATALOGUE.find((k) => k.type === "number");
  const now = { measure: "sum", filterField: "x" };
  for (const st of kind?.settings ?? [])
    if (applies(st, now))
      await expect(panel.getByText(st.label, { exact: true }).first()).toBeVisible();
  await expect(panel.getByText("Ancho", { exact: true })).toBeVisible();
  await choose("Igual a", "cocina");
  await expect(number.locator(".kpi-value")).toHaveText("450");
  await shot(w, "block-panel");
  await panel.getByRole("button", { name: "Cerrar" }).click();
  // «+» opens the catalogue without typing "/": a bar list after the number.
  await number.hover();
  await number.getByRole("button", { name: "Añadir un bloque" }).click();
  await w.keyboard.type("barras", { delay: 20 });
  await w.keyboard.press("Enter");
  await expect(panel.locator("h2")).toHaveText("Lista de barras");
  await choose("Colección", "Pertenencia");
  await choose("Periodo", "Desde siempre");
  await choose("Agrupar", "tipo");
  const bars = w.locator(".blk-bars");
  await expect(bars).toContainText("cocina");
  await expect(bars).toContainText("jardín");
  await panel.getByRole("button", { name: "Cerrar" }).click();
  // A chart, then the bars dragged beside the number: one row, two columns.
  await bars.hover();
  await bars.getByRole("button", { name: "Añadir un bloque" }).click();
  await w.keyboard.type("gráfica", { delay: 20 });
  await w.locator(".add-menu").getByRole("menuitem", { name: "Gráfica", exact: true }).click();
  await choose("Colección", "Pertenencia");
  await choose("Agrupar", "Por día");
  await choose("Periodo", "Últimos 30 días");
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await expect(w.locator(".blk-graph .chart-card")).toBeVisible();
  const handle = bars.locator(".blk-handle");
  const box = await number.boundingBox();
  if (!box) throw new Error("no number block");
  await handle.dragTo(number, { targetPosition: { x: box.width - 4, y: box.height / 2 } });
  await expect(w.locator(".grid-row").first().locator(".grid-col")).toHaveCount(2);
  // A click on a number lists what it counts (I-04); its menu is the right click's (and its handle's).
  await number.locator(".kpi-value").click();
  await expect(panel.locator("h2")).toHaveText("Lo que cuenta");
  await expect(panel.locator(".rows-panel-count")).toContainText("Pertenencia");
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await number.locator(".kpi-value").click({ button: "right" });
  await w.getByRole("menuitemradio", { name: "Modificar…" }).click();
  await expect(panel.locator("h2")).toHaveText("Cifra");
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await shot(w, "grid");
  // Señalar (F9, task 85) in the real app: with `Ctrl+Shift+E` the number under the pointer is lit and a click takes
  // it to the bar as a chip, by its kind and its name; its own click (it lists what it counts) does nothing.
  await w.keyboard.press("Control+Shift+e");
  await number.hover();
  await expect(number).toHaveAttribute("data-boni-pointed", "");
  await number.locator(".kpi-value").click();
  const boni = w.getByRole("dialog", { name: "Boni" });
  await expect(boni.locator(".chat-pointed:not(.turn-pointed) .chat-chip")).toHaveText([
    "Cifra: Cosas",
  ]);
  await expect(panel).toHaveCount(0);
  await expect(boni.getByRole("textbox", { name: "Escribe a Boni…" })).toBeFocused();
  await shot(w, "pointed");
  // The chip off and the window away, for what comes next.
  await boni.getByRole("button", { name: "Quitar: Cifra: Cosas" }).click();
  await expect(boni.locator(".chat-pointed:not(.turn-pointed) .chat-chip")).toHaveCount(0);
  await w.keyboard.press("Escape");
  await expect(boni).toHaveCount(0);
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
  await expect(w.locator(".protect-menu")).toContainText("abre la colección");
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

test("«Mis datos» over the real server is a collection (F6b): a row per page and collection, filtered by its level; private unlocked only on its page", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  const table = w.locator(".my-data .db-table");
  const line = (name: string) =>
    table.locator("tbody tr", { has: w.getByRole("button", { name, exact: true }) });
  // The user's pages and collections, and Boni's own after them (never deleted nor renamed here).
  await expect(line("Pertenencia")).toContainText("Colección");
  await expect(line("Llamadas a modelos")).toContainText("De Boni");
  await expect(line("Llamadas a modelos").getByRole("button", { name: /^Borrar/ })).toHaveCount(0);
  // Filtered as any collection: «Nivel es Privada».
  // The head's «Filtro» shows the bar with «+ Filtro» open; the property, then its value in its chip (task 69).
  await w.locator(".db-head").getByRole("button", { name: "Filtro", exact: true }).click();
  await w
    .getByRole("dialog", { name: "Añadir filtro" })
    .getByRole("menuitemradio", { name: "Nivel", exact: true })
    .click();
  await w.getByRole("combobox", { name: "Valor" }).selectOption({ label: "Privada" });
  await w.keyboard.press("Escape");
  await expect(line("Documentos")).toHaveCount(1);
  await expect(line("Pertenencia")).toHaveCount(0);
  await shot(w, "collections");
  // Opened: its own page, where it is unlocked, choosing the new level and typing its name.
  await line("Documentos").getByRole("button", { name: "Documentos", exact: true }).click();
  await expect(w.locator(".db-table tbody tr")).toHaveCount(2);
  await w.locator(".col-protect .protect-pill").click();
  await w.locator(".protect-menu").getByRole("menuitemradio", { name: "Desbloquear…" }).click();
  const dialog = w.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Desbloquear" })).toBeDisabled();
  await dialog.locator("select").selectOption("opaque");
  await dialog.locator("input").fill("Documentos");
  await shot(w, "unlock");
  await dialog.getByRole("button", { name: "Desbloquear" }).click();
  await expect(w.locator(".col-protect .protect-pill")).toHaveText("Opaca");
  await expect(dialog).toHaveCount(0);
  // Back in «Mis datos» (its filter kept), without it, and private again from its «Nivel», in one click (raising
  // is never locked); lowering it there says where it is done.
  await w.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await w.locator(".db-bar").getByRole("button", { name: "Nivel es Privada" }).click();
  await w.getByRole("button", { name: "Quitar filtro" }).click();
  await line("Documentos").locator("td").nth(4).locator(".db-cell").click();
  await w.getByRole("menu").getByText("Privada", { exact: true }).click();
  await expect(line("Documentos")).toContainText("Privada");
  await line("Documentos").locator("td").nth(4).locator(".db-cell").click();
  await w.getByRole("menu").getByText("Visible", { exact: true }).click();
  await expect(w.locator(".toast")).toContainText("solo se abre a la IA desde su página");
  await expect(line("Documentos")).toContainText("Privada");
});

test("Ajustes → Modelos over the real server: the budget and a key, kept sealed and never shown again", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  // What configures the models is in Ajustes again (docs/sistema.md §4.4: «Modelos» left «Flujos»).
  await w.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await w.locator(".modal").getByRole("tab", { name: "Modelos" }).click();
  // The agent is off on this server: no use's card, the spending and the keys still.
  const spend = w.locator(".modal .kpi").first();
  await expect(spend).toContainText("0,00 €");
  await expect(spend).toContainText("de 10,00 €");
  // The agent is off on this server: no model, and it says so.
  await expect(w.locator(".models-settings")).toContainText("el agente está apagado");
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
  await w.keyboard.press("Escape");
  await expect(w.locator(".modal")).toHaveCount(0);
});

test("«Flujos» over the real server is a collection (F8): «Nuevo» makes a flow by hand and opens it; the map, computed, puts it in the centre", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await expect(w.getByRole("tab", { name: "Tabla" })).toBeVisible();
  // Boni's own «Aviso del presupuesto» is among the account's flows from the start (D-53): what starts it, on.
  const budget = w.locator(".db-table tbody tr", { hasText: "Aviso del presupuesto" });
  await expect(budget).toContainText("El gasto llega al aviso");
  await expect(budget).toContainText("Encendido");
  await w.locator(".db-head").getByRole("button", { name: "Nuevo" }).click();
  // A new flow opens on its own page, by hand and off.
  await expect(w.locator(".flow-crumbs")).toContainText("Nuevo flujo");
  await expect(w.locator(".flow-editor .fl-node.source")).toContainText("Disparado por el usuario");
  await w.locator(".flow-crumbs").getByRole("button", { name: "Flujos" }).click();
  await expect(w.locator(".db-table tbody tr", { hasText: "Nuevo flujo" })).toContainText(
    "Apagado",
  );
  // The map from the server's journal and audit. What Boni tells is on the whole of it (A-16): its «Aviso del
  // presupuesto», which reads and writes no collection, joined to «Dispositivos» by «avisa».
  await w.getByRole("tab", { name: "Mapa" }).click();
  await expect(w.locator(".mp-card", { hasText: "Aviso del presupuesto" })).toBeVisible();
  await expect(w.locator(".mp-card", { hasText: "Dispositivos" })).toBeVisible();
  // The new flow, found by name and put in the centre.
  await w.getByRole("combobox", { name: "Buscar en el mapa" }).click();
  await w.keyboard.type("Nuevo flujo", { delay: 10 });
  await w.keyboard.press("Enter");
  await expect(w.locator(".mp-centre")).toContainText("Nuevo flujo");
  await expect(w.locator(".mp-card", { hasText: "Nuevo flujo" })).toBeVisible();
  await shot(w, "flows-map");
  // Back as it was for the tests after this one: the table, and the flow gone.
  await w.getByRole("tab", { name: "Tabla" }).click();
  await w.locator(".db-table tbody tr", { hasText: "Nuevo flujo" }).click({ button: "right" });
  await w.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(w.locator(".db-table tbody tr", { hasText: "Nuevo flujo" })).toHaveCount(0);
});

test("Boni's template pages over the real server: counted from its records, modified, restored", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  // The server made them for the account (seedTemplates): «Actividad» counts what the earlier tests changed.
  await inTree(w).getByRole("button", { name: "Actividad", exact: true }).click();
  const changes = w.locator(".blk-number").nth(1);
  await expect(changes.locator(".kpi-value")).not.toHaveText(/^(—|0)$/);
  await changes.click();
  const panel = w.locator(".side-panel");
  await expect(panel.locator(".rows-panel-count")).toContainText("Actividad de Boni");
  await expect(panel.locator(".rows-panel-list li", { hasText: "Tú · " }).first()).toBeVisible();
  await shot(w, "activity-rows");
  await w.keyboard.press("Escape");
  // «Actividad», modified: still so after another visit, then Boni's again.
  await inTree(w).getByRole("button", { name: "Actividad", exact: true }).click();
  const pill = w.locator(".template-head .system-pill");
  await expect(pill).toHaveText("De Boni");
  await w.locator(".blk-link").click({ button: "right" });
  await w.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(pill).toHaveText("Modificada");
  await w.waitForTimeout(1200);
  await inTree(w).getByRole("button", { name: "Uso de la IA", exact: true }).click();
  await inTree(w).getByRole("button", { name: "Actividad", exact: true }).click();
  await expect(pill).toHaveText("Modificada");
  await expect(w.locator(".blk-link")).toHaveCount(0);
  await pill.click();
  await w.getByRole("button", { name: "Restaurar la de Boni" }).click();
  await expect(pill).toHaveText("De Boni");
  await expect(w.locator(".blk-link")).toHaveCount(1);
});

test("«Registro» and «Auditoría» over the real server: Juan's read of a private row, the chain verified", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await inTree(w).getByRole("button", { name: "Registro", exact: true }).click();
  await expect(w.locator(".db-table")).toContainText("Fecha");
  await expect(w.locator(".db-table")).toContainText("Estado");
  await shot(w, "activity");
  await w.locator(".sidebar").getByRole("button", { name: "Conversación" }).click();
  await w.locator(".chat-tools").getByRole("button", { name: "Auditoría" }).click();
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

test("«Mis datos» over the real server: a collection opened, its notes, a note's history", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  // Docencia has fields of its own: its notes are not in the sidebar; «Mis datos» opens it, and it them.
  await w
    .locator(".my-data .db-table")
    .getByRole("button", { name: "Docencia", exact: true })
    .click();
  await w
    .locator(".db-table")
    .getByRole("button", { name: "Clase de ejemplo", exact: true })
    .click();
  await expect(w.locator(".topbar .crumbs")).toContainText("Docencia");
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
  await w.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await w
    .locator(".my-data .db-table")
    .getByRole("button", { name: "Docencia", exact: true })
    .click();
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

/** The sidebar's «Páginas»: the user's pages, the tree of collections and Boni's branch. */
function inTree(w: Page) {
  return w.locator(".sidebar").getByRole("list", { name: "Páginas" });
}

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

test("a boni:// link opens a record by its id in the running app", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  openLink(`boni://note?id=${classId}`);
  await expect(w.locator(".row-doc .blk-input").first()).toHaveText(
    /Preparar los ejercicios del tema 3/,
  );
  await expect(w.locator(".topbar")).toContainText("Clase de ejemplo");
});

test("a record says what points to it («Relacionado»), and a note's text shows a picture in place", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  openLink(`boni://note?id=${anaId}`);
  const related = w.locator(".row-related-toggle");
  await expect(related).toContainText("Pertenencia 1");
  await expect(w.locator(".row-related")).toHaveCount(0);
  await related.click();
  await expect(w.locator(".row-related")).toContainText("en «Regalo de»");
  // Each group folds by its name (Juan, 2026-10-30).
  const group = w.locator(".row-related-head", { hasText: "Pertenencia" });
  await group.click();
  await expect(w.locator(".row-related-row")).toHaveCount(0);
  await group.click();
  await w.locator(".row-related-row", { hasText: "Cafetera" }).click();
  await expect(w.locator(".row-title, .doc-title").first()).toHaveValue("Cafetera");
  // The collection keeps it open for all its rows: back on Ana, there it is.
  openLink(`boni://note?id=${anaId}`);
  await expect(w.locator(".row-related-row", { hasText: "Cafetera" })).toBeVisible();
  // The picture comes through the app's own channel to the server (no address of the server in the page).
  openLink(`boni://note?id=${hornoId}`);
  const img = w.locator(".doc-file-image img");
  await expect(img).toBeVisible();
  expect(await img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);
  await expect(w.locator(".doc-file-image figcaption")).toHaveText("plano.png");
  await shot(w, "related-and-picture");
});

test("a boni:// link with the window closed: the window opens on the note at the first click", async () => {
  const a = app as ElectronApplication;
  const main = () =>
    a.windows().find((x) => !x.url().includes("peek=1") && !x.url().includes("widget="));
  await main()?.close(); // Boni goes on in the tray
  await expect.poll(() => main()).toBeUndefined();
  openLink(`boni://note?id=${classId}`);
  await expect.poll(() => main()).toBeDefined();
  const w = main() as NonNullable<ReturnType<typeof main>>;
  await expect(w.locator(".row-doc .blk-input").first()).toHaveText(
    /Preparar los ejercicios del tema 3/,
  );
});

test("Boni Calendar's link with peek=1: a small window with the note; it stays when another window takes the focus, a click in the calendar puts it away", async () => {
  const a = app as ElectronApplication;
  openLink(`boni://note?id=${tutorialId}&peek=1`);
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
  // The note opens with its properties unfolded (Juan, 2026-11-02; D-21), its text under them.
  await expect(peek.locator(".row-props-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(peek.locator(".row-prop").first()).toBeVisible();
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
  openLink(`boni://note?id=${classId}&peek=1`);
  await expect.poll(visible).toBe(true);
  await expect(peek.locator(".row-doc .blk-input").first()).toHaveText(/Preparar los ejercicios/);
  // A hide that arrives just after opening (the same click in the calendar) does not take the new note away.
  openLink("boni://peek?hide=1");
  expect(await visible()).toBe(true);
});

test("the page opens a note in the peek, a window of its own (a mail from the conversation, task 30); nothing else", async () => {
  const a = app as ElectronApplication;
  const visible = () =>
    a.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (x) => x.webContents.getURL().includes("peek=1") && x.isVisible(),
      ),
    );
  // A peek shown a moment ago keeps a hide from the same click: wait that moment out.
  await new Promise((r) => setTimeout(r, 1000));
  openLink("boni://peek?hide=1");
  await expect.poll(visible).toBe(false);
  const main = a.windows().find((x) => !x.url().includes("peek=1") && !x.url().includes("widget="));
  if (!main) throw new Error("no main window");
  const open = (screen: string) =>
    main.evaluate(
      (s) =>
        (
          window as unknown as { boniDesktop: { openPeek: (x: string) => void } }
        ).boniDesktop.openPeek(s),
      screen,
    );
  // Only a note or a proposal by a plain id: anything else is refused by the shell.
  await open("settings");
  await open("note:../secreto");
  await new Promise((r) => setTimeout(r, 800));
  expect(await visible()).toBe(false);
  await open(`note:${classId}`);
  await expect.poll(visible).toBe(true);
  const peek = a.windows().find((x) => x.url().includes("peek=1"));
  if (!peek) throw new Error("no peek window");
  await expect(peek.locator(".row-doc .blk-input").first()).toHaveText(/Preparar los ejercicios/);
  await new Promise((r) => setTimeout(r, 1000));
  openLink("boni://peek?hide=1");
  await expect.poll(visible).toBe(false);
});

test("in the peek, Esc first leaves the text with its block selected, then lets go, then puts the peek away", async () => {
  const a = app as ElectronApplication;
  openLink(`boni://note?id=${classId}&peek=1`);
  const peek = await (async () => {
    for (let i = 0; i < 100; i++) {
      const p = a.windows().find((x) => x.url().includes("peek=1"));
      if (p) return p;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("no peek window");
  })();
  const visible = () =>
    a.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (x) => x.webContents.getURL().includes("peek=1") && x.isVisible(),
      ),
    );
  await expect.poll(visible).toBe(true);
  await peek.locator(".row-doc .blk-input").first().click();
  await peek.keyboard.press("Escape");
  await expect(peek.locator(".blk.selected")).toHaveCount(1);
  expect(await visible()).toBe(true);
  await peek.keyboard.press("Escape");
  await expect(peek.locator(".blk.selected")).toHaveCount(0);
  expect(await visible()).toBe(true);
  await peek.keyboard.press("Escape");
  await expect.poll(visible).toBe(false);
});

test("formats in the peek (task 2f): words selected, the menu over them; Ctrl+B paints them bold, kept as Markdown and painted again when the note opens", async () => {
  const a = app as ElectronApplication;
  const visible = () =>
    a.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (x) => x.webContents.getURL().includes("peek=1") && x.isVisible(),
      ),
    );
  await new Promise((r) => setTimeout(r, 1000));
  openLink(`boni://note?id=${tutorialId}&peek=1`);
  await expect.poll(visible).toBe(true);
  const peek = a.windows().find((x) => x.url().includes("peek=1"));
  if (!peek) throw new Error("no peek window");
  await expect(peek.locator(".row-title, .doc-title").first()).toHaveValue("Tutoría");
  const doc = peek.locator(".row-doc .doc-editor");
  await doc.locator(".doc-tail").click();
  await peek.keyboard.type("Una idea suelta", { delay: 15 });
  const line = doc.locator(".blk-input").first();
  await expect(line).toHaveText("Una idea suelta");
  await peek.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await peek.keyboard.press("ArrowRight");
  for (let i = 0; i < 4; i++) await peek.keyboard.press("Shift+ArrowRight");
  const bar = peek.getByRole("toolbar", { name: "Formato" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Negrita" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await peek.keyboard.press("Control+b");
  await expect(line.locator(".md-strong")).toHaveText("idea");
  await expect(bar.getByRole("button", { name: "Negrita" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await peek.screenshot({ path: join(SHOTS, "desktop-peek-format.png") });
  // Kept: the peek put away and opened again, the note's Markdown comes back bold, its marks hidden away from the caret.
  await new Promise((r) => setTimeout(r, 1200));
  openLink("boni://peek?hide=1");
  await expect.poll(visible).toBe(false);
  openLink(`boni://note?id=${classId}&peek=1`);
  await expect(peek.locator(".row-title, .doc-title").first()).toHaveValue("Clase de ejemplo");
  await new Promise((r) => setTimeout(r, 1000));
  openLink(`boni://note?id=${tutorialId}&peek=1`);
  await expect(peek.locator(".row-title, .doc-title").first()).toHaveValue("Tutoría");
  const again = peek.locator(".row-doc .blk-input").first();
  await expect(again.locator(".md-strong")).toHaveText("idea");
  await expect(again).toHaveText("Una **idea** suelta");
  await expect(again.locator(".md-mark.md-hide")).toHaveCount(2);
  await new Promise((r) => setTimeout(r, 1000));
  openLink("boni://peek?hide=1");
  await expect.poll(visible).toBe(false);
});

test("a picture pasted into a note is kept in Boni (in its only collection of files a model may see) and shown in place", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  openLink(`boni://note?id=${hornoId}`);
  await expect(w.locator(".doc-file-image img")).toHaveCount(1);
  await w.locator(".row-doc .blk-input").first().click();
  await w.keyboard.press("End");
  await w.evaluate(
    (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "pegada.png", { type: "image/png" }));
      document.activeElement?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    readFileSync(join(ROOT, "e2e-boni", "__screens__", "registro.png")).toString("base64"),
  );
  await expect(w.locator(".doc-file-image img")).toHaveCount(2);
  await expect(w.locator(".doc-file-image figcaption").first()).toHaveText("pegada.png");
  expect(
    await w
      .locator(".doc-file-image img")
      .first()
      .evaluate((i) => (i as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(100);
});

test("Apariencia › Tamaño and Ctrl+0: the windows' zoom, kept in this computer's settings", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  const width = await w.evaluate(() => window.innerWidth);
  await w.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await w.getByRole("tab", { name: "Apariencia" }).click();
  await w.getByRole("button", { name: "Más grande (Ctrl++)" }).click();
  // Bigger: the same window holds fewer CSS pixels.
  await expect.poll(() => w.evaluate(() => window.innerWidth)).toBeLessThan(width);
  await expect(w.getByTitle("Tamaño normal (Ctrl+0)")).toHaveText("110 %");
  await w.keyboard.press("Control+0");
  await expect.poll(() => w.evaluate(() => window.innerWidth)).toBe(width);
  await expect(w.getByTitle("Tamaño normal (Ctrl+0)")).toHaveText("100 %");
  await w.keyboard.press("Escape");
});

test("Boni's window after a restart (F9, task 85, I-35): where Juan dragged it, floating, with the last conversation and its draft", async () => {
  let w = await (app as ElectronApplication).firstWindow();
  const win = (p: Page) => p.getByRole("dialog", { name: "Boni" });
  if (!(await win(w).isVisible())) await w.keyboard.press("Control+e");
  const box = (p: Page) => win(p).getByRole("textbox", { name: "Escribe a Boni…" });
  await expect(box(w)).toBeFocused();
  // A conversation of its own: its first message makes it (there is no model here).
  await box(w).fill("¿qué hay hoy?");
  await box(w).press("Enter");
  await expect(win(w).locator(".turn-request").last()).toHaveText("¿qué hay hoy?");
  await expect(win(w).getByRole("button", { name: "Enviar" })).toBeVisible();
  // Dragged by its bar to the left and up, then a message begun.
  const placed = async (p: Page) => {
    await expect.poll(async () => Math.round((await win(p).boundingBox())?.width ?? 0)).toBe(400);
    const b = await win(p).boundingBox();
    const view = await p.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    // From the bottom right, as it is kept: the app's window may start at another size.
    return {
      right: Math.round(view.width - (b?.x ?? 0) - (b?.width ?? 0)),
      bottom: Math.round(view.height - (b?.y ?? 0) - (b?.height ?? 0)),
    };
  };
  const from = await placed(w);
  const title = await win(w).locator(".boni-window-head h2").boundingBox();
  if (!title) throw new Error("no bar");
  await w.mouse.move(title.x + 10, title.y + title.height / 2);
  await w.mouse.down();
  await w.mouse.move(title.x - 290, title.y + title.height / 2 - 120, { steps: 12 });
  await w.mouse.up();
  const here = await placed(w);
  expect(here).toEqual({ right: from.right + 300, bottom: from.bottom + 120 });
  await box(w).fill("y lo de mañana");
  // On this computer's own files (a preference of the device, never the account's), a moment after the last key.
  const file = join(dir, "data", "boni", "store", "boni-window.json");
  await expect
    .poll(() => (existsSync(file) ? readFileSync(file, "utf8") : ""))
    .toContain("y lo de mañana");
  // Kept under the conversation its first message made (the server keeps no turn without a model: e2e-boni shows
  // the turns coming back).
  const kept = JSON.parse(readFileSync(file, "utf8"));
  expect(kept).toMatchObject({ mode: "float", place: here, conversation: expect.any(String) });
  expect(kept.drafts[kept.conversation].text).toBe("y lo de mañana");
  // The app quit and started again.
  await (app as ElectronApplication).close();
  app = await launch();
  w = await app.firstWindow();
  await expect(win(w)).toBeVisible({ timeout: 20_000 });
  expect(await placed(w)).toEqual(here);
  // The same conversation: its draft is the one shown (each conversation has its own).
  await expect(box(w)).toHaveValue("y lo de mañana");
  // Juan goes on writing where he left off: the caret is after the draft, not before it (task 97: with it at the
  // start, a key pressed on this screen as the window came back made it « y lo de mañana»).
  await expect(box(w)).toBeFocused();
  await w.keyboard.type(" y el jueves", { delay: 40 });
  await expect(box(w)).toHaveValue("y lo de mañana y el jueves");
  await shot(w, "window-restarted");
  // As it was found by the next test: closed.
  await box(w).press("Escape");
  await expect(win(w)).toHaveCount(0);
});

test("a pinned conversation stays on top after a restart, from the server (task 27, task 63 point 7)", async () => {
  let w = await (app as ElectronApplication).firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Conversación" }).click();
  const list = (p: Page) => p.getByRole("navigation", { name: "Conversaciones" });
  const show = w.getByRole("button", { name: "Mostrar las conversaciones" });
  if (await show.isVisible()) await show.click();
  // The conversation the window's test made (its first message), named and pinned as Juan would.
  const item = list(w).locator(".chat-item").first();
  await expect(item).toBeVisible();
  await item.hover();
  await item.getByRole("button", { name: "Cambiar el nombre" }).click();
  const name = list(w).getByRole("textbox", { name: "Cambiar el nombre" });
  await name.fill("Viaje a Lisboa");
  await name.press("Enter");
  const pinned = (p: Page) => list(p).locator(".chat-group").filter({ hasText: "Fijadas" });
  await expect(pinned(w)).toHaveCount(0);
  const named = list(w).locator(".chat-item").filter({ hasText: "Viaje a Lisboa" });
  await named.hover();
  await named.getByRole("button", { name: "Fijar", exact: true }).click();
  await expect(pinned(w).locator(".chat-item")).toHaveText(["Viaje a Lisboa"]);
  await expect(list(w).locator(".chat-group").first()).toContainText("Fijadas");
  // The app quit and started again: the pin is the conversation's, on the server, not this window's.
  await (app as ElectronApplication).close();
  app = await launch();
  w = await app.firstWindow();
  await w.locator(".sidebar").getByRole("button", { name: "Conversación" }).click();
  await expect(list(w).locator(".chat-group").first()).toContainText("Fijadas", {
    timeout: 20_000,
  });
  await expect(pinned(w).locator(".chat-item")).toHaveText(["Viaje a Lisboa"]);
  await shot(w, "chats-pinned");
  // Unpinned, it goes back among the rest.
  const again = pinned(w).locator(".chat-item").first();
  await again.hover();
  await again.getByRole("button", { name: "Dejar de fijar" }).click();
  await expect(pinned(w)).toHaveCount(0);
});
