import { afterEach, describe, expect, it } from "vitest";
import { type AndroidNative, androidHost } from "./android.ts";

/** A stand-in for the Android app: answers later, like the real one (its threads, then __boniReply). */
function fakeNative(answers: Record<string, unknown>) {
  const calls: { method: string; args: unknown[] }[] = [];
  const box = new Map<string, string>();
  const native: AndroidNative = {
    call(id, method, args) {
      calls.push({ method, args: JSON.parse(args) });
      const value = answers[method];
      box.set(
        id,
        JSON.stringify(
          value instanceof Error
            ? { ok: false, code: "not-found", message: value.message }
            : { ok: true, value: value ?? null },
        ),
      );
      setTimeout(() =>
        (window as unknown as { __boniReply: (id: string) => void }).__boniReply(id),
      );
    },
    take(id) {
      const v = box.get(id) ?? "";
      box.delete(id);
      return v;
    },
  };
  return { native, calls };
}

afterEach(() => {
  delete (window as { __boniReply?: unknown }).__boniReply;
});

describe("the Android host", () => {
  it("passes vault calls with their arguments and resolves with the app's answers", async () => {
    const { native, calls } = fakeNative({
      scan: [{ path: "agenda/a.md", mtimeMs: 5, size: 3 }],
      write: { conflict: false, mtimeMs: 9, size: 4 },
      read: new Error("No such note: x.md"),
    });
    const { vault } = androidHost(native);
    const [scan, write, read] = await Promise.all([
      vault.scan("agenda"),
      vault.write("agenda/a.md", "hola", 5),
      vault.read("x.md"),
    ]);
    expect(scan).toEqual({ ok: true, value: [{ path: "agenda/a.md", mtimeMs: 5, size: 3 }] });
    expect(write).toEqual({ ok: true, value: { conflict: false, mtimeMs: 9, size: 4 } });
    expect(read).toEqual({ ok: false, code: "not-found", message: "No such note: x.md" });
    expect(calls).toEqual([
      { method: "scan", args: ["agenda"] },
      { method: "write", args: ["agenda/a.md", "hola", 5] },
      { method: "read", args: ["x.md"] },
    ]);
  });

  it("downloads through the app, and a lost answer is an error, not a hang", async () => {
    const { native } = fakeNative({ fetchText: "BEGIN:VCALENDAR" });
    const host = androidHost(native);
    expect(await host.fetchText("https://example.com/x.ics")).toEqual({
      ok: true,
      value: "BEGIN:VCALENDAR",
    });
    const broken: AndroidNative = {
      call: (id) =>
        setTimeout(() =>
          (window as unknown as { __boniReply: (id: string) => void }).__boniReply(id),
        ),
      take: () => "not json",
    };
    expect(await androidHost(broken).vault.getRoot()).toMatchObject({
      ok: false,
      code: "bad-answer",
    });
  });
});
