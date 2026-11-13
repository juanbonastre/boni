/** (test) The Android app's side of the page: what is typed and not sent is kept before the page goes on (task 106). */
import { describe, expect, it } from "vitest";
import { type AndroidNative, androidHost } from "./android.ts";

describe("Boni Android's host", () => {
  it("keeps the list of what was typed with one call that has written it when it returns, not on the pool", () => {
    const written: string[] = [];
    const calls: string[] = [];
    const native: AndroidNative = {
      call: (_id, method) => void calls.push(method),
      take: () => "{}",
      keepUnsent: (text) => void written.push(text),
    };
    const host = androidHost(native);
    host.keepUnsent?.('[{"path":"api/data/rows/r_01"}]');
    expect(written).toEqual(['[{"path":"api/data/rows/r_01"}]']);
    expect(calls).toEqual([]);
  });

  it("an app built before it has none: the page keeps the list with the store's write, as before", () => {
    const host = androidHost({ call: () => undefined, take: () => "{}" });
    expect(host.keepUnsent).toBeUndefined();
  });

  it("attaches files chosen with the phone's picker (task 114): the page gets a key, a name and a size and how much has gone, never the file", async () => {
    const calls: string[] = [];
    const answers = new Map<string, string>();
    const w = window as unknown as {
      __boniReply: (id: string) => void;
      __boniEvent: (json: string) => void;
    };
    const reply = (id: string, a: unknown) => {
      answers.set(id, JSON.stringify(a));
      w.__boniReply(id);
    };
    const event = (e: unknown) => w.__boniEvent(JSON.stringify(e));
    let picked: unknown[] = [
      { key: "f1", name: "Factura FAC-2026-0142.pdf", size: 200_000 },
      { key: "f2", name: "IMG_0042.jpg", size: 3_000_000 },
    ];
    const native: AndroidNative = {
      call(id, method, args) {
        calls.push(`${method} ${args}`);
        setTimeout(() => {
          if (method === "chooseFiles") reply(id, { ok: true, value: picked });
          if (method === "uploadFile" && args === '["f1"]') {
            event({ type: "upload", key: "f1", sent: 50_000 });
            // Another file's: not this one's.
            event({ type: "upload", key: "f2", sent: 7 });
            reply(id, {
              ok: true,
              value: { status: 200, body: '{"id":"e_01drop1","name":"Factura FAC-2026-0142.pdf"}' },
            });
          }
          if (method === "uploadFile" && args === '["f2"]')
            reply(id, { ok: false, code: "failed", message: "gone" });
        }, 0);
      },
      take: (id) => answers.get(id) ?? "",
    };
    const host = androidHost(native);
    // Neither a File input nor a File: the phone's own picker.
    expect(host.uploadFile).toBeUndefined();
    const seen: string[] = [];
    host.onEvent((e) => void seen.push(e.type));
    const chosen = (await host.chooseFiles?.()) ?? [];
    expect(chosen.map((c) => [c.name, c.size])).toEqual([
      ["Factura FAC-2026-0142.pdf", 200_000],
      ["IMG_0042.jpg", 3_000_000],
    ]);
    const gone: number[][] = [];
    expect(await chosen[0]?.send((sent, size) => void gone.push([sent, size]))).toEqual({
      status: 200,
      body: '{"id":"e_01drop1","name":"Factura FAC-2026-0142.pdf"}',
    });
    expect(gone).toEqual([[50_000, 200_000]]);
    // A file the app could not send is the word «Falló», as on the desktop.
    expect(await chosen[1]?.send(() => undefined)).toEqual({ error: "offline" });
    expect(calls.filter((c) => !c.startsWith("getSettings"))).toEqual([
      "chooseFiles []",
      'uploadFile ["f1"]',
      'uploadFile ["f2"]',
    ]);
    // How much has gone is the file's own, never an event for the page.
    expect(seen).not.toContain("upload");
    // A cancelled picker is none.
    picked = [];
    expect(await host.chooseFiles?.()).toEqual([]);
  });
});
