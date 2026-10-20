import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { definitionNote } from "../apps/calendar-web/src/vault/testing.ts";
import { Agent, coreTools, ensureSystemTypes, fakePlanner } from "../packages/agent/src/index.ts";
import { label } from "../packages/entities/src/index.ts";
import { Mirror, type MirrorFs, openMirrorState } from "../packages/mirror/src/index.ts";
import { openUserStore } from "../packages/store/src/index.ts";
import { agendaNote, launchObsidian, type Obsidian } from "./obsidian.ts";

/**
 * Obsidian as an integration at the edge (docs/nucleo.md 9.2 and 9.4), in the real Obsidian (temporary
 * profile, invented vaults): the mirror is an output Obsidian renders by itself, so a remote image in
 * text from outside must not load there; and the plugin works alone over its vault or, if Juan wants,
 * as a client of a Boni server.
 */
test.describe.configure({ mode: "serial" });

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { openVault } = require("../apps/calendar-desktop/vault-fs.cjs") as {
  openVault: (root: string) => MirrorFs;
};
const PASSWORD = "una contraseña larga de ejemplo";

let obs: Obsidian;
let page: Page;
// biome-ignore lint/suspicious/noExplicitAny: Obsidian's global app object
const app = <T>(fn: (app: any) => T | Promise<T>) =>
  page.evaluate(`(${fn.toString()})(window.app)`) as Promise<T>;

test.beforeAll(async () => {
  obs = await launchObsidian({ notes: 20, width: 1400, height: 900 });
  page = obs.page;
});
test.afterAll(async () => {
  await obs?.close();
});

/** A server that counts every request it gets (where a leaked image would go). */
async function counter(): Promise<{ server: Server; port: number; hits: string[] }> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "image/png" });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as AddressInfo).port, hits };
}

async function openNote(path: string) {
  await expect
    .poll(
      () => page.evaluate(`!!window.app.vault.getAbstractFileByPath(${JSON.stringify(path)})`),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.evaluate(`(async () => {
    const f = window.app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    await window.app.workspace.getLeaf(true).openFile(f, { state: { mode: "preview" } });
  })()`);
  await page.waitForTimeout(2500);
}

test("a remote image in text from outside is not loaded from the mirror's note", async () => {
  const { server, port, hits } = await counter();
  try {
    // Control: the same image in a plain note loads (so the test would see a leak).
    writeFileSync(
      join(obs.vault.dir, "Control de imagen.md"),
      `Una imagen:\n\n![x](http://127.0.0.1:${port}/control.png?d=prueba)\n`,
    );
    await openNote("Control de imagen.md");
    expect(hits.filter((h) => h.startsWith("/control.png")).length).toBeGreaterThan(0);

    // The mirror writes an entity whose text came from an e-mail.
    const dir = mkdtempSync(join(tmpdir(), "boni-core-"));
    const store = openUserStore(join(dir, "user.db"));
    ensureSystemTypes(store);
    const own = label("user", "personal", [{ kind: "turn", id: "t" }]);
    const mail = label("external", "personal", [{ kind: "mail", id: "m1" }], true);
    store.applySchema(
      {
        op: "create_type",
        type: {
          id: "t_libro",
          key: "libro",
          name: "Libros",
          fields: [{ id: "f_titulo", key: "titulo", name: "Título", type: "text", label: own }],
          titleField: "f_titulo",
          sensitivity: "personal",
          schemaVersion: 1,
          label: own,
        },
      },
      { actor: "user" },
    );
    store.create(
      "t_libro",
      {
        f_titulo: { value: "Libro de un correo", label: own },
        $body: {
          value: `Resumen.\n\n![x](http://127.0.0.1:${port}/fuga.png?d=secreto)\n<img src="http://127.0.0.1:${port}/fuga2.png">\n`,
          label: mail,
        },
      },
      { actor: "agent", run: "r1" },
    );
    const state = openMirrorState(join(dir, "mirror.db"));
    const agent = new Agent({
      store,
      registry: coreTools().freeze(),
      planner: fakePlanner([]),
      reader: fakePlanner([]),
    });
    new Mirror({
      store,
      state,
      fs: openVault(obs.vault.dir),
      propose: (p) => agent.propose(p),
    }).switchToCore("t_libro", { apply: true });
    state.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });

    await openNote("Boni/Libros/Libro de un correo.md");
    await expect(page.locator(".markdown-preview-view").last()).toContainText("Resumen.");
    await expect(page.locator(".markdown-preview-view").last()).toContainText("fuga.png");
    expect(hits.filter((h) => h.includes("fuga"))).toEqual([]);
    await app((a) => a.workspace.detachLeavesOfType("markdown"));
  } finally {
    server.close();
  }
});

/** A Boni server on this machine (as it runs on the NAS), over its own invented vault. */
async function bootServer(): Promise<{ url: string; stop: () => void }> {
  const root = mkdtempSync(join(tmpdir(), "boni-server-"));
  const vault = join(root, "vault");
  const w = (rel: string, text: string) => {
    mkdirSync(dirname(join(vault, rel)), { recursive: true });
    writeFileSync(join(vault, rel), text);
  };
  w(
    "_system/colecciones/docencia.md",
    definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"),
  );
  w(
    `agenda/docencia/${obs.vault.today} Evento del servidor.md`,
    agendaNote("Evento del servidor", obs.vault.today, "15:00", "16:00", "docencia"),
  );
  mkdirSync(join(root, "data"));
  const env = {
    ...process.env,
    BONI_DB: join(root, "data", "boni-calendar.db"),
    BONI_BACKUPS: "0",
    BONI_PASSWORD: PASSWORD,
  };
  const server = join(here, "..", "apps", "server", "src");
  execFileSync("node", [join(server, "cli.ts"), "add-user", "ejemplo", vault], {
    env,
    stdio: "ignore",
  });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc: ChildProcess = spawn("node", [join(server, "main.ts")], {
    env: { ...env, BONI_PORT: String(port), BONI_HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  await expect
    .poll(
      () =>
        fetch(`${url}/healthz`)
          .then((r) => r.status)
          .catch(() => 0),
      {
        timeout: 20_000,
      },
    )
    .not.toBe(0);
  return {
    url,
    stop: () => {
      proc.kill();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("the plugin works over its vault and, if chosen, as a client of a Boni server", async () => {
  await app((a) => a.commands.executeCommandById("boni-calendar:open"));
  await expect(page.locator(".boni .ev", { hasText: "Clase de hoy" })).toHaveCount(1, {
    timeout: 30_000,
  });
  const srv = await bootServer();
  try {
    await page.locator(".boni .title").click();
    await page.keyboard.press("Control+,");
    const settings = page.locator(".boni .modal");
    await settings.getByRole("radio", { name: "Este vault" }).waitFor();
    await settings.getByRole("radio", { name: "Servidor" }).click();
    const form = settings.locator(".server-form");
    await form.locator("input").nth(0).fill(srv.url);
    await form.locator("input").nth(1).fill("ejemplo");
    await form.locator("input").nth(2).fill(PASSWORD);
    await form.locator(".btn.primary").click();
    await expect(settings).toContainText("ejemplo", { timeout: 15_000 });
    await page.keyboard.press("Escape");
    // The calendar now shows the server's notes, not this vault's.
    await expect(page.locator(".boni .ev", { hasText: "Evento del servidor" })).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(page.locator(".boni .ev", { hasText: "Clase de hoy" })).toHaveCount(0);

    // Back to this vault: it works alone again.
    await page.locator(".boni .title").click();
    await page.keyboard.press("Control+,");
    await settings.getByRole("radio", { name: "Este vault" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".boni .ev", { hasText: "Clase de hoy" })).toHaveCount(1, {
      timeout: 15_000,
    });
  } finally {
    srv.stop();
  }
});
