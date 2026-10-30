import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSystemTypes } from "@boni/agent";
import type { ExtensionManifest, FunctionInput } from "@boni/extensions";
import { openUserStore, type UserStore } from "@boni/store";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installed } from "./extensions.ts";
import type { Runner } from "./functions.ts";
import { mcpAnswer } from "./mcp.ts";
import { activate, proposals, propose, reject, revert } from "./proposals.ts";
import { codeHash } from "./sandbox.ts";
import { seed } from "./seed.test-util.ts";

/**
 * An extension proposed through the MCP and activated by Juan (E3): proposing never activates anything, the card
 * says what it asks for in the account's names, Juan activates, rejects, or goes back to the version before; and a
 * session's scope bounds what an assistant may do. The last test runs the real box (apps/sandbox) in a process.
 */
const dir = mkdtempSync(join(tmpdir(), "boni-propuestas-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let store: UserStore;
let n = 0;
beforeEach(() => {
  store = openUserStore(join(dir, `u${++n}.db`));
  ensureSystemTypes(store);
  seed(
    store,
    [
      {
        key: "movimiento",
        name: "Movimiento",
        folder: "finanzas/",
        fields: { fecha: "date", importe: "number", concepto: "text" },
      },
    ],
    {
      "finanzas/cafe.md":
        '---\nfecha: "2026-10-01"\nimporte: -1.5\nconcepto: "café"\n---\n# Café\n',
    },
  );
});

const CODE = `function importar(input) {
  const nuevos = (input.data && input.data.lineas) || [];
  return { summary: nuevos.length + " nuevos", changes: nuevos.map((l) => ({ op: "create", collection: "movimiento", values: { concepto: l } })) };
}`;
const manifest = (version: number, more: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
  id: "banco",
  name: "Banco",
  version,
  description: "Lee los extractos que subes y propone los movimientos nuevos.",
  functions: [
    {
      name: "importar",
      code: CODE,
      hash: codeHash(CODE),
      reads: [{ collection: "movimiento", fields: ["fecha", "importe"] }],
      writes: [{ collection: "movimiento", fields: ["concepto"], create: true }],
    },
  ],
  tests: [
    {
      function: "importar",
      name: "dos líneas dan dos movimientos",
      input: { rows: { movimiento: [] }, data: { lineas: ["cena", "taxi"] } },
      expect: {
        summary: "2 nuevos",
        changes: [
          { op: "create", collection: "movimiento", values: { concepto: "cena" } },
          { op: "create", collection: "movimiento", values: { concepto: "taxi" } },
        ],
      },
    },
  ],
  needs: { reads: ["movimiento"], proposes: false },
  ...more,
});
/** The box's stand-in: the function written here as it would run there. */
const box: Runner = async (req) => {
  const lines =
    ((req.input as FunctionInput).data as { lineas?: string[] } | undefined)?.lineas ?? [];
  return {
    id: req.id,
    ok: true,
    output: {
      summary: `${lines.length} nuevos`,
      changes: lines.map((l) => ({
        op: "create",
        collection: "movimiento",
        values: { concepto: l },
      })),
    },
    steps: 1,
    ms: 1,
  };
};

describe("an extension proposed through the MCP", () => {
  it("is checked and tried, waits for Juan, and activates nothing by itself", async () => {
    const r = await propose(store, manifest(1), "mcp:claude-ejemplo", {
      run: box,
      data: { importar: { lineas: ["cena"] } },
    });
    expect(r).toMatchObject({ ok: true, kept: true });
    expect(installed(store).map((i) => i.manifest.id)).not.toContain("banco");
    const [card] = proposals(store);
    expect(card).toMatchObject({
      id: "banco",
      version: 1,
      active: null,
      by: "mcp:claude-ejemplo",
      more: {
        code: ["importar"],
        reads: [{ collection: "Movimiento", fields: ["fecha", "importe"] }],
        writes: [{ collection: "Movimiento", fields: ["concepto"] }],
        creates: ["Movimiento"],
      },
      privateReads: [],
      report: {
        tests: [{ function: "importar", name: "dos líneas dan dos movimientos", ok: true }],
        dryRuns: [{ function: "importar", ok: true, creates: { Movimiento: 1 }, updates: 0 }],
      },
    });
  });

  it("is refused when it is not one, its code is not its hash, its tests fail, or it is not newer", async () => {
    expect((await propose(store, { id: "x" }, "mcp:c", { run: box })).ok).toBe(false);
    const bad = manifest(1);
    (bad.functions as { hash: string }[])[0]!.hash = "0".repeat(64);
    expect((await propose(store, bad, "mcp:c", { run: box })).errors).toContain(
      "functions.importar.hash: not its code's sha256",
    );
    const failing = manifest(1, {
      tests: [
        { function: "importar", name: "espera otra cosa", input: {}, expect: { changes: [1] } },
      ],
    });
    expect(await propose(store, failing, "mcp:c", { run: box })).toMatchObject({
      ok: false,
      kept: false,
    });
    expect(proposals(store)).toEqual([]);
    await propose(store, manifest(1), "mcp:c", { run: box });
    activate(store, "banco", "portatil");
    expect((await propose(store, manifest(1), "mcp:c", { run: box })).errors).toContain(
      "version: above the active one (1)",
    );
  });

  it("Juan activates it; a new version says what it asks for more; back to the one before is one click", async () => {
    await propose(store, manifest(1), "mcp:c", { run: box });
    expect(activate(store, "banco", "portatil")).toBe(true);
    expect(installed(store).find((i) => i.manifest.id === "banco")).toMatchObject({
      enabled: true,
      manifest: { version: 1 },
    });
    const v2 = manifest(2);
    v2.functions![0]!.reads = [
      { collection: "movimiento", fields: ["fecha", "importe", "concepto"] },
    ];
    await propose(store, v2, "mcp:c", { run: box });
    expect(proposals(store)[0]?.more).toMatchObject({
      code: [],
      reads: [{ collection: "Movimiento", fields: ["concepto"] }],
    });
    activate(store, "banco", "portatil");
    expect(installed(store).find((i) => i.manifest.id === "banco")?.manifest.version).toBe(2);
    expect(revert(store, "banco", "portatil")).toBe(true);
    expect(installed(store).find((i) => i.manifest.id === "banco")?.manifest.version).toBe(1);
    expect(revert(store, "banco", "portatil")).toBe(true);
    expect(installed(store).find((i) => i.manifest.id === "banco")?.manifest.version).toBe(2);
  });

  it("Juan rejects it: a new one goes away, an active one stays as it was", async () => {
    await propose(store, manifest(1), "mcp:c", { run: box });
    expect(reject(store, "banco", "portatil")).toBe(true);
    expect(proposals(store)).toEqual([]);
    await propose(store, manifest(1), "mcp:c", { run: box });
    activate(store, "banco", "portatil");
    await propose(store, manifest(2), "mcp:c", { run: box });
    reject(store, "banco", "portatil");
    expect(installed(store).find((i) => i.manifest.id === "banco")?.manifest.version).toBe(1);
  });
});

describe("what an assistant's session may do", () => {
  const rpc = async (scope: Parameters<typeof mcpAnswer>[4], method: string, params?: unknown) =>
    (await mcpAnswer(
      store,
      "claude-ejemplo",
      { jsonrpc: "2.0", id: 1, method, params },
      Date.now,
      scope,
    )) as {
      result: { tools?: { name: string }[]; isError?: boolean; content?: { text: string }[] };
    };

  it("its scope: a reading session sees and uses only the reading tools", async () => {
    const names = (await rpc(["read"], "tools/list")).result.tools?.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).toContain("extensions_describe");
    expect(names).not.toContain("create");
    expect(names).not.toContain("extensions_propose");
    const r = await rpc(["read"], "tools/call", { name: "create", arguments: {} });
    expect(r.result).toMatchObject({
      isError: true,
      content: [{ text: "this session may not write" }],
    });
    // Proposing extensions is a scope of its own.
    const p = await rpc(["read", "write"], "tools/call", {
      name: "extensions_propose",
      arguments: {},
    });
    expect(p.result.content?.[0]?.text).toBe("this session may not extensions:propose");
  });

  it("no tool activates an extension (P16): only Juan, in Boni", async () => {
    const names = (await rpc(null, "tools/list")).result.tools?.map((t) => t.name) ?? [];
    expect(names.filter((x) => /activ|enable|install/.test(x))).toEqual([]);
  });
});

describe("through the MCP with the real box", () => {
  let boxProc: ChildProcess;
  const socket = join(dir, "caja.sock");
  beforeAll(async () => {
    boxProc = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        join(import.meta.dirname, "../../sandbox/src/main.ts"),
      ],
      {
        env: { ...process.env, BONI_SANDBOX_SOCKET: socket },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    await new Promise<void>((resolve) => boxProc.stdout?.once("data", () => resolve()));
    process.env.BONI_SANDBOX_SOCKET = socket;
  });
  afterAll(() => {
    boxProc.kill();
    delete process.env.BONI_SANDBOX_SOCKET;
  });

  it("a proposal runs its tests and its dry run in the box, then waits; describe shows it", async () => {
    const call = async (name: string, args: unknown) => {
      const r = (await mcpAnswer(store, "claude-ejemplo", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      })) as { result: { content: { text: string }[]; isError: boolean } };
      return JSON.parse(r.result.content[0]?.text ?? "null");
    };
    const r = await call("extensions_propose", {
      manifest: manifest(1),
      data: { importar: { lineas: ["cena", "taxi", "cine"] } },
    });
    expect(r).toMatchObject({
      ok: true,
      kept: true,
      report: { dryRuns: [{ function: "importar", ok: true, creates: { movimiento: 3 } }] },
    });
    expect((await call("extensions_describe", {})).waiting).toEqual([
      expect.objectContaining({ id: "banco", version: 1 }),
    ]);
    // Not active: it cannot be run.
    const run = (await mcpAnswer(store, "claude-ejemplo", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "extensions_run", arguments: { extension: "banco", function: "importar" } },
    })) as { result: { isError: boolean } };
    expect(run.result.isError).toBe(true);
  }, 30_000);
});
