/**
 * The queue of changes the server has not taken yet, kept on the device at once (task 98): a window closed the
 * moment after a change finds it when it opens again, before IndexedDB has written its copy.
 */
import type { RowChange } from "@boni/calendar";
import { afterEach, describe, expect, it, vi } from "vitest";

// IndexedDB's copy, in memory: it is written only once a test lets its writes finish (`settle`), as a real one is
// written only after its database opens.
const idb = vi.hoisted(() => ({ data: new Map<string, unknown>(), pending: [] as (() => void)[] }));
vi.mock("./idb.ts", () => ({
  kvStore: () => ({
    get: async (key: string) => idb.data.get(key) ?? null,
    put: (key: string, value: unknown) =>
      new Promise<void>((done) =>
        idb.pending.push(() => {
          idb.data.set(key, structuredClone(value));
          done();
        }),
      ),
    delete: async (key: string) => {
      idb.data.delete(key);
    },
  }),
}));
const { savedOutbox, saveOutbox } = await import("./remote.ts");
type Outbox = Awaited<ReturnType<typeof savedOutbox>>[number];
const settle = () => {
  for (const write of idb.pending.splice(0)) write();
};

const batch = (title: string): Outbox => ({
  base: 3,
  changes: [
    {
      op: "upsert",
      row: {
        id: "local-1",
        collectionId: "docencia",
        values: { title, date: "2026-10-19" },
        created: 0,
        updated: 0,
      },
    } satisfies RowChange,
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  idb.data.clear();
  idb.pending.length = 0;
});

describe("the outbox on the device", () => {
  it("holds a queue the moment it is saved, with none of its writes finished (the window closed at once)", async () => {
    // Not awaited, and IndexedDB never written: the page goes before either.
    void saveOutbox("srv", [batch(""), batch("Creada y cerrada")]);
    expect(await savedOutbox("srv")).toEqual([batch(""), batch("Creada y cerrada")]);
    void saveOutbox("srv", []);
    expect(await savedOutbox("srv")).toEqual([]);
  });

  it("keeps each server's queue apart", async () => {
    void saveOutbox("a", [batch("Una")]);
    void saveOutbox("b", [batch("Otra")]);
    expect(await savedOutbox("a")).toEqual([batch("Una")]);
    expect(await savedOutbox("b")).toEqual([batch("Otra")]);
  });

  it("reads a queue a device kept before this (only in IndexedDB)", async () => {
    idb.data.set("srv", [batch("De antes")]);
    expect(await savedOutbox("srv")).toEqual([batch("De antes")]);
  });

  it("never leaves an older queue behind when localStorage refuses a write (full): IndexedDB's copy is read", async () => {
    void saveOutbox("srv", [batch("Ya enviada")]);
    settle();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    void saveOutbox("srv", [batch("La última")]);
    settle();
    expect(await savedOutbox("srv")).toEqual([batch("La última")]);
  });
});
