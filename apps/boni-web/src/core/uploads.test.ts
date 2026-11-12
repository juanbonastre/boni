import { describe, expect, it } from "vitest";
import { readKept, toKept } from "./boniWindow.ts";
import {
  dropped,
  MAX_DROP_BYTES,
  percent,
  uploadEnd,
  uploadPath,
  uploadsIn,
  withUploads,
} from "./uploads.ts";

/** Files dropped on Boni's window (docs/sistema.md §4.7, A-24): their chips while they go up and once they are there. */
describe("a dropped file's chip", () => {
  it("is refused at once past 1 GB, says how much has gone, and never 100 % before the server answers", () => {
    expect(dropped("u1", { name: "vídeo.mp4", size: MAX_DROP_BYTES + 1 }).state).toBe("too-big");
    expect(dropped("u1", { name: "vacío.txt", size: 0 }).state).toBe("failed");
    const u = dropped("u1", { name: "Factura FAC-2026-0142.pdf", size: 200_000 });
    expect(u.state).toBe("uploading");
    expect(percent({ ...u, sent: 50_000 })).toBe(25);
    expect(percent({ ...u, sent: 200_000 })).toBe(99);
  });

  it("is kept by conversation, as drafts, and the list of one with none is none", () => {
    const a = dropped("u1", { name: "a.pdf", size: 10 });
    let all = withUploads({}, null, (l) => [...l, a]);
    all = withUploads(all, "k_1", (l) => [...l, { ...a, key: "u2" }]);
    expect(uploadsIn(all, null).map((x) => x.key)).toEqual(["u1"]);
    expect(uploadsIn(all, "k_1").map((x) => x.key)).toEqual(["u2"]);
    all = withUploads(all, null, (l) => l.filter((x) => x.key !== "u1"));
    expect(Object.keys(all)).toEqual(["k_1"]);
    // The same empty list each time: the bar's selector does not redraw it forever.
    expect(uploadsIn(all, null)).toBe(uploadsIn({}, "k_2"));
  });

  it("goes up with its name escaped strictly; a name with a folder or hidden is not sent", () => {
    expect(uploadPath("Factura FAC-2026-0142 (taller) ñ.pdf")).toBe(
      "api/data/files/upload?name=Factura%20FAC-2026-0142%20%28taller%29%20%C3%B1.pdf",
    );
    for (const n of ["", "  ", "../x.pdf", "a/b.pdf", "a\\b.pdf", ".oculto"])
      expect(uploadPath(n)).toBeNull();
  });

  it("is a row of his files once the server has it, with the word of what a reader will not get", () => {
    const answer = (state: string) => ({
      status: 200,
      body: JSON.stringify({ id: "e_01m6abc", name: "Factura (2).pdf", state }),
    });
    expect(uploadEnd(answer("text"))).toEqual({
      chip: { ref: { kind: "row", id: "e_01m6abc" }, title: "Factura (2).pdf", file: "read" },
    });
    expect(uploadEnd(answer("unreadable"))).toMatchObject({ chip: { file: "unreadable" } });
    expect(uploadEnd(answer("too-big"))).toMatchObject({ chip: { file: "too-big" } });
    expect(uploadEnd({ status: 413, body: '{"error":"too-big"}' })).toEqual({ state: "too-big" });
    expect(uploadEnd({ error: "too-big" })).toEqual({ state: "too-big" });
    expect(uploadEnd({ error: "offline" })).toEqual({ state: "failed" });
    expect(uploadEnd({ status: 500, body: "" })).toEqual({ state: "failed" });
    expect(uploadEnd({ status: 200, body: "<html>" })).toEqual({ state: "failed" });
  });

  it("stays in the draft after a restart, with its word (I-35)", () => {
    const chip = { ref: { kind: "row" as const, id: "e_01m6abc" }, title: "nómina.pdf" };
    const k = readKept(
      JSON.parse(
        JSON.stringify(
          toKept({
            mode: "float",
            place: null,
            conversation: "k_1",
            drafts: {
              k_1: {
                text: "",
                pointed: [
                  { ...chip, file: "unreadable" },
                  { ...chip, ref: { kind: "row", id: "e_2" }, file: "nonsense" as "read" },
                ],
              },
            },
          }),
        ),
      ),
    );
    expect(k.drafts.k_1?.pointed).toEqual([
      { ...chip, file: "unreadable" },
      { ...chip, ref: { kind: "row", id: "e_2" } },
    ]);
  });
});
