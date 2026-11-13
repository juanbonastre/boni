// What is typed in Boni's desktop app and closed at once is not lost (task 100): each way of writing that saves on
// its own path, typed and the app closed the moment after the last key, then opened again and read there.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Browser,
  chromium,
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { seed } from "../apps/server/src/seed.test-util.ts";

const ROOT = join(import.meta.dirname, "..");
const PASSWORD = "una contraseña larga de ejemplo";
const PORT = 19000 + Math.floor(Math.random() * 1000);

let dir = "";
let server: ChildProcess | null = null;
let app: ElectronApplication | null = null;
let noteId = "";
let longId = "";
let pictureId = "";

function startServer() {
  const env = { ...process.env, BONI_DB: join(dir, "boni-calendar.db"), BONI_PASSWORD: PASSWORD };
  server = spawn("node", ["apps/server/src/main.ts"], {
    cwd: ROOT,
    env: {
      ...env,
      BONI_PORT: String(PORT),
      BONI_WRITE: "1",
      ANTHROPIC_API_KEY: "",
      // Boni's web app, for the phone-sized browser below (the desktop app carries its own).
      BONI_BONI_WEB: join(ROOT, "apps", "boni-web", "dist"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 20_000);
    server?.stdout?.on("data", (b: Buffer) => {
      if (b.toString().includes(`127.0.0.1:${PORT}`)) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

const desktopEnv = () => ({
  ...process.env,
  XDG_CONFIG_HOME: join(dir, "config"),
  XDG_DATA_HOME: join(dir, "data"),
  TMPDIR: join(dir, "tmp"),
});

async function launch() {
  const bin = process.env.BONI_DESKTOP_BIN;
  const a = await electron.launch({
    cwd: join(ROOT, "apps", "boni-desktop"),
    ...(bin ? { executablePath: bin } : {}),
    args: [...(bin ? [] : ["."]), `--user-data-dir=${join(dir, "electron")}`],
    env: desktopEnv(),
  });
  const say = (b: Buffer) => process.stdout.write(`[boni] ${b}`);
  a.process().stdout?.on("data", say);
  a.process().stderr?.on("data", say);
  return a;
}

/** `p`, or an error saying what did not end in `ms`. */
const within = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what}: not in ${ms} ms`)), ms),
    ),
  ]);

/** A second start (with a link, or none: «Abrir Boni»), as the system does: it hands it to the running app and leaves. */
function openLink(link?: string) {
  const bin = process.env.BONI_DESKTOP_BIN;
  const electronBin =
    bin ??
    (createRequire(join(ROOT, "apps", "boni-desktop", "package.json"))("electron") as string);
  const args = [
    ...(bin ? [] : ["."]),
    `--user-data-dir=${join(dir, "electron")}`,
    ...(link ? [link] : []),
  ];
  execFileSync(electronBin, args, {
    cwd: join(ROOT, "apps", "boni-desktop"),
    env: desktopEnv(),
    timeout: 20_000,
  });
}

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-closing-"));
  const env = { ...process.env, BONI_DB: join(dir, "boni-calendar.db"), BONI_PASSWORD: PASSWORD };
  execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo"], { cwd: ROOT, env });
  mkdirSync(join(dir, "users"), { recursive: true });
  const { BODY, openUserStore } = await import("../packages/store/src/index.ts");
  const store = openUserStore(join(dir, "users", "1.db"));
  const ids = seed(
    store,
    [
      { key: "apunte", name: "Apuntes", folder: "apuntes/", fields: { lugar: "text" } },
      { key: "adjuntos", name: "Adjuntos", folder: "adjuntos/", files: true },
    ],
    {
      "adjuntos/plano.png": readFileSync(join(ROOT, "e2e-boni", "__screens__", "ajustes.png")),
      "apuntes/Con imagen de ejemplo.md": '---\nlugar: "Casa"\n---\nUna imagen.\n',
      "apuntes/Reunión de ejemplo.md": '---\nlugar: "Sala 1"\n---\nPrimera línea.\n',
      // A long note, as some of Juan's are (A-15).
      "apuntes/Diario de ejemplo.md": `---\nlugar: "Casa"\n---\n${Array.from({ length: 1500 }, (_, i) => `Línea ${i + 1} del diario de ejemplo.`).join("\n\n")}\n`,
    },
  );
  noteId = ids.get("apuntes/Reunión de ejemplo.md") as string;
  longId = ids.get("apuntes/Diario de ejemplo.md") as string;
  pictureId = ids.get("apuntes/Con imagen de ejemplo.md") as string;
  // Its text shows the picture by its row's id (task 2h: an image grown by its corner, then Boni closed at once).
  store.update(
    pictureId,
    {
      [BODY]: {
        value: `Una imagen.\n\n![plano.png](boni:${ids.get("adjuntos/plano.png")})\n`,
        label: store.schema().types.t_apunte?.label as never,
      },
    },
    { actor: "user", device: "seed" },
  );
  store.close();
  await startServer();
  mkdirSync(join(dir, "tmp"));
  app = await launch();
  const w = await app.firstWindow();
  await w.setViewportSize({ width: 1280, height: 860 });
  await w.getByRole("button", { name: "Configurar servidor" }).click();
  await w.getByPlaceholder("https://boni.example.ts.net").fill(`http://127.0.0.1:${PORT}`);
  const form = w.locator(".server-form");
  await form.locator("input").nth(1).fill("ejemplo");
  await form.locator('input[type="password"]').fill(PASSWORD);
  await form.locator("input").nth(3).fill("portatil-ejemplo");
  await w.getByRole("button", { name: "Entrar" }).click();
  await w.keyboard.press("Escape");
  await expect(
    w.locator(".sidebar").getByRole("button", { name: "Nueva página" }).first(),
  ).toBeVisible();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  server?.kill("SIGCONT");
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

type Close = "quit" | "tray" | "signal" | "sigint" | "window";

/**
 * Closes Boni as Juan can and opens it again: quitting (app.quit; Boni desktop has no Ctrl+Q), the tray menu's
 * «Salir» itself (its item clicked, as the system's tray does), a signal from the system (SIGTERM: a log-out, a
 * shutdown; SIGINT: Ctrl+C in a terminal), or the window alone (Boni goes on in the tray; «Abrir Boni» brings it
 * back). Returns how long the app took to end, for a quit or a signal.
 */
async function close(how: Close): Promise<number> {
  const a = app as ElectronApplication;
  if (how === "window") {
    await a.evaluate(({ BrowserWindow }) => {
      for (const b of BrowserWindow.getAllWindows()) if (b.getTitle() === "Boni") b.close();
    });
    await expect
      .poll(() =>
        a.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((b) => b.getTitle() === "Boni"),
        ),
      )
      .toBe(false);
    openLink();
    return 0;
  }
  const done = new Promise<void>((resolve) => a.process().once("exit", () => resolve()));
  const from = Date.now();
  if (how === "quit") void a.evaluate(({ app: e }) => e.quit()).catch(() => undefined);
  else if (how === "tray")
    // The tray's menu as Boni builds it (rebuilt when the page sends its labels), and its «Salir» clicked.
    void a
      .evaluate(({ ipcMain, Tray }) => {
        const set = Tray.prototype.setContextMenu;
        Tray.prototype.setContextMenu = function (this: InstanceType<typeof Tray>, menu) {
          Tray.prototype.setContextMenu = set;
          set.call(this, menu);
          const quit = menu?.items.find((i) => i.label === "Salir");
          if (!quit) throw new Error("no «Salir» in the tray's menu");
          quit.click();
        };
        ipcMain.emit("shell:labels", {}, {});
      })
      .catch(() => undefined);
  else a.process().kill(how === "sigint" ? "SIGINT" : "SIGTERM");
  await within(done, 20_000, `Boni ending (${how})`);
  const took = Date.now() - from;
  app = await launch();
  return took;
}

const inTree = (w: Page) => w.locator(".sidebar").getByRole("list", { name: "Páginas" });

/** Boni's main window (the one with the sidebar; the widgets' and the peek's are others). */
async function main(): Promise<Page> {
  const a = app as ElectronApplication;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const p of a.windows()) {
      if (p.isClosed()) continue;
      const has = await within(
        p.evaluate(() => Boolean(document.querySelector(".sidebar"))),
        1000,
        "a window's page",
      ).catch(() => false);
      if (has) return p;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Boni's main window did not open");
}

const PACES = [
  { name: "no pause", delay: 0 },
  { name: "a person's pace", delay: 60 },
] as const;
/**
 * Quitting, a signal and the window alone are tried at both paces; the tray's «Salir» (the same quit, from its menu)
 * at a person's, and SIGINT (the same as SIGTERM to Electron) with no pause.
 */
const WAYS: { how: Close; paces: readonly (typeof PACES)[number][] }[] = [
  { how: "quit", paces: PACES },
  { how: "tray", paces: [PACES[1]] },
  { how: "signal", paces: PACES },
  { how: "sigint", paces: [PACES[0]] },
  { how: "window", paces: PACES },
];

/** A page's lines of text (TextRun.tsx): each block's text in the page's blocks (a page has no `.doc-editor`, a note's own). */
const pageText = (w: Page) => w.locator(".doc-blocks .blk-input");
const unsentFile = () => join(dir, "data", "boni", "store", "unsent.json");
const unsentText = () => (existsSync(unsentFile()) ? readFileSync(unsentFile(), "utf8") : "");

async function openNote(w: Page, id = noteId) {
  openLink(`boni://note?id=${id}`);
  await expect(w.locator(".row-doc .doc-title")).toBeVisible({ timeout: 20_000 });
}

async function lugar(w: Page) {
  const prop = w.locator(".row-prop").filter({ hasText: "lugar" });
  if (!(await prop.isVisible())) await w.locator(".row-props-toggle").first().click();
  return prop;
}

async function newPage(w: Page, title: string, text: string, delay = 0) {
  await w.locator(".sidebar").getByRole("button", { name: "Nueva página" }).first().click();
  await w.keyboard.type(title, { delay });
  await w.keyboard.press("Enter");
  await w.keyboard.type(text, { delay });
}

for (const { how, paces } of WAYS) {
  for (const pace of paces) {
    const tag = `${how} ${pace.delay}`;
    test(`a page's text, typed at ${pace.name} and Boni closed at once (${how}): there when it opens again`, async () => {
      let w = await main();
      const title = `Página ${tag}`;
      await newPage(w, title, `Escrito ${tag}`, pace.delay);
      await close(how);
      w = await main();
      await inTree(w).getByRole("button", { name: title, exact: true }).click();
      await expect(pageText(w).first()).toHaveText(`Escrito ${tag}`);
    });

    test(`a note's text, typed at ${pace.name} and Boni closed at once (${how})`, async () => {
      let w = await main();
      await openNote(w);
      const doc = w.locator(".row-doc .doc-editor");
      await expect(doc.locator(".blk-input").first()).toBeVisible();
      await doc.locator(".doc-tail").click();
      await w.keyboard.type(`Texto ${tag}`, { delay: pace.delay });
      await close(how);
      w = await main();
      await openNote(w);
      await expect(w.locator(".row-doc .doc-editor .blk-input").last()).toHaveText(`Texto ${tag}`);
    });

    test(`a note's title, typed at ${pace.name} and Boni closed at once (${how})`, async () => {
      let w = await main();
      await openNote(w);
      await w.locator(".row-doc .doc-title").click();
      // The title's end, not its first line's: each way adds to it, and it wraps.
      await w.keyboard.press("Control+End");
      await w.keyboard.type(` T${tag}`, { delay: pace.delay });
      await close(how);
      w = await main();
      await openNote(w);
      await expect(w.locator(".row-doc .doc-title")).toHaveValue(new RegExp(` T${tag}$`));
    });

    test(`a note's property, typed at ${pace.name} and Boni closed at once (${how})`, async () => {
      let w = await main();
      await openNote(w);
      const prop = await lugar(w);
      await prop.locator(".db-cell").click();
      await prop.locator("input").press("End");
      await w.keyboard.type(` P${tag}`, { delay: pace.delay });
      await close(how);
      w = await main();
      await openNote(w);
      await expect((await lugar(w)).locator(".db-cell")).toContainText(` P${tag}`);
    });

    test(`a draft to Boni, typed at ${pace.name} and Boni closed at once (${how})`, async () => {
      let w = await main();
      const win = (p: Page) => p.getByRole("dialog", { name: "Boni" });
      if (!(await win(w).isVisible())) await w.keyboard.press("Control+e");
      const box = (p: Page) => win(p).getByRole("textbox", { name: "Escribe a Boni…" });
      await box(w).click();
      await box(w).press("Control+a");
      await w.keyboard.type(`Borrador ${tag}`, { delay: pace.delay });
      await close(how);
      w = await main();
      await expect(win(w)).toBeVisible({ timeout: 20_000 });
      await expect(box(w)).toHaveValue(`Borrador ${tag}`);
      await box(w).press("Escape");
    });
  }
}

test("a long note's text, typed and Boni closed at once: there when it opens again (A-15)", async () => {
  let w = await main();
  await openNote(w, longId);
  const doc = w.locator(".row-doc .doc-editor");
  await expect(doc.locator(".blk-input").first()).toBeVisible();
  await doc.locator(".doc-tail").click();
  await w.keyboard.type("Final del diario", { delay: 0 });
  await close("quit");
  w = await main();
  await openNote(w, longId);
  await expect(w.locator(".row-doc .doc-editor .blk-input").last()).toHaveText("Final del diario");
  await expect(w.locator(".row-doc .doc-editor .blk-input").first()).toHaveText(
    "Línea 1 del diario de ejemplo.",
  );
});

test("an image grown by its corner and Boni closed at once: its width there when it opens again (task 2h)", async () => {
  let w = await main();
  await openNote(w, pictureId);
  const frame = w.locator(".row-doc .doc-file-image");
  const img = frame.locator("img");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(100);
  const before = (await img.boundingBox())?.width ?? 0;
  await frame.hover();
  const corner = await frame.locator(".doc-img-corner").boundingBox();
  if (!corner) throw new Error("no corner");
  const x = corner.x + corner.width / 2;
  const y = corner.y + corner.height / 2;
  await w.mouse.move(x, y);
  await w.mouse.down();
  await w.mouse.move(x - 150, y, { steps: 6 });
  await w.mouse.up();
  await close("quit");
  w = await main();
  await openNote(w, pictureId);
  const again = w.locator(".row-doc .doc-file-image img");
  await expect(again).toBeVisible();
  await expect
    .poll(async () => Math.round((await again.boundingBox())?.width ?? 0))
    .toBe(Math.round(before - 150));
});

async function stopServer() {
  const s = server as ChildProcess;
  const gone = new Promise<void>((resolve) => s.once("exit", () => resolve()));
  s.kill();
  await gone;
  server = null;
}

test("a page typed with the server gone, Boni closed at once: on the device when it opens offline, on the server once it is back", async () => {
  let w = await main();
  const title = "Página sin red";
  await newPage(w, title, "Antes");
  // Saved while the server is there (the page exists on it).
  await w.waitForTimeout(1500);
  await stopServer();
  await w.keyboard.type(" y sin red");
  await close("quit");
  w = await main();
  await expect(pageText(w).first()).toHaveText("Antes y sin red", { timeout: 20_000 });
  expect(unsentText()).toContain("Antes y sin red");
  await startServer();
  await close("quit");
  w = await main();
  await expect.poll(unsentText, { timeout: 20_000 }).toBe("");
  // The list of what was kept is empty: what shows now is the server's.
  await inTree(w).getByRole("button", { name: title, exact: true }).click();
  await expect(pageText(w).first()).toHaveText("Antes y sin red");
});

test("a note's property and text typed with the server gone: kept on the device, said once, on the server once it is back", async () => {
  let w = await main();
  await openNote(w);
  await stopServer();
  const prop = await lugar(w);
  await prop.locator(".db-cell").click();
  await prop.locator("input").press("End");
  await w.keyboard.type(" SR");
  const doc = w.locator(".row-doc .doc-editor");
  await doc.locator(".doc-tail").click();
  await expect(w.getByText("Sin conexión: lo escrito queda en este equipo")).toBeVisible();
  await w.keyboard.type("Escrito sin red");
  // What is on the screen stays: nothing goes back to the server's version.
  await expect(prop.locator(".db-cell")).toContainText(" SR");
  await close("quit");
  expect(unsentText()).toContain(" SR");
  expect(unsentText()).toContain("Escrito sin red");
  await startServer();
  await close("quit");
  w = await main();
  await expect.poll(unsentText, { timeout: 20_000 }).toBe("");
  await openNote(w);
  await expect((await lugar(w)).locator(".db-cell")).toContainText(" SR");
  await expect(w.locator(".row-doc .doc-editor .blk-input").last()).toHaveText("Escrito sin red");
});

test("a property kept without the server goes with the note's next write once it is back, not left behind", async () => {
  let w = await main();
  await openNote(w);
  await stopServer();
  const prop = await lugar(w);
  await prop.locator(".db-cell").click();
  await prop.locator("input").press("End");
  await w.keyboard.type(" kept");
  const doc = w.locator(".row-doc .doc-editor");
  await doc.locator(".doc-tail").click();
  await expect(w.getByText("Sin conexión: lo escrito queda en este equipo")).toBeVisible();
  await expect.poll(unsentText, { timeout: 10_000 }).toContain(" kept");
  // Back before the minute's resend: the next write of the same note (its text) answers for the property too.
  await startServer();
  await w.keyboard.type("Con red otra vez");
  await expect.poll(unsentText, { timeout: 20_000 }).toBe("");
  await close("quit");
  w = await main();
  await openNote(w);
  await expect((await lugar(w)).locator(".db-cell")).toContainText(" kept");
  await expect(w.locator(".row-doc .doc-editor .blk-input").last()).toHaveText("Con red otra vez");
});

/** The peek's page: the small window a note opens in from Boni Calendar (`boni://note?id=…&peek=1`). */
async function peekPage(): Promise<Page> {
  const a = app as ElectronApplication;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const p = a.windows().find((x) => !x.isClosed() && x.url().includes("peek=1"));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("no peek window");
}

/**
 * Waits until the main process's minute (it tells the main window to send what is kept: 3 s after start, then every
 * 60 s) is at least `ms` away, so a test that needs what is kept to stay kept is not undone by it.
 */
async function awayFromTheMinute(ms: number) {
  const up = await (app as ElectronApplication).evaluate(() => process.uptime() * 1000);
  const next = 60_000 - ((((up - 3000) % 60_000) + 60_000) % 60_000);
  if (next < ms) await new Promise((r) => setTimeout(r, next + 1000));
}

test("a note's text kept on the device, then the same note written from another window (the peek): the text stays kept, and is there after quitting (task 106)", async () => {
  let w = await main();
  // The peek was opened before (Boni Calendar showed a note in it) and stays loaded while hidden: what the main
  // window keeps from now on is not in its memory.
  openLink(`boni://note?id=${longId}&peek=1`);
  const peek = await peekPage();
  await expect(peek.locator(".row-doc .doc-title")).toHaveValue("Diario de ejemplo");
  await peek.waitForTimeout(900);
  openLink("boni://peek?hide=1");
  await openNote(w);
  await stopServer();
  const doc = w.locator(".row-doc .doc-editor");
  await doc.locator(".doc-tail").click();
  await w.keyboard.type("Escrito antes del peek");
  await expect.poll(unsentText, { timeout: 10_000 }).toContain("Escrito antes del peek");
  await awayFromTheMinute(30_000);
  await startServer();
  // The same note, a property written in the peek: its request carries that property only.
  openLink(`boni://note?id=${noteId}&peek=1`);
  await expect(peek.locator(".row-doc .doc-title")).toHaveValue(/Reunión de ejemplo/);
  const prop = peek.locator(".row-prop").filter({ hasText: "lugar" });
  if (!(await prop.isVisible())) await peek.locator(".row-props-toggle").first().click();
  await prop.locator(".db-cell").click();
  await prop.locator("input").press("End");
  await peek.keyboard.type(" desde el peek");
  await prop.locator("input").press("Enter");
  await expect(prop.locator(".db-cell")).toContainText(" desde el peek");
  // Its answer has reached the main process by now; what the main window typed is still kept.
  await peek.waitForTimeout(1500);
  expect(unsentText()).toContain("Escrito antes del peek");
  await close("quit");
  expect(unsentText()).toContain("Escrito antes del peek");
  w = await main();
  await expect.poll(unsentText, { timeout: 20_000 }).toBe("");
  await openNote(w);
  await expect(w.locator(".row-doc .doc-editor .blk-input").last()).toHaveText(
    "Escrito antes del peek",
  );
  await expect((await lugar(w)).locator(".db-cell")).toContainText(" desde el peek");
});

test("a write the server keeps failing (5xx) is said once and then tried once an hour, kept until a start sends it (task 106)", async () => {
  const a = app as ElectronApplication;
  let w = await main();
  await openNote(w);
  // From now on the server fails every write of this note (a 500), as one with a broken disk would.
  await a.evaluate(({ net }, id) => {
    const g = globalThis as { failedWrites?: number; realFetch?: typeof net.fetch };
    g.failedWrites = 0;
    g.realFetch = net.fetch;
    net.fetch = ((url: string, init?: RequestInit) => {
      if (init?.method === "PUT" && String(url).includes(`/api/data/rows/${id}`)) {
        g.failedWrites = (g.failedWrites ?? 0) + 1;
        return Promise.resolve(new Response('{"error":"disk"}', { status: 500 }));
      }
      return (g.realFetch as typeof net.fetch).call(net, url, init);
    }) as typeof net.fetch;
  }, noteId);
  const failed = () =>
    a.evaluate(() => (globalThis as { failedWrites?: number }).failedWrites ?? 0);
  // The main process's minute, as it sends it to the main window (it resends what is kept).
  const minute = () =>
    a.evaluate(({ BrowserWindow }) => {
      for (const b of BrowserWindow.getAllWindows())
        if (b.getTitle() === "Boni") b.webContents.send("boni:event", { type: "tick", minute: 1 });
    });
  // The test's minutes only: the main process's own would add a resend of its own.
  await awayFromTheMinute(40_000);
  const doc = w.locator(".row-doc .doc-editor");
  await doc.locator(".doc-tail").click();
  await w.keyboard.type("Escrito con el servidor fallando");
  await expect.poll(failed).toBeGreaterThan(0);
  const notice = w.getByText(/^El servidor no guarda «.+»: queda en este equipo$/);
  // The saves made while typing failed too, and are not counted: only the minute's resends are.
  await expect(notice).toHaveCount(0);
  for (let i = 1; i <= 5; i++) {
    const before = await failed();
    await minute();
    await expect.poll(failed).toBeGreaterThan(before);
    if (i < 5) await expect(notice).toHaveCount(0);
  }
  await expect(notice).toBeVisible();
  expect(unsentText()).toContain("Escrito con el servidor fallando");
  // From then on the minute's resend leaves it for an hour: no request, no second notice; it stays kept.
  const n = await failed();
  await minute();
  await minute();
  await w.waitForTimeout(1500);
  expect(await failed()).toBe(n);
  await expect(w.locator(".row-doc .doc-editor .blk-input").last()).toHaveText(
    "Escrito con el servidor fallando",
  );
  // The server mends; quitting and the next start send it.
  await a.evaluate(({ net }) => {
    net.fetch = (globalThis as { realFetch?: typeof net.fetch }).realFetch as typeof net.fetch;
  });
  await close("quit");
  w = await main();
  await expect.poll(unsentText, { timeout: 20_000 }).toBe("");
  await openNote(w);
  await expect(w.locator(".row-doc .doc-editor .blk-input").last()).toHaveText(
    "Escrito con el servidor fallando",
  );
});

test("quitting with a write the server does not answer takes a second or so, and the write is kept for the next start", async () => {
  let w = await main();
  const title = "Página colgada";
  await newPage(w, title, "Antes");
  await w.waitForTimeout(1500);
  // The server is there but answers nothing: the request stays in flight.
  (server as ChildProcess).kill("SIGSTOP");
  try {
    await w.keyboard.type(" sin respuesta");
    await w.waitForTimeout(800);
    const took = await close("quit");
    expect(took, `quitting took ${took} ms`).toBeLessThan(3000);
    expect(unsentText()).toContain("Antes sin respuesta");
  } finally {
    (server as ChildProcess).kill("SIGCONT");
  }
  w = await main();
  await expect.poll(unsentText, { timeout: 30_000 }).toBe("");
  await inTree(w).getByRole("button", { name: title, exact: true }).click();
  await expect(pageText(w).first()).toHaveText("Antes sin respuesta");
});

// ---------- the phone-sized web app in a browser, losing its tab ----------

async function phone(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 860 },
    isMobile: true,
    hasTouch: true,
  });
  ctx.setDefaultTimeout(15_000);
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/boni/`);
  return { ctx, p };
}

async function phoneLogin(p: Page) {
  await p.getByRole("button", { name: "Configurar servidor" }).tap();
  const form = p.locator(".server-form");
  await form.locator("input").nth(0).fill(`http://127.0.0.1:${PORT}`);
  await form.locator("input").nth(1).fill("ejemplo");
  await form.locator('input[type="password"]').fill(PASSWORD);
  await form.locator("input").nth(3).fill("movil-ejemplo");
  await form.locator("button[type=submit]").tap();
  await expect(p.locator(".modal")).toContainText("ejemplo");
  await p.keyboard.press("Escape");
  await expect(p.locator(".modal")).toHaveCount(0);
}

async function phoneNote(p: Page) {
  try {
    await p
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await expect(p.locator(".m-large h1")).toHaveText("Páginas");
    await p.locator(".m-item-main", { hasText: "Apuntes" }).tap();
    await p.locator(".m-item-main", { hasText: "Reunión de ejemplo" }).first().tap();
    await expect(p.locator(".row-doc .doc-title")).toBeVisible({ timeout: 20_000 });
  } catch (e) {
    await p.screenshot({ path: test.info().outputPath("phone.png") }).catch(() => undefined);
    throw e;
  }
}

test("on a phone, a note's title typed and the tab closed at once: there in a new tab", async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const { ctx, p } = await phone(browser);
    await phoneLogin(p);
    await phoneNote(p);
    await p.locator(".row-doc .doc-title").tap();
    // The end of the text, not of its line: a long title wraps at a phone's width.
    await p.keyboard.press("Control+End");
    await p.keyboard.type(" móvil");
    await p.close();
    const again = await ctx.newPage();
    await again.goto(`http://127.0.0.1:${PORT}/boni/`);
    await phoneNote(again);
    await expect(again.locator(".row-doc .doc-title")).toHaveValue(/ móvil$/);
  } finally {
    await browser.close();
  }
});

test("on a phone without a connection, a note's title typed, the tab hidden and then killed: kept, and sent from the next tab", async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const { ctx, p } = await phone(browser);
    await phoneLogin(p);
    await phoneNote(p);
    await ctx.setOffline(true);
    await p.locator(".row-doc .doc-title").tap();
    // The end of the text, not of its line: a long title wraps at a phone's width.
    await p.keyboard.press("Control+End");
    await p.keyboard.type(" oculta");
    // The phone puts the tab away (it only hides it: no `pagehide`), then the system kills it.
    await p.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const cdp = await ctx.newCDPSession(p);
    // The crash never answers: its page is gone. The page's own event says it happened.
    const crashed = p.waitForEvent("crash");
    void cdp.send("Page.crash").catch(() => undefined);
    await crashed;
    // What is left of the crashed tab goes (nothing of it runs any more), and the network comes back.
    await p.close().catch(() => undefined);
    await ctx.setOffline(false);
    const again = await ctx.newPage();
    await again.goto(`http://127.0.0.1:${PORT}/boni/`);
    await expect
      .poll(() => again.evaluate(() => localStorage.getItem("boni:store:unsent.json")), {
        timeout: 20_000,
      })
      .toBeNull();
    await phoneNote(again);
    await expect(again.locator(".row-doc .doc-title")).toHaveValue(/ oculta$/);
  } finally {
    await browser.close();
  }
});
