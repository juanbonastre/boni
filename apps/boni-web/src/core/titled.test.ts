/** What a mention `[[Título]]` asks the server and how its answer is read (task 110, D-71). */
import { describe, expect, it } from "vitest";
import { parseTitled, queryValue } from "./agent.ts";

/** The query values the desktop app (paths.cjs) and Android (Net.kt) let through. */
const ALLOWED = /^[A-Za-z0-9_\-.=&%+]*$/;

describe("a mention's title asked of the server", () => {
  it("is escaped strictly, so the apps' allowed paths let it through, and comes back as it was", () => {
    for (const title of [
      "Reunión (martes)",
      "Plan A/B: ¿sí? ¡no! *v2* ~x 'y'",
      "Café & té = 100 %",
      "—",
    ]) {
      const v = queryValue(title);
      expect(v).toMatch(ALLOWED);
      expect(new URLSearchParams(`title=${v}`).get("title")).toBe(title);
    }
  });

  it("reads only what it expects: at most twenty rows, cut to length, the count never under them", () => {
    const row = (i: number) => ({
      id: `e_${i}`,
      type: "t_x",
      collection: "Notas",
      title: "Uno",
      updated: i,
    });
    const many = parseTitled({ rows: Array.from({ length: 30 }, (_, i) => row(i)), count: 31 });
    expect(many.rows).toHaveLength(20);
    expect(many.count).toBe(31);
    const odd = parseTitled({
      rows: [row(1), { id: 2 }, "x", { ...row(3), collection: "c".repeat(200) }],
    });
    expect(odd.rows.map((r) => r.id)).toEqual(["e_1", "e_3"]);
    expect(odd.rows[1]?.collection).toHaveLength(80);
    expect(odd.count).toBe(2);
    expect(parseTitled(null)).toEqual({ rows: [], count: 0 });
  });
});
