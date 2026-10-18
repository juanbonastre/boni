import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type KEYS, missingIn } from "../i18n.ts";
import { ApiError, BoniApi, OfflineError, type Transport } from "./api.ts";
import { newSpec } from "./chartBuilder.ts";
import { ChartRepository } from "./charts.ts";
import {
  type ChartCatalog,
  type ChartData,
  type FormComponent,
  parseScreen,
  parseShortcut,
  parseSpec,
  type Widget,
} from "./contract.ts";
import { MemoryStore } from "./storage.ts";

/** The client must understand exactly what the server sends: `api/examples/` are real server answers. */
const EXAMPLES = join(import.meta.dirname, "..", "..", "..", "..", "api", "examples");
const ex = (name: string) => readFileSync(join(EXAMPLES, name), "utf8");
const json = <V>(name: string) => JSON.parse(ex(name)) as V;

describe("contract", () => {
  it("parses every example", () => {
    expect(readdirSync(EXAMPLES).length).toBeGreaterThan(10);
    const home = parseScreen(json("home.json"));
    expect(home.components[0]!.type).toBe("button");
    expect(home.components.filter((c) => c.type === "chart_card")).toHaveLength(3);

    const form = parseScreen(json("screen-capture-expense.json")).components[0] as FormComponent;
    expect(form.type).toBe("form");
    expect(form.submit.action).toBe("expenses.capture");
    expect(form.fields.some((f) => f.type === "unknown")).toBe(false);
    const category = form.fields.find((f) => f.id === "category");
    expect(category?.type === "choice" && category.source).toBe("categories");
    expect(form.fields.find((f) => f.id === "invited")?.visible_when?.field).toBe("shared");

    for (const name of [
      "chart-spending-by-category.json",
      "chart-spending-by-category-drill.json",
      "chart-monthly-spending.json",
      "chart-eating-out.json",
    ]) {
      expect(json<ChartData>(name).series[0]!.points.length, name).toBeGreaterThan(0);
    }
    const monthly = json<ChartData>("chart-monthly-spending.json");
    expect(monthly.series[0]!.points.at(-1)!.partial).toBe(true);
    expect(monthly.series[0]!.points[0]!.no_data).toBe(true);
    const split = json<ChartData>("chart-preview-split.json");
    expect(split.kind).toBe("stacked_bar");
    expect(split.series.every((s) => s.role === "split")).toBe(true);
    const cmp = json<ChartData>("chart-preview-compare.json");
    expect(cmp.series.at(-1)!.role).toBe("compare");
    expect(cmp.delta_pct).not.toBeNull();
    expect(json<ChartData>("chart-preview-donut.json").series[0]!.points.at(-1)!.key).toBe("_rest");

    const charts = json<{ charts: unknown[] }>("charts.json").charts.map(parseSpec);
    expect(charts.map((c) => c.id)).toEqual([
      "spending-by-category",
      "monthly-spending",
      "eating-out",
    ]);
    expect(charts[0]!.x?.field).toBe("group");
    expect(charts[2]!.filters).toHaveLength(2);
    const catalog = json<ChartCatalog>("chart-catalog.json");
    expect(catalog.fields.some((f) => f.id === "merchant" && f.source === "merchants")).toBe(true);
    expect(catalog.kinds.map((k) => k.id)).toEqual(
      expect.arrayContaining([
        "bar",
        "stacked_bar",
        "hbar",
        "line",
        "area",
        "donut",
        "number",
        "table",
      ]),
    );
    expect(
      parseSpec(json<{ spec: unknown }>("chart-preview-split-request.json").spec).split,
    ).toEqual({ field: "group" });
    expect(json<{ widgets: Widget[] }>("widgets.json").widgets).toHaveLength(3);
    const shortcuts = json<{ shortcuts: unknown[] }>("shortcuts.json").shortcuts.map(parseShortcut);
    expect(shortcuts.map((s) => [s.id, s.mode, s.color])).toEqual([
      ["cafe", "save", "#fb923c"],
      ["comida-con-pablo", "open", null],
    ]);
    expect(shortcuts[0]!.values.amount).toBe(1.6);
    expect(parseShortcut({ label: "X", screen: "s", mode: "later" }).mode).toBe("open");
    expect(
      json<{ field_errors: Record<string, string> }>("action-result-invalid.json").field_errors,
    ).toHaveProperty("amount");
    expect(json<{ error: { code: string } }>("error.json").error.code).toBe("unauthorized");
  });

  it("unknown types from a newer server do not break", () => {
    const s = parseScreen({
      id: "x",
      title: "X",
      new_top_field: 1,
      components: [
        { type: "voice_button", label: "Habla" },
        {
          type: "form",
          id: "f",
          submit: { action: "a", label: "Ok" },
          fields: [{ type: "slider", id: "s", label: "S" }],
        },
      ],
    });
    expect(s.components[0]).toEqual({ type: "unknown", original: "voice_button" });
    expect((s.components[1] as FormComponent).fields[0]!.type).toBe("unknown");
  });
});

/** A fake server over the transport: answers from api/examples, remembers what was asked. */
function fakeServer(
  answer?: (method: string, path: string) => [number, string] | "offline" | undefined,
) {
  const seen: string[] = [];
  const transport: Transport = {
    async request(method, path) {
      seen.push(`${method} /${path}`);
      const a = answer?.(method, path);
      if (a === "offline") return { ok: false, offline: true, message: "refused" };
      if (a) return { ok: true, status: a[0], body: a[1] };
      const p = path.split("?")[0]!;
      if (method === "DELETE") return { ok: true, status: 204, body: "" };
      if (p.endsWith("/home")) return { ok: true, status: 200, body: ex("home.json") };
      if (p.endsWith("/preview"))
        return { ok: true, status: 200, body: ex("chart-preview-split.json") };
      if (p.endsWith("/catalog")) return { ok: true, status: 200, body: ex("chart-catalog.json") };
      if (p.endsWith("/widgets") && method === "GET")
        return { ok: true, status: 200, body: ex("widgets.json") };
      if (p.endsWith("/shortcuts") && method === "GET")
        return { ok: true, status: 200, body: ex("shortcuts.json") };
      if (p.endsWith("/shortcuts/order"))
        return { ok: true, status: 200, body: ex("shortcuts.json") };
      if (p.includes("/shortcuts"))
        return {
          ok: true,
          status: 200,
          body: '{"id":"cafe","label":"Café","screen":"capture-expense"}',
        };
      if (p.includes("/widgets"))
        return { ok: true, status: 200, body: '{"id":"w-x","chart_id":"x","size":"large"}' };
      if ((p.endsWith("/charts") && method === "GET") || p.endsWith("/order"))
        return { ok: true, status: 200, body: ex("charts.json") };
      if (p.includes("/data")) return { ok: true, status: 200, body: ex("chart-eating-out.json") };
      return {
        ok: true,
        status: 200,
        body: '{"id":"nueva","title":"Nueva","kind":"bar","period":{"kind":"this_month"}}',
      };
    },
  };
  return { transport, seen };
}

describe("api", () => {
  it("maps errors", async () => {
    const { transport } = fakeServer((_m, p) =>
      p.endsWith("/widgets")
        ? [401, ex("error.json")]
        : p.endsWith("/home")
          ? "offline"
          : undefined,
    );
    const api = new BoniApi(transport);
    const e = await api.widgets().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(401);
    expect(e.code).toBe("unauthorized");
    await expect(api.home()).rejects.toBeInstanceOf(OfflineError);
  });

  it("the editor's calls use the documented routes", async () => {
    const { transport, seen } = fakeServer();
    const api = new BoniApi(transport);
    const spec = newSpec("Nueva");
    expect((await api.preview(spec)).kind).toBe("stacked_bar");
    expect((await api.createChart(spec)).id).toBe("nueva");
    await api.updateChart({ ...spec, id: "nueva" });
    await api.orderCharts(["eating-out"]);
    await api.deleteChart("nueva");
    await api.addWidget("x", "large");
    await api.deleteWidget("w-x");
    expect((await api.catalog()).fields.length).toBeGreaterThan(0);
    await api.options("people", "ped ro", 500);
    await api.chartData("spending-by-category", "comida");
    expect(await api.shortcuts()).toHaveLength(2);
    const sc = await api.createShortcut({
      id: "ignored",
      label: "Café",
      screen: "capture-expense",
      values: {},
      mode: "open",
      color: null,
    });
    expect(sc.id).toBe("cafe");
    await api.updateShortcut(sc);
    expect((await api.orderShortcuts(["comida-con-pablo"]))[0]!.id).toBe("cafe");
    await api.deleteShortcut("cafe");
    expect(seen).toEqual(
      expect.arrayContaining([
        "POST /api/v1/charts/preview",
        "POST /api/v1/charts",
        "PUT /api/v1/charts/nueva",
        "PUT /api/v1/charts/order",
        "DELETE /api/v1/charts/nueva",
        "POST /api/v1/widgets",
        "DELETE /api/v1/widgets/w-x",
        "GET /api/v1/charts/catalog",
        "GET /api/v1/options/people?q=ped%20ro&limit=500",
        "GET /api/v1/charts/spending-by-category/data?drill=comida",
        "GET /api/v1/shortcuts",
        "POST /api/v1/shortcuts",
        "PUT /api/v1/shortcuts/cafe",
        "PUT /api/v1/shortcuts/order",
        "DELETE /api/v1/shortcuts/cafe",
      ]),
    );
  });

  it("cards and widgets of one chart share one request per refresh, and offline shows the saved answer", async () => {
    const { transport, seen } = fakeServer();
    const store = new MemoryStore();
    const repo = new ChartRepository(() => new BoniApi(transport), store);
    await Promise.all([repo.load("eating-out", null, 0), repo.load("eating-out", null, 0)]);
    await repo.load("eating-out", null, 0);
    expect(repo.requests).toBe(1);
    await repo.load("eating-out", null, 1);
    await repo.load("eating-out", null, 1);
    expect(repo.requests).toBe(2);
    repo.invalidate();
    await repo.load("eating-out", null, 1);
    expect(repo.requests).toBe(3);
    expect(seen.filter((s) => s.includes("/data"))).toHaveLength(3);
    expect(store.files.has("chart-eating-out.json")).toBe(true);
    // offline: the last saved answer, marked as such
    const offline = new ChartRepository(
      () => new BoniApi(fakeServer(() => "offline").transport),
      store,
    );
    const s = await offline.load("eating-out", null, 5);
    expect(s.offline).toBe(true);
    expect(s.data?.chart_id).toBe("eating-out");
  });
});

describe("texts", () => {
  it("English has every Spanish text", () => {
    expect(missingIn("en")).toEqual([] as typeof KEYS);
  });
});
