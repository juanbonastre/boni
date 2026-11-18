/** What the editor asks the server, as the apps' allowed paths see it (paths.cjs, Net.kt). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { automationsClient, PREVIEW_QUERY_CHARS, previewFits, runAsksOf } from "./client.ts";

/**
 * The paths the desktop app and Android let through, read out of their own files (`API_PATH` in paths.cjs and in
 * Net.kt), so a change in either is a change here: never a copy that could drift.
 */
const APPS = join(import.meta.dirname, "..", "..", "..");
const desktop = (() => {
  const src = readFileSync(join(APPS, "boni-desktop", "paths.cjs"), "utf8");
  const m = /const API_PATH =\s*\/(.+)\/;/.exec(src);
  if (!m?.[1]) throw new Error("paths.cjs: no API_PATH");
  return new RegExp(m[1]);
})();
const android = (() => {
  const src = readFileSync(
    join(
      APPS,
      "boni-android",
      "app",
      "src",
      "main",
      "java",
      "io",
      "github",
      "juanbonastre",
      "boni",
      "Net.kt",
    ),
    "utf8",
  );
  const m = /API_PATH =\s*Regex\("(.+)"\)/.exec(src);
  if (!m?.[1]) throw new Error("Net.kt: no API_PATH");
  return new RegExp(m[1].replaceAll("\\\\", "\\"));
})();
/** What both apps let through: their pattern, and no `..` anywhere. */
const allowed = (p: string) => desktop.test(p) && android.test(p) && !p.includes("..");

describe("the line under an expression asked of the server", () => {
  it("AU-23 · any expression goes in a path the apps let through, and the server reads it back as it was typed", async () => {
    const asked: string[] = [];
    const client = automationsClient({
      automations: async (_method: string, path: string) => {
        asked.push(`api/agent/automations/${path}`);
        return { state: "value", value: 1, row: 0, of: 1 };
      },
    } as never);
    const typed = [
      "{{ $json.importe * 2 }}",
      "{{ [...$input.all()].map((p) => p.nota ?? '—').join(', ') }}",
      "Total: {{ $json.a + $json.b }} € (sin IVA) ~ ¡ya! ...",
    ];
    for (const expr of typed) {
      await client.preview("a_01kx3m9q2a7v", {
        step: "s_01kx3doblar",
        param: "fields.0.value",
        row: 41,
        expr,
      });
      const p = asked.at(-1) as string;
      expect(allowed(p), p).toBe(true);
      const q = new URLSearchParams(p.split("?")[1]);
      expect(q.get("expr")).toBe(expr);
      expect([q.get("step"), q.get("param"), q.get("row")]).toEqual([
        "s_01kx3doblar",
        "fields.0.value",
        "41",
      ]);
    }
  });
  it("AU-23 · both apps' patterns are read and are the same: a path outside them is refused by both", () => {
    expect(desktop.source).toBe(android.source);
    expect(allowed("api/agent/automations/a_01/test/preview?expr=%7B%7B")).toBe(true);
    expect(allowed("api/agent/automations/a_01/test/preview?expr={{")).toBe(false);
    expect(allowed("api/agent/../../etc")).toBe(false);
  });
  it("AU-23 · an expression within its 2,000 characters that would not fit a request once escaped is not asked", () => {
    expect(previewFits(`{{ ${"$json.a + ".repeat(180)}1 }}`)).toBe(true);
    // 2,000 characters of three bytes each: about 18 KB once escaped.
    const wide = `{{ '${"—".repeat(1990)}' }}`;
    expect(wide.length).toBeLessThanOrEqual(2000);
    expect(previewFits(wide)).toBe(false);
    expect(PREVIEW_QUERY_CHARS).toBeLessThan(16 * 1024);
  });
});

describe("«Publicar», the versions, the switch and «Ejecutar» asked of the server", () => {
  it("AU-95 · AU-96 · AU-194 · AU-97 · each path the editor asks goes through both apps' allowed paths", async () => {
    const asked: string[] = [];
    const client = automationsClient({
      automations: async (method: string, path: string) => {
        asked.push(`${method} api/agent/automations/${path}`);
        if (path.endsWith("/versions/1")) return { automation: {} };
        return {};
      },
    } as never);
    const id = "a_01jx8x0t2v4x6z8b0d2f4h6k9p";
    await client.publishView(id);
    await client.publishView(id, 2);
    await client.publish(id, { rev: 4 });
    await client.versions(id);
    await client.version(id, 1);
    await client.setEnabled(id, false);
    await client.run(id, { trigger: "s_01jinicio", fields: {} });
    expect(asked).toEqual([
      `GET api/agent/automations/${id}/publish`,
      `GET api/agent/automations/${id}/publish?version=2`,
      `POST api/agent/automations/${id}/publish`,
      `GET api/agent/automations/${id}/versions`,
      `GET api/agent/automations/${id}/versions/1`,
      `PUT api/agent/automations/${id}/enabled`,
      `POST api/agent/automations/${id}/run`,
    ]);
    for (const p of asked) expect(allowed(p.split(" ")[1] as string), p).toBe(true);
  });

  it("AU-98 · AU-192 · a version comes with the names its code kept, and none from a server before them", async () => {
    const names = { s_01jcodigo: { Gastos: "c_gastos" } };
    let with_ = true;
    const client = automationsClient({
      automations: async () =>
        with_ ? { automation: { name: "Una" }, names } : { automation: { name: "Una" } },
    } as never);
    const id = "a_01jx8x0t2v4x6z8b0d2f4h6k9p";
    expect(await client.version(id, 3)).toEqual({ automation: { name: "Una" }, names });
    with_ = false;
    expect((await client.version(id, 3)).names).toEqual({});
  });

  it("AU-191 · «Eliminadas» is the list's own read with `deleted=1`, which both apps let through", () => {
    expect(allowed("api/data/types/t_sys_flujos/rows?deleted=1")).toBe(true);
  });
});

describe("«Ejecuciones» asked of the server", () => {
  it("AU-99 · AU-100 · AU-18 · AU-93 · each path goes through both apps' allowed paths, a run's id escaped", async () => {
    const asked: string[] = [];
    const client = automationsClient({
      automations: async (method: string, path: string) => {
        asked.push(`${method} api/agent/automations/${path}`);
        return {};
      },
    } as never);
    const id = "a_01jx8x0t2v4x6z8b0d2f4h6k9p";
    const run = "r_01jx8x0t2v4x6z8b0d2f4h6k9q";
    await client.runs(id, { filter: "failed", before: run });
    await client.runView(id, run);
    await client.runRows(id, run, { step: "s_01jbuscar", side: "out", name: "main", offset: 50 });
    await client.retry(id, run, true);
    await client.undoRun(id, run);
    await client.pin(id, "s_01jbuscar");
    await client.unpin(id, "s_01jbuscar");
    await client.pinFromRun(id, run);
    const at = `api/agent/automations/${id}`;
    expect(asked.map((a) => a.split("?")[0])).toEqual([
      `GET ${at}/runs`,
      `GET ${at}/runs/${run}`,
      `GET ${at}/runs/${run}/rows`,
      `POST ${at}/runs/${run}/retry`,
      `POST ${at}/runs/${run}/undo`,
      `PUT ${at}/pins/s_01jbuscar`,
      `DELETE ${at}/pins/s_01jbuscar`,
      `POST ${at}/runs/${run}/pin`,
    ]);
    for (const p of asked) expect(allowed(p.split(" ")[1] as string), p).toBe(true);
    expect(new URLSearchParams(asked[0]?.split("?")[1]).get("filter")).toBe("failed");
  });
  it("AU-247 · a waiting run's question is answered by its own path, which both apps let through: one question a call, «Sin respuesta» with no answer, and what the server sends of the run's questions is read with nothing invented", async () => {
    const asked: { path: string; body: unknown }[] = [];
    const client = automationsClient({
      automations: async (method: string, path: string, body?: unknown) => {
        asked.push({ path: `${method} api/agent/automations/${path}`, body });
        return asked.length === 1 ? { run: "r_01jx8x0t2v4x6z8b0d2f4h6k9q" } : { gone: true };
      },
    } as never);
    const id = "a_01jx8x0t2v4x6z8b0d2f4h6k9p";
    const run = "r_01jx8x0t2v4x6z8b0d2f4h6k9q";
    expect(
      await client.answerRun(id, run, { step: "s_01jpreguntar", i: 2 }, { yes: true }),
    ).toEqual({
      run,
    });
    expect(await client.answerRun(id, run, { step: "s_01jpreguntar", i: 0 }, null)).toEqual({
      gone: true,
    });
    expect(asked.map((a) => a.path)).toEqual([
      `POST api/agent/automations/${id}/runs/${run}/answer`,
      `POST api/agent/automations/${id}/runs/${run}/answer`,
    ]);
    expect(asked.map((a) => a.body)).toEqual([
      { step: "s_01jpreguntar", i: 2, answer: { yes: true } },
      { step: "s_01jpreguntar", i: 0 },
    ]);
    for (const a of asked) expect(allowed(a.path.split(" ")[1] as string), a.path).toBe(true);
    // What the run's view brings of its questions: a list of options as values or texts, and nothing that is not one.
    expect(
      runAsksOf([
        {
          step: "s_01jpreguntar",
          answer: "one",
          until: 1_800_000_000_000,
          mayAnswer: true,
          questions: [
            { text: "¿Cuál?", options: [{ value: "A" }, "B", 3], answered: false },
            { text: "¿Y esta?", answered: true },
            { options: [] },
          ],
        },
        { step: "s_x", answer: "draw" },
        "nada",
      ]),
    ).toEqual([
      {
        step: "s_01jpreguntar",
        answer: "one",
        until: 1_800_000_000_000,
        mayAnswer: true,
        questions: [
          { text: "¿Cuál?", options: ["A", "B"], answered: false },
          { text: "¿Y esta?", options: [], answered: true },
        ],
      },
    ]);
    // Without its word the server's `mayAnswer`, the controls are not there: never answered by default.
    expect(runAsksOf([{ step: "s_p", answer: "text", questions: [] }])[0]?.mayAnswer).toBe(false);
  });
});
