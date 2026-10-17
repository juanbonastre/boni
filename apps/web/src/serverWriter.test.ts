import type { Row, RowChange } from "@boni-calendar/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Outbox, type Remote, RemoteError } from "./remote.ts";
import { ServerWriter } from "./serverWriter.ts";
import { aliases } from "./vault/sync.ts";

const row = (id: string, title: string): Row => ({
  id,
  collectionId: "docencia",
  values: { title, date: "2026-10-19" },
  created: 0,
  updated: 0,
});
const up = (r: Row): RowChange => ({ op: "upsert", row: r });

/** A server that answers with `answer` (or throws it) and records what it was sent. */
function fakeServer(answer: (base: number, changes: readonly RowChange[]) => unknown) {
  const sent: { base: number; changes: readonly RowChange[] }[] = [];
  const remote = {
    apply: vi.fn(async (base: number, changes: readonly RowChange[]) => {
      sent.push({ base, changes });
      const a = answer(base, changes);
      if (a instanceof Error) throw a;
      return a;
    }),
  } as unknown as Remote;
  return { remote, sent };
}

function writer(remote: Remote | null, version = 7) {
  const saved: Outbox[][] = [];
  const rejected: string[] = [];
  const w = new ServerWriter({
    remote: () => remote,
    version: () => version,
    save: async (o) => {
      saved.push(structuredClone(o));
    },
    sent: () => {},
    rejected: (why) => rejected.push(why),
  });
  return { w, saved, rejected };
}

afterEach(() => aliases.clear());

describe("ServerWriter", () => {
  it("sends changes with the version the device had, and empties the queue", async () => {
    const { remote, sent } = fakeServer(() => ({ version: 8, aliases: {} }));
    const { w, saved } = writer(remote);
    await w.apply([up(row("a.md", "Uno"))]);
    await w.flush();
    expect(sent).toEqual([{ base: 7, changes: [up(row("a.md", "Uno"))] }]);
    expect(w.outbox).toEqual([]);
    expect(saved.at(-1)).toEqual([]);
  });

  it("keeps the queue without a connection, shows it over the server's rows, and sends it later", async () => {
    let online = false;
    const { remote, sent } = fakeServer(() =>
      online ? { version: 9, aliases: {} } : new RemoteError("network", "Failed to fetch"),
    );
    const { w, saved, rejected } = writer(remote);
    await w.apply([up(row("a.md", "Editado"))]);
    await w.apply([{ op: "remove", collectionId: "docencia", id: "b.md" }]);
    await w.flush();
    expect(w.outbox).toHaveLength(2);
    expect(saved.at(-1)).toHaveLength(2); // on the device, for the next start
    expect(rejected).toEqual([]);

    const server = [row("a.md", "Original"), row("b.md", "Otra"), row("c.md", "Tercera")];
    const shown = w.over(server, 7);
    expect(shown.map((r) => r.values.title)).toEqual(["Editado", "Tercera"]);
    expect(shown[1]).toBe(server[2]); // untouched rows keep their object

    online = true;
    await w.flush();
    // Everything waiting goes in one request, with the oldest version.
    expect(sent.at(-1)).toEqual({
      base: 7,
      changes: [up(row("a.md", "Editado")), { op: "remove", collectionId: "docencia", id: "b.md" }],
    });
    expect(w.outbox).toEqual([]);
  });

  it("learns the path of a new row and uses it from then on", async () => {
    const { remote, sent } = fakeServer((_, changes) => ({
      version: 8,
      aliases: changes.some((c) => c.op === "upsert" && c.row.id === "ev-1")
        ? { "ev-1": "agenda/docencia/2026-10-19 Nueva.md" }
        : {},
    }));
    const { w } = writer(remote);
    await w.apply([up(row("ev-1", "Nueva"))]);
    await w.flush();
    await w.apply([up(row("ev-1", "Nueva, cambiada"))]);
    await w.flush();
    expect(sent[1]?.changes).toEqual([
      up(row("agenda/docencia/2026-10-19 Nueva.md", "Nueva, cambiada")),
    ]);
  });

  it("keeps showing a sent change until the server's stream brings its version", async () => {
    const { remote } = fakeServer(() => ({ version: 8, aliases: { "ev-1": "b.md" } }));
    const { w } = writer(remote);
    await w.apply([up(row("ev-1", "Nueva"))]);
    await w.flush();
    expect(w.outbox).toEqual([]);
    // The stream is still at 7: the new row shows, already by its path (never twice).
    expect(w.over([row("a.md", "Uno")], 7).map((r) => r.id)).toEqual(["a.md", "b.md"]);
    const server8 = [row("a.md", "Uno"), row("b.md", "Nueva")];
    expect(w.over(server8, 8)).toBe(server8);
  });

  it("keeps a new row without a note (no title yet) on the device until it gets one", async () => {
    const { remote } = fakeServer((_, changes) => ({
      version: 7, // nothing changed on the server
      aliases: changes.some((c) => c.op === "upsert" && c.row.values.title)
        ? { "ev-2": "c.md" }
        : {},
    }));
    const { w } = writer(remote);
    const server = [row("a.md", "Uno")];
    w.over(server, 7);
    await w.apply([up({ ...row("ev-2", ""), values: { title: "" } })]);
    await w.flush();
    expect(w.over(server, 7).map((r) => r.id)).toEqual(["a.md", "ev-2"]);
    expect(w.over(server, 9).map((r) => r.id)).toEqual(["a.md", "ev-2"]); // also after newer versions

    await w.apply([up(row("ev-2", "Ya tiene título"))]);
    await w.flush();
    const withNote = [row("a.md", "Uno"), row("c.md", "Ya tiene título")];
    expect(w.over(withNote, 10)).toBe(withNote); // the note's row replaces the draft, never both
  });

  it("drops a batch the server refuses and says why", async () => {
    const { remote } = fakeServer(() => new RemoteError("conflict", "a.md"));
    const { w, rejected } = writer(remote);
    await w.apply([up(row("a.md", "Pisada"))]);
    await w.flush();
    expect(rejected).toEqual(["conflict"]);
    expect(w.outbox).toEqual([]);
  });
});
