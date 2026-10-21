import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import { ApiError, OfflineError } from "./api.ts";
import * as B from "./chartBuilder.ts";
import * as M from "./chartMath.ts";
import { nowIso, today } from "./clock.ts";
import { type ActionRequest, type ChartSpec, type FormComponent, parseScreen } from "./contract.ts";
import * as F from "./formLogic.ts";
import { OfflineQueue } from "./queue.ts";
import * as S from "./shortcuts.ts";
import { MemoryStore } from "./storage.ts";

const t = translator("es");

describe("chart math", () => {
  it("ticks are round", () => {
    expect(M.ticks(182)).toEqual([0, 50, 100, 150, 200]);
    expect(M.ticks(1610)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(M.ticks(0)).toEqual([0, 1]);
    expect(M.ticks(37, 3)[0]).toBe(0);
    expect(M.ticks(37, 3).at(-1)!).toBeGreaterThanOrEqual(37);
  });
  it("Spanish money and numbers", () => {
    expect(M.euros(1234.56)).toBe("1.234,56 €");
    expect(M.euros(82.14)).toBe("82,14 €");
    expect(M.eurosAuto(1260.56)).toBe("1.261 €");
    expect(M.euros(-60)).toBe("-60,00 €");
    expect(M.compact(2500)).toBe("2,5K");
    expect(M.compact(1000)).toBe("1K");
    expect(M.compact(150)).toBe("150");
    expect(M.number(1234)).toBe("1.234");
    expect(M.number(2.5)).toBe("2,5");
    expect(M.percent(51.6)).toBe("+51,6 %");
    expect(M.percent(-8.6)).toBe("-8,6 %");
    expect(M.formatAuto(12, "")).toBe("12");
    expect(M.formatAuto(12.5, "EUR")).toBe("12,50 €");
    expect(M.labelStep(12, 12)).toBe(1);
    expect(M.labelStep(31, 12)).toBe(3);
  });
});

describe("dates", () => {
  it("shift across months and leap years", () => {
    expect(F.shiftIso("2026-10-01", -1)).toBe("2026-09-30");
    expect(F.shiftIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(F.shiftIso("2024-03-01", -1)).toBe("2024-02-29");
    expect(F.shiftIso("2026-10-12", -2)).toBe("2026-10-10");
    expect(F.isIsoDate("2026-10-12")).toBe(true);
    expect(F.isIsoDate("2026-10-1")).toBe(false);
  });
  it("the device clock gives a local date and an ISO time with its offset", () => {
    expect(today(new Date(2026, 9, 12, 23, 59))).toBe("2026-10-12");
    const iso = nowIso(new Date(2026, 9, 12, 18, 30, 5));
    expect(iso).toMatch(/^2026-10-12T18:30:05[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).getTime()).toBe(new Date(2026, 9, 12, 18, 30, 5).getTime());
  });
});

describe("form logic", () => {
  const form: FormComponent = {
    type: "form",
    id: "expense",
    fields: [
      { type: "amount", id: "amount", label: "Importe", required: true, max: 100000, min: 0.01 },
      { type: "toggle", id: "shared", label: "Pagué yo por otros" },
      {
        type: "multi_choice",
        id: "invited",
        label: "Invitados",
        source: "people",
        visible_when: { field: "shared", equals: true },
      },
      { type: "date", id: "date", label: "Fecha", default: "today", required: true },
    ],
    submit: { action: "expenses.capture", label: "Guardar" },
  };
  it("initial values resolve today", () => {
    const v = F.initialValues(form, "2026-10-12");
    expect(v.date).toBe("2026-10-12");
    expect(v.shared).toBe(false);
  });
  it("visibility follows its condition", () => {
    const v = F.initialValues(form, "2026-10-12");
    expect(F.isVisible(form.fields[2]!, v)).toBe(false);
    expect(F.isVisible(form.fields[2]!, { ...v, shared: true })).toBe(true);
  });
  it("client checks and the payload", () => {
    let v = F.initialValues(form, "2026-10-12");
    expect(Object.keys(F.clientErrors(form, v))).toEqual(["amount"]);
    v = { ...v, amount: "abc" };
    expect(F.clientErrors(form, v).amount).toBe("not-a-number");
    v = { ...v, amount: "0" };
    expect(F.clientErrors(form, v).amount).toBe("too-low");
    v = { ...v, amount: "12,50", invited: ["ejemplo-persona"] };
    expect(F.clientErrors(form, v)).toEqual({});
    const p = F.payload(form, v);
    expect(p.amount).toBe(12.5);
    expect("invited" in p).toBe(false); // hidden: not sent
  });
  it("options are matched without accents or case", () => {
    const people = [
      { value: "pablo-soler-gil", label: "José Peña Ruíz", hint: "Colleague" },
      { value: "tomas", label: "Tomas" },
      { value: "comida/restaurante", label: "comida/restaurante" },
    ];
    expect(F.fold("Peña RUÍZ")).toBe("pena ruiz");
    expect(F.filterOptions(people, "PENA").map((o) => o.value)).toEqual(["pablo-soler-gil"]);
    expect(F.filterOptions(people, "peña pablo").map((o) => o.value)).toEqual(["pablo-soler-gil"]);
    expect(F.filterOptions(people, "rest").map((o) => o.value)).toEqual(["comida/restaurante"]);
    expect(F.filterOptions(people, "  ")).toHaveLength(3);
    expect(F.filterOptions(people, "zzz")).toEqual([]);
  });
});

describe("offline queue", () => {
  const req = (id: string): ActionRequest => ({
    action: "expenses.capture",
    client_id: id,
    values: { amount: 5 },
  });
  it("keeps order, stops when offline and keeps the rejected ones", async () => {
    const q = new OfflineQueue(new MemoryStore());
    for (const id of ["a", "b", "c", "d"]) await q.add(req(id));
    const sent: string[] = [];
    const n = await q.flush(async (r) => {
      sent.push(r.client_id);
      if (r.client_id === "b")
        return {
          status: "invalid",
          message: "Revisa",
          field_errors: { category: "Elige una categoría" },
        };
      if (r.client_id === "c") throw new OfflineError("down");
      return { status: "ok" };
    });
    expect(n).toBe(1);
    expect(sent).toEqual(["a", "b", "c"]); // d not tried once offline
    expect((await q.items()).map((i) => i.request.client_id)).toEqual(["b", "c", "d"]);
    expect((await q.items())[0]!.error).toBe("Revisa; category: Elige una categoría");
    expect(await q.pending()).toBe(2);
    // back online: c and d go; the rejected one stays until dismissed
    expect(await q.flush(async () => ({ status: "queued" }))).toBe(2);
    expect((await q.items()).map((i) => i.request.client_id)).toEqual(["b"]);
    await q.dismiss("b");
    expect(await q.items()).toEqual([]);
  });
  it("server errors and a bad token are retried later; a 404 is a rejection", async () => {
    const q = new OfflineQueue(new MemoryStore());
    await q.add(req("x"));
    expect(
      await q.flush(async () => Promise.reject(new ApiError(503, "source_unavailable", "down"))),
    ).toBe(0);
    expect(
      await q.flush(async () => Promise.reject(new ApiError(401, "unauthorized", "token"))),
    ).toBe(0);
    expect(await q.pending()).toBe(1);
    expect(await q.flush(async () => Promise.reject(new ApiError(404, "not_found", "no")))).toBe(0);
    expect(await q.pending()).toBe(0);
    expect((await q.items())[0]!.error).toBe("no");
  });
  it("a held capture waits for its Undo: not sent, not pending, until its time", async () => {
    const q = new OfflineQueue(new MemoryStore());
    const now = Date.now();
    await q.add(req("held"), now + 10_000);
    await q.add(req("now"));
    const sent: string[] = [];
    const send = async (r: ActionRequest) => {
      sent.push(r.client_id);
      return { status: "ok" as const };
    };
    expect(await q.flush(send, now + 5_000)).toBe(1);
    expect(sent).toEqual(["now"]);
    expect(await q.pending()).toBe(0); // held for 10 s: not counted as pending
    expect(await q.flush(send, now + 10_001)).toBe(1);
    expect(sent).toEqual(["now", "held"]);
    expect(await q.items()).toEqual([]);
    // Undo takes it out before it is sent
    await q.add(req("undone"), Date.now() + 60_000);
    await q.dismiss("undone");
    expect(await q.items()).toEqual([]);
  });
  it("reads the first client's queue file", async () => {
    const store = new MemoryStore();
    store.files.set(
      "queue.json",
      JSON.stringify([
        {
          request: {
            action: "expenses.capture",
            client_id: "k1",
            values: { amount: 3.2 },
            created_at: "2026-10-12T10:00:00+02:00",
          },
        },
      ]),
    );
    expect(await new OfflineQueue(store).pending()).toBe(1);
  });
});

describe("chart builder", () => {
  const base = B.newSpec("Nueva gráfica");
  const with_ = (p: Partial<ChartSpec>): ChartSpec => ({ ...base, ...p });
  it("a number has no axis nor series", () => {
    const s = B.normalize(
      with_({ kind: "number", split: { field: "group" }, top: 5, drilldown: true }),
    );
    expect(s.x).toBeNull();
    expect(s.split).toBeNull();
    expect(s.top).toBeNull();
    expect(s.drilldown).toBe(false);
  });
  it("leaving a number picks a default axis", () => {
    const n = B.normalize(with_({ kind: "number" }));
    expect(B.normalize({ ...n, kind: "hbar" }).x).toEqual({ field: "group" });
    expect(B.normalize({ ...n, kind: "line" }).x).toEqual({ field: "date", granularity: "month" });
  });
  it("stacked bars always have series, and series drop the comparison", () => {
    const s = B.normalize(with_({ kind: "stacked_bar", compare: "previous_year" }));
    expect(s.split).toEqual({ field: "group" });
    expect(s.compare).toBe("none");
    const d = B.normalize({
      ...s,
      kind: "donut",
      x: { field: "category" },
      compare: "previous_period",
    });
    expect(d.split).toBeNull();
    expect(d.compare).toBe("none");
  });
  it("series cannot repeat the axis; dates get a granularity; top N only for categories", () => {
    expect(B.normalize(with_({ x: { field: "group" }, split: { field: "group" } })).split).toEqual({
      field: "category",
    });
    const d = B.normalize(
      with_({ x: { field: "date" }, split: { field: "merchant", granularity: "month" } }),
    );
    expect(d.x).toEqual({ field: "date", granularity: "month" });
    expect(d.split).toEqual({ field: "merchant" });
    expect(B.normalize(with_({ top: 5 })).top).toBeNull();
    expect(B.normalize(with_({ kind: "hbar", x: { field: "merchant" }, top: 5 })).top).toBe(5);
  });
  it("a period keeps only its own fields", () => {
    expect(B.normalize(with_({ period: { kind: "last_days", months: 12 } })).period).toEqual({
      kind: "last_days",
      days: 30,
    });
    expect(B.normalize(with_({ period: { kind: "this_month", months: 3 } })).period).toEqual({
      kind: "this_month",
    });
  });
  it("describes a chart and labels its filters", () => {
    const s = with_({
      period: { kind: "last_months", months: 6 },
      filters: [{ field: "category", op: "prefix", values: ["comida"] }],
      compare: "previous_year",
    });
    expect(B.describe(t, s, null)).toBe(
      "bar · spending · por month · Últimos 6 meses · previous_year · 1 filtro",
    );
    expect(B.opLabel(t, "category", "prefix")).toBe("es del grupo o es");
    expect(B.opLabel(t, "amount", "gte")).toBe("mayor o igual que");
    const copy = B.duplicate({ ...base, id: "x" }, "copia");
    expect(copy.title).toBe("Nueva gráfica (copia)");
    expect(copy.id).toBe("");
  });
});

describe("shortcuts", () => {
  const form = parseScreen(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "..", "api", "examples", "screen-capture-expense.json"),
        "utf8",
      ),
    ),
  ).components[0] as FormComponent;
  const options = { categories: [{ value: "bebida/cafe", label: "bebida/cafe" }] };

  it("keep what was chosen or typed, never the date, empty fields or hidden ones", () => {
    const values = {
      ...F.initialValues(form, "2026-10-18"),
      amount: "1,60",
      category: "bebida/cafe",
      concept: "Café",
      invited: ["nadie"], // hidden: "shared" is off
    };
    expect(S.shortcutValues(form, values)).toEqual({
      kind: "gasto",
      amount: "1,60",
      account: "efectivo",
      category: "bebida/cafe",
      concept: "Café",
    });
  });

  it("summary: most telling first, labels from the field or the loaded lists", () => {
    const values = {
      kind: "gasto",
      amount: 1.6,
      account: "efectivo",
      category: "bebida/cafe",
      shared: true,
    };
    expect(S.summary(form, values, options)).toEqual([
      "1,60 €",
      "bebida/cafe",
      "Pagué yo por otros",
      "Gasto",
      "Efectivo",
    ]);
    expect(S.suggestedLabel(form, { ...values, concept: "Café" }, options)).toBe("Café");
    expect(S.suggestedLabel(form, values, options)).toBe("1,60 € · bebida/cafe");
  });

  it("saved directly only when every required field has a value (the date is today's)", () => {
    expect(S.canSaveDirectly(form, { amount: 1.6, category: "bebida/cafe" }, "2026-10-18")).toBe(
      true,
    );
    expect(S.canSaveDirectly(form, { amount: 1.6 }, "2026-10-18")).toBe(false);
    expect(S.filledValues(form, { amount: 1.6 }, "2026-10-18").date).toBe("2026-10-18");
  });
});

describe("counts in the interface", () => {
  it('1 takes the singular, never "1 elementos"', async () => {
    const { translator } = await import("../i18n.ts");
    for (const lang of ["es", "en"] as const) {
      const t = translator(lang);
      expect(t("ai.count", { n: 1 })).toBe(lang === "es" ? "1 elemento" : "1 item");
      expect(t("ai.count", { n: 2 })).toBe(lang === "es" ? "2 elementos" : "2 items");
      expect(t("mail.reread.option", { n: 1 })).toBe(lang === "es" ? "1 día" : "1 day");
      expect(t("ai.count", { n: 0 })).toBe(lang === "es" ? "0 elementos" : "0 items");
    }
  });
});
