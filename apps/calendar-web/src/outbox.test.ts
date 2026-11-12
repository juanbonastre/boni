/**
 * The queue of changes the server has not taken yet, kept on the device at once (task 98): a window closed the
 * moment after a change finds it when it opens again, before IndexedDB has written its copy.
 */
import type { RowChange } from "@boni/calendar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Outbox, savedOutbox, saveOutbox } from "./remote.ts";

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
});

describe("the outbox on the device", () => {
  it("holds a queue the moment it is saved, with none of its writes finished (the window closed at once)", async () => {
    // Not awaited: the page goes before any promise of the save resolves.
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

  it("never leaves an older queue behind when localStorage refuses a write (full): an older one would be sent again", async () => {
    void saveOutbox("srv", [batch("Ya enviada")]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    void saveOutbox("srv", []);
    expect(await savedOutbox("srv")).not.toEqual([batch("Ya enviada")]);
  });
});
