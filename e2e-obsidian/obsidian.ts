import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "@playwright/test";
import { definitionNote } from "../apps/web/src/vault/testing.ts";

/**
 * Drives the Obsidian installed on this machine with a profile and a vault made for the test in a
 * temporary folder: the user's own profile (~/.config/obsidian) and vaults are never opened. The
 * vault holds only invented notes. Needs Obsidian (OBSIDIAN_BIN, default /opt/Obsidian/obsidian) and
 * a display, so these tests run with `make e2e-obsidian`, not in CI.
 */
const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIST = join(here, "..", "apps", "obsidian-plugin", "dist");
const BIN = process.env.OBSIDIAN_BIN ?? "/opt/Obsidian/obsidian";

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const TITLES = [
  "Clase de ejemplo",
  "Tutoría inventada",
  "Reunión de prueba",
  "Revisión de ejemplo",
  "Gestión inventada",
  "Llamada de prueba",
];

/** An agenda note in the vault's format (title, date, times, the Area line of its calendar). */
export function agendaNote(title: string, day: string, start: string, end: string, area: string) {
  return `---\ntitle: "${title}"\ndate: "${day}"\nstartTime: "${start}"\nendTime: "${end}"\ncompleted:\n---\nArea: [[${area}]]\n\n## Notas\n`;
}

export interface TestVault {
  dir: string;
  /** Path (relative to the vault) of a note today at 10:00-11:30 in "docencia". */
  lesson: string;
  today: string;
}

/**
 * A vault with the calendar's definitions and `notes` invented agenda notes spread over five years
 * around today (like the real agenda: most of them in "docencia"), plus a loose note. Deleted
 * files go to the vault's own `.trash` (so the test never fills the system trash).
 */
export function makeVault(root: string, notes: number): TestVault {
  const dir = join(root, "vault");
  const w = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  w(
    "_system/colecciones/docencia.md",
    definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"),
  );
  w("_system/colecciones/planes.md", definitionNote("planes", "Planes", "agenda/planes", "planes"));
  const now = new Date();
  const today = isoDay(now);
  const lesson = `agenda/docencia/${today} Clase de hoy.md`;
  w(lesson, agendaNote("Clase de hoy", today, "10:00", "11:30", "docencia"));
  for (let i = 0; i < notes; i++) {
    const d = new Date(now);
    // Like the real agenda: years of notes (four back, one ahead), one or two a day.
    d.setDate(d.getDate() - 1461 + Math.floor((i * 1826) / notes));
    const area = i % 4 === 0 ? "planes" : "docencia";
    const h = 8 + (i % 10);
    const title = `${TITLES[i % TITLES.length]} ${i}`;
    w(
      `agenda/${area}/${isoDay(d)} ${title}.md`,
      agendaNote(title, isoDay(d), `${pad(h)}:00`, `${pad(h + 1)}:00`, area),
    );
  }
  w("Nota suelta.md", "# Nota de ejemplo\n\nTexto inventado.\n");
  w(".obsidian/app.json", JSON.stringify({ trashOption: "local" }));
  w(".obsidian/community-plugins.json", JSON.stringify(["boni-calendar"]));
  cpSync(PLUGIN_DIST, join(dir, ".obsidian", "plugins", "boni-calendar"), { recursive: true });
  return { dir, lesson, today };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitFor<T>(what: string, fn: () => Promise<T | null>, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export interface Obsidian {
  page: Page;
  vault: TestVault;
  /** Milliseconds from launching Obsidian to its layout being ready. */
  startupMs: number;
  close(): Promise<void>;
}

/** Starts Obsidian on a new temporary profile and vault; `close` stops it and removes both. */
export async function launchObsidian(
  opts: { notes?: number; width?: number; height?: number } = {},
): Promise<Obsidian> {
  const root = mkdtempSync(join(tmpdir(), "boni-obsidian-"));
  const vault = makeVault(root, opts.notes ?? 200);
  const profile = join(root, "profile");
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    join(profile, "obsidian.json"),
    JSON.stringify({
      vaults: { b0c1a2e3d4f5a6b7: { path: vault.dir, ts: Date.now(), open: true } },
      updateDisabled: true,
    }),
  );
  const port = await freePort();
  const started = Date.now();
  const proc: ChildProcess = spawn(
    BIN,
    [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`],
    { detached: true, stdio: "ignore" },
  );
  let browser: Browser | null = null;
  const close = async () => {
    await browser?.close().catch(() => {});
    if (proc.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 800));
    rmSync(root, { recursive: true, force: true });
  };
  try {
    await waitFor("the debugging port", async () => {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      return r.ok;
    });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const b = browser;
    const page = await waitFor("the vault window", async () => {
      const p = b.contexts().flatMap((c) => c.pages());
      return p.find((x) => x.url().includes("index.html")) ?? null;
    });
    await waitFor("the layout", () =>
      page.evaluate(() => {
        const app = (window as unknown as { app?: { workspace?: { layoutReady?: boolean } } }).app;
        return app?.workspace?.layoutReady ? true : null;
      }),
    );
    const startupMs = Date.now() - started;
    // A vault opened for the first time with plugins asks whether to trust them (it is ours).
    const trust = page.getByRole("button", { name: /Trust author/i });
    if (await trust.isVisible({ timeout: 3000 }).catch(() => false)) {
      await trust.click();
      await waitFor("the plugin", () =>
        page.evaluate(() => {
          const app = (
            window as unknown as { app: { plugins: { plugins: Record<string, unknown> } } }
          ).app;
          return app.plugins.plugins["boni-calendar"] ? true : null;
        }),
      );
    }
    if (opts.width && opts.height) {
      // Obsidian keeps its Electron window on `window.electronWindow`.
      await page.evaluate(
        ([w, h]) =>
          (
            window as unknown as { electronWindow: { setSize(w: number, h: number): void } }
          ).electronWindow.setSize(w, h),
        [opts.width, opts.height] as const,
      );
      await page.waitForTimeout(500);
    }
    return { page, vault, startupMs, close };
  } catch (e) {
    await close();
    throw e;
  }
}
