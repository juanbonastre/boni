/** What the editor asks the server, as the apps' allowed paths see it (paths.cjs, Net.kt). */
import { describe, expect, it } from "vitest";
import { automationsClient } from "./client.ts";

/** The paths the desktop app (paths.cjs) and Android (Net.kt) let through, with no `..` anywhere. */
const ALLOWED =
  /^api\/(v1|agent|pages|pages-trash|data|mail)(\/[A-Za-z0-9_\-./%]*)?(\?[A-Za-z0-9_\-.=&%+]*)?$/;

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
      expect(p).toMatch(ALLOWED);
      expect(p).not.toContain("..");
      const q = new URLSearchParams(p.split("?")[1]);
      expect(q.get("expr")).toBe(expr);
      expect([q.get("step"), q.get("param"), q.get("row")]).toEqual([
        "s_01kx3doblar",
        "fields.0.value",
        "41",
      ]);
    }
  });
});
