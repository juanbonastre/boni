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
  it("passes calls with their arguments and resolves with the app's answers; a record opens in Boni's app", async () => {
    const { native, calls } = fakeNative({
      fetchText: new Error("No network"),
      networkAllowed: false,
    });
    const host = androidHost(native);
    // «Abrir en Boni» opens the record in Boni's Android app; a phone has no peek.
    expect(host.notes).toMatchObject({ noteApp: "boni", peek: false });
    const [text, allowed, opened] = await Promise.all([
      host.fetchText("https://example.com/a.ics"),
      host.network.allowed(),
      host.notes?.openNote?.("e_ejemplo1"),
    ]);
    expect(text).toMatchObject({ ok: false, message: "No network" });
    expect(allowed).toBe(false);
    expect(opened).toEqual({ ok: true, value: null });
    expect(calls).toEqual([
      { method: "fetchText", args: ["https://example.com/a.ics"] },
      { method: "networkAllowed", args: [] },
      { method: "openBoniNote", args: ["e_ejemplo1"] },
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
    expect(await androidHost(broken).fetchText("https://example.com/b.ics")).toMatchObject({
      ok: false,
      code: "bad-answer",
    });
  });
});
