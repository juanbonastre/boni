import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** The server's documented answers (`api/examples`): the fake server below answers with them. */
const DIR = join(import.meta.dirname, "..", "apps", "boni-web", "api", "examples");
export const EXAMPLES: Record<string, string> = Object.fromEntries(
  readdirSync(DIR).map((f) => [f, readFileSync(join(DIR, f), "utf8")]),
);

export interface Shell {
  /** What the page asked the server: "POST api/v1/actions {...}". */
  requests: string[];
  /** Calls to the shell: "moveBy 10 0", "openMain charts"... */
  calls: string[];
}

export interface Options {
  /** Answer of POST actions: "ok", "invalid" or "offline". */
  action?: "ok" | "invalid" | "offline";
  /** Every request fails as if there were no network. */
  offline?: boolean;
  configured?: boolean;
  /** Configured with a device token of the first clients (no user): the page asks to log in. */
  legacy?: boolean;
  language?: "es" | "en";
  /** Files on the device (store), by name. */
  files?: Record<string, string>;
  /** Answers of the agent's API (and the mailbox's, "GET api/mail"), in order, by "METHOD path" ("POST
   * api/agent/turn"); the last one repeats. */
  agent?: Record<string, unknown[]>;
  /** The account's pages (`/api/pages`, kept in memory as the server would); null: a server without
   * them. By default one page as the first Boni's home becomes (`PAGE_FROM_HOME`). */
  pages?: FakePage[] | null;
  /** Pending proposals of Libros drawn as ghost rows (`{ id, proposal, values }`); deciding one takes it out. */
  ghosts?: { id: string; proposal: string; values: Record<string, unknown>; updated: number }[];
  /** How long accepting a proposal takes (ms; default as any request, 20). */
  acceptMs?: number;
}

export interface FakePage {
  id: string;
  title: string;
  icon?: string;
  parent?: string | null;
  position?: number;
  spec: { version: 1; full?: boolean; blocks: Record<string, unknown>[] };
}

/** What an account that used the first Boni gets once (apps/server/src/pages.ts, seedFromV1). */
export const PAGE_FROM_HOME: FakePage = {
  id: "gastos",
  title: "Gastos",
  spec: {
    version: 1,
    full: true,
    blocks: [
      { id: "b1", type: "action", screen: "capture-expense", label: "Apuntar gasto" },
      { id: "b2", type: "action", screen: "capture-expense", label: "Café", shortcut: "cafe" },
      { id: "b3", type: "chart", chart: "spending-by-category" },
      { id: "b4", type: "chart", chart: "monthly-spending" },
      { id: "b5", type: "chart", chart: "eating-out" },
    ],
  },
};

/**
 * Opens the page with a stand-in for the desktop shell (`window.boniDesktop`, as preload.cjs gives it): its
 * requests are answered from api/examples, its files live in memory, and what the page asks is recorded.
 */
export async function openApp(page: Page, url = "/", opts: Options = {}): Promise<void> {
  const pages = opts.pages === undefined ? [PAGE_FROM_HOME] : opts.pages;
  await page.addInitScript(
    ({ examples, opts, pages }) => {
      const w = window as unknown as Record<string, unknown>;
      const record = (key: string, v: string) => {
        const list = (w[key] as string[] | undefined) ?? [];
        list.push(v);
        w[key] = list;
      };
      const files = new Map<string, string>(Object.entries(opts.files ?? {}));
      const listeners = new Set<(e: unknown) => void>();
      let settings = {
        serverUrl: opts.configured === false ? "" : "https://boni.example.ts.net",
        hasToken: opts.configured !== false,
        user: opts.configured === false || opts.legacy ? "" : "ejemplo",
        device: opts.configured === false ? "" : "portatil",
        legacyToken: Boolean(opts.legacy),
        sessionEnded: false,
        live: true,
        theme: "dark",
        language: opts.language ?? "es",
        showWidgets: true,
        hiddenWidgets: [] as string[],
        autostart: true,
        layerAvailable: true,
      };
      const agentCalls: Record<string, number> = {};
      let ghosts = opts.ghosts ?? [];
      // The inbox as the server keeps it: accepting or rejecting a proposal takes it out.
      let inbox = (
        opts.agent?.["GET api/agent/proposals"]?.[0] as { proposals: { id: string }[] } | undefined
      )?.proposals;
      // The questions as the server keeps them: answering or putting one away takes it out.
      let asked = (
        opts.agent?.["GET api/agent/requests"]?.[0] as { requests: { id: string }[] } | undefined
      )?.requests;
      // The pages as the server keeps them (apps/server/src/pages.ts), with its trash for Undo.
      const pageList = (pages ?? []).map((x, i) => ({
        icon: "",
        parent: null,
        position: i + 1,
        ...x,
      })) as Record<string, unknown>[];
      const trash: Record<string, unknown>[] = [];
      let made = 0;
      const pageAnswer = (method: string, p: string, body?: unknown): [number, string] => {
        if (pages === null) return [503, '{"error":"agent-off"}'];
        const info = ({ spec: _s, ...rest }: Record<string, unknown>) => rest;
        const m = /^api\/pages\/([^/]+)(\/restore)?$/.exec(p);
        const b = (body ?? {}) as Record<string, unknown>;
        if (!m) {
          if (method === "GET") return [200, JSON.stringify({ pages: pageList.map(info) })];
          const page = {
            id: `p${++made}`,
            title: b.title,
            icon: "",
            parent: b.parent ?? null,
            position: pageList.length + 1,
            spec: b.spec ?? { version: 1, blocks: [] },
          };
          pageList.push(page);
          return [200, JSON.stringify({ page })];
        }
        const id = m[1]!;
        if (m[2]) {
          const i = trash.findIndex((x) => x.id === id);
          if (i < 0) return [404, '{"error":"not-found"}'];
          const [back] = trash.splice(i, 1);
          pageList.push(back!);
          return [200, JSON.stringify({ page: back })];
        }
        const i = pageList.findIndex((x) => x.id === id);
        if (i < 0) return [404, '{"error":"not-found"}'];
        if (method === "GET") return [200, JSON.stringify({ page: pageList[i] })];
        if (method === "DELETE") {
          const [gone] = pageList.splice(i, 1);
          trash.push(gone!);
          for (const x of pageList) if (x.parent === id) x.parent = gone!.parent ?? null;
          return [200, "{}"];
        }
        pageList[i] = { ...pageList[i], ...b };
        return [200, JSON.stringify({ page: pageList[i] })];
      };
      // The user's collections as databases (apps/server/src/data.ts), kept in memory.
      const libros = {
        id: "t_libro",
        name: "Libros",
        icon: "📚",
        titleField: "f_titulo",
        count: 3,
        level: "visible",
        fields: [
          { id: "f_titulo", name: "Título", type: "text" },
          {
            id: "f_estado",
            name: "Estado",
            type: "select",
            options: [
              { id: "o_pendiente", name: "Pendiente" },
              { id: "o_leyendo", name: "Leyendo" },
              { id: "o_leido", name: "Leído" },
            ],
          },
          { id: "f_paginas", name: "Páginas", type: "number" },
          { id: "f_fin", name: "Terminado", type: "date" },
          { id: "f_fav", name: "Favorito", type: "checkbox" },
        ],
        rowUi: { open: false, hidden: [] as string[] },
      };
      // A collection from the vault's private/ (Colecciones lists it, locked).
      const documentos = {
        id: "t_private_documentos",
        name: "Documentos",
        icon: "",
        titleField: "f_title",
        count: 2,
        level: "private",
        zone: "private",
        fields: [{ id: "f_title", name: "Título", type: "text" }],
        rowUi: { open: false, hidden: [] as string[] },
      };
      const today = new Date().toISOString().slice(0, 10);
      let rows: { id: string; values: Record<string, unknown>; updated: number }[] = [
        {
          id: "r1",
          values: { f_titulo: "Rayuela", f_estado: "o_leyendo", f_paginas: 600 },
          updated: 3,
        },
        {
          id: "r2",
          values: { f_titulo: "Ficciones", f_estado: "o_leido", f_fin: today },
          updated: 2,
        },
        { id: "r3", values: { f_titulo: "Pedro Páramo", f_estado: "o_pendiente" }, updated: 1 },
      ];
      const gone: typeof rows = [];
      let rowSeq = 0;
      const dataAnswer = (method: string, p: string, body?: unknown): [number, string] => {
        const b = (body ?? {}) as { values?: Record<string, unknown> };
        if (p === "api/data/types") return [200, JSON.stringify({ types: [libros, documentos] })];
        // A page's numbers and charts (apps/server/src/blocks.ts), counted over the books here.
        if (p === "api/data/blocks") {
          const list = ((body ?? {}) as { blocks?: Record<string, unknown>[] }).blocks ?? [];
          const results = Object.fromEntries(
            list.map((x) => {
              if (x.collection !== "t_libro")
                return [
                  x.id,
                  {
                    problems: [
                      { block: x.id, key: "collection", code: "not-in-data", value: x.collection },
                    ],
                  },
                ];
              const field = libros.fields.find((f) => f.id === x.groupBy) as
                | { options?: { id: string; name: string }[] }
                | undefined;
              const by = new Map<string, number>();
              for (const r of rows) {
                const k = String(r.values[String(x.groupBy)] ?? "");
                by.set(k, (by.get(k) ?? 0) + 1);
              }
              const points =
                x.type === "number"
                  ? []
                  : [...by].map(([k, v]) => ({
                      key: k || "_",
                      label: field?.options?.find((o) => o.id === k)?.name ?? (k || "(vacío)"),
                      value: v,
                      partial: false,
                      no_data: false,
                    }));
              const kind = x.type === "graph" ? x.shape : x.type === "bars" ? "hbar" : "number";
              const data = {
                chart_id: "",
                title: x.title,
                subtitle: "octubre 2026 · hasta hoy",
                kind,
                measure: "count",
                unit: "",
                series: [{ key: "main", name: "", points, role: "main" }],
                total: rows.length,
                computed_at: new Date().toISOString(),
              };
              return [x.id, { data }];
            }),
          );
          return [200, JSON.stringify({ results })];
        }
        const rowUi = /^api\/data\/types\/([^/]+)\/row-ui$/.exec(p);
        if (rowUi) {
          const t = [libros, documentos].find((x) => x.id === rowUi[1]);
          if (!t) return [404, '{"error":"not-found"}'];
          t.rowUi = { ...t.rowUi, ...((body ?? {}) as Partial<typeof t.rowUi>) };
          return [200, JSON.stringify(t.rowUi)];
        }
        const protect = /^api\/data\/types\/([^/]+)\/protection$/.exec(p);
        if (protect) {
          const t = [libros, documentos].find((x) => x.id === protect[1]);
          const want = (body ?? {}) as { level?: string; unlock?: boolean };
          if (!t) return [404, '{"error":"not-found"}'];
          if (t.level === "private" && want.level !== "private" && !want.unlock)
            return [409, '{"error":"locked"}'];
          t.level = String(want.level);
          return [200, JSON.stringify({ id: t.id, level: t.level })];
        }
        if (p === "api/data/types/t_libro/rows" && method === "GET")
          return [
            200,
            JSON.stringify({
              rows,
              titles: {},
              truncated: false,
              ghosts,
              // Each row's system columns (apps/server/src/audit.ts `systemColumns`).
              columns: Object.fromEntries(
                rows.map((r, i) => [
                  r.id,
                  {
                    created: Date.UTC(2026, 9, 1 + i, 9),
                    updated: r.updated > 1000 ? r.updated : Date.UTC(2026, 9, 20, 9),
                    version: 2,
                    createdBy: i === 0 ? "import" : "user:portatil",
                    updatedBy: i === 1 ? "mcp:claude-ejemplo" : "user:portatil",
                    editors: ["user:portatil"],
                    viewers: i === 1 ? ["mcp:claude-ejemplo"] : [],
                    seenAt: i === 1 ? Date.UTC(2026, 9, 24, 10) : null,
                    origin: i === 1 ? "model" : "user",
                    size: 420 + i,
                  },
                ]),
              ),
            }),
          ];
        if (p === "api/data/types/t_libro/rows") {
          const row = { id: `n${++rowSeq}`, values: { ...(b.values ?? {}) }, updated: Date.now() };
          rows = [row, ...rows];
          return [200, JSON.stringify({ row })];
        }
        const m = /^api\/data\/rows\/([^/]+)(\/restore)?$/.exec(p);
        if (!m) return [404, '{"error":"not-found"}'];
        if (m[2]) {
          const back = gone.find((x) => x.id === m[1]);
          if (back) rows = [back, ...rows];
          return [200, "{}"];
        }
        const i = rows.findIndex((x) => x.id === m[1]);
        if (i < 0) return [404, '{"error":"not-found"}'];
        if (method === "GET")
          return [200, JSON.stringify({ row: { body: "", ...rows[i], type: "t_libro" } })];
        if (method === "DELETE") {
          gone.push(rows[i]!);
          rows = rows.filter((x) => x.id !== m[1]);
          return [200, "{}"];
        }
        const values = { ...rows[i]!.values, ...(b.values ?? {}) };
        for (const [k, v] of Object.entries(values)) if (v === null) delete values[k];
        const bb = (body ?? {}) as { body?: string };
        rows[i] = {
          ...rows[i]!,
          values,
          updated: Date.now(),
          ...(bb.body !== undefined ? { body: bb.body } : {}),
        } as (typeof rows)[number];
        return [200, JSON.stringify({ row: rows[i] })];
      };
      const answer = (method: string, path: string, body?: unknown): [number, string] | null => {
        const p = path.split("?")[0]!;
        const audited = p.startsWith("api/data/audit/") || p === "api/data/notes";
        if (p.startsWith("api/data/") && !audited) return dataAnswer(method, p, body);
        if (p === "api/pages-trash")
          return [
            200,
            JSON.stringify({ pages: trash.map((x) => ({ ...x, spec: undefined, deleted: 1 })) }),
          ];
        if (p === "api/pages" || p.startsWith("api/pages/")) return pageAnswer(method, p, body);
        if (p === "api/agent/proposals" && inbox)
          return [200, JSON.stringify({ proposals: inbox })];
        if (p === "api/agent/requests" && asked) return [200, JSON.stringify({ requests: asked })];
        const answered = /^api\/agent\/requests\/([^/]+)\//.exec(p);
        if (answered && asked) asked = asked.filter((x) => x.id !== answered[1]);
        const decided = /^api\/agent\/proposals\/([^/]+)\//.exec(p);
        if (decided && inbox) inbox = inbox.filter((x) => x.id !== decided[1]);
        if (decided) ghosts = ghosts.filter((g) => g.proposal !== decided[1]);
        if (
          audited ||
          p.startsWith("api/agent/") ||
          p === "api/mail" ||
          p.startsWith("api/mail/")
        ) {
          const key = `${method} ${p
            .replace(/\/proposals\/[^/]+\//, "/proposals/:id/")
            .replace(/\/requests\/[^/]+\//, "/requests/:id/")
            .replace(/\/runs\/[^/]+\//, "/runs/:id/")
            .replace(/\/runs\/[^/]+$/, "/runs/:id")
            .replace(/\/visibility\/[^/]+$/, "/visibility/:type")
            .replace(/\/extensions\/[^/]+$/, "/extensions/:id")
            .replace(/\/models\/roles\/[^/]+$/, "/models/roles/:role")
            .replace(/\/audit\/actions\/[^/]+$/, "/audit/actions/:seq")
            .replace(/\/audit\/rows\/[^/]+$/, "/audit/rows/:id")
            .replace(/\/models\/keys\/[^/]+$/, "/models/keys/:connection")}`;
          const list = opts.agent?.[key];
          if (!list?.length) return [503, '{"error":"agent-off"}'];
          const n = agentCalls[key] ?? 0;
          agentCalls[key] = n + 1;
          // An answer with `__status` is an error the server would send (`{ __status: 400, error: "auth" }`).
          const item = list[Math.min(n, list.length - 1)] as Record<string, unknown> | undefined;
          if (item && typeof item === "object" && typeof item.__status === "number") {
            const { __status, ...rest } = item;
            return [__status as number, JSON.stringify(rest)];
          }
          return [200, JSON.stringify(item)];
        }
        const ok = (name: string): [number, string] => [200, examples[name]!];
        if (method === "DELETE") return [204, ""];
        if (p.endsWith("/home")) return ok("home.json");
        if (p.endsWith("/screens/capture-expense")) return ok("screen-capture-expense.json");
        if (p.includes("/options/")) return ok("options-people.json");
        if (p.endsWith("/charts/catalog")) return ok("chart-catalog.json");
        if (p.endsWith("/charts/preview")) return ok("chart-preview-split.json");
        if (p.endsWith("/charts") && method === "GET") return ok("charts.json");
        if (p.endsWith("/charts/order")) return ok("charts.json");
        if (p.includes("/data")) {
          if (p.includes("spending-by-category")) {
            return ok(
              path.includes("drill=")
                ? "chart-spending-by-category-drill.json"
                : "chart-spending-by-category.json",
            );
          }
          if (p.includes("monthly-spending")) return ok("chart-monthly-spending.json");
          return ok("chart-eating-out.json");
        }
        if (p.endsWith("/shortcuts") && method === "GET") return ok("shortcuts.json");
        if (p.endsWith("/shortcuts/order")) return ok("shortcuts.json");
        // a saved shortcut comes back as it was sent (a new one gets an id)
        if (p.includes("/shortcuts") && body !== undefined)
          return [
            200,
            JSON.stringify({ ...(body as object), id: (body as { id?: string }).id || "nuevo" }),
          ];
        if (p.endsWith("/widgets") && method === "GET") return ok("widgets.json");
        if (p.includes("/widgets"))
          return [200, '{"id":"w-new","chart_id":"eating-out","size":"medium"}'];
        if (p.endsWith("/actions")) {
          if (opts.action === "offline") return null;
          return ok(
            opts.action === "invalid" ? "action-result-invalid.json" : "action-result-ok.json",
          );
        }
        // a saved chart comes back as it was sent (a new one gets an id)
        if (p.includes("/charts") && body !== undefined)
          return [
            200,
            JSON.stringify({ ...(body as object), id: (body as { id?: string }).id || "nueva" }),
          ];
        return [404, examples["error.json"]!];
      };
      w.boniDesktop = {
        async request(method: string, path: string, body?: unknown) {
          record(
            "__requests",
            `${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`,
          );
          if (!settings.serverUrl || !settings.hasToken)
            return { ok: false, offline: false, notConfigured: true };
          const a = opts.offline ? null : answer(method, path, body);
          await new Promise((r) =>
            setTimeout(
              r,
              opts.acceptMs && /^api\/agent\/proposals\/[^/]+\/accept/.test(path)
                ? opts.acceptMs
                : 20,
            ),
          );
          if (!a) return { ok: false, offline: true, message: "refused" };
          return { ok: true, status: a[0], body: a[1] };
        },
        storeRead: async (name: string) => files.get(name) ?? null,
        storeWrite: async (name: string, text: string) => void files.set(name, text),
        storeRemove: async (name: string) => void files.delete(name),
        getSettings: async () => settings,
        async setSettings(patch: Record<string, unknown>) {
          const {
            resetWidgets: _r,
            widgetHidden,
            ...rest
          } = patch as {
            resetWidgets?: boolean;
            widgetHidden?: { id: string; hidden: boolean };
          };
          record("__calls", `setSettings ${JSON.stringify(patch)}`);
          let hidden = settings.hiddenWidgets.filter((id) => id !== widgetHidden?.id);
          if (widgetHidden?.hidden) hidden = [...hidden, widgetHidden.id];
          settings = { ...settings, ...rest, hiddenWidgets: hidden };
          for (const l of listeners) l({ type: "settings", settings });
          return settings;
        },
        async login(form: { serverUrl: string; user: string; password: string; device: string }) {
          record("__calls", `login ${form.serverUrl} ${form.user} ${form.device}`);
          await new Promise((r) => setTimeout(r, 50));
          if (form.password !== "una-contrasena-larga") return { ok: false, code: "bad-login" };
          settings = {
            ...settings,
            serverUrl: form.serverUrl,
            hasToken: true,
            user: form.user,
            device: form.device,
            legacyToken: false,
            sessionEnded: false,
          };
          for (const l of listeners) l({ type: "settings", settings });
          return { ok: true, settings };
        },
        async logout() {
          record("__calls", "logout");
          settings = { ...settings, hasToken: false, user: "" };
          return settings;
        },
        suggestedDevice: async () => "portatil",
        onEvent(cb: (e: unknown) => void) {
          listeners.add(cb);
          (w as Record<string, unknown>).__emit = (e: unknown) => {
            for (const l of listeners) l(e);
          };
          // A proposal arrives in the server's inbox (the next look at it finds it).
          (w as Record<string, unknown>).__pushProposal = (p: { id: string }) => {
            inbox = [...(inbox ?? []), p];
          };
          return () => listeners.delete(cb);
        },
        setWidgets: (list: unknown[]) => record("__calls", `setWidgets ${list.length}`),
        broadcastRefresh: () => record("__calls", "broadcastRefresh"),
        openMain: (screen?: string) => record("__calls", `openMain ${screen ?? ""}`.trim()),
        setLabels: () => undefined,
        widgetDragStart: (kind: string) => record("__calls", `dragStart ${kind}`),
        widgetDragMove: () => record("__calls", "dragMove"),
        widgetDragEnd: () => record("__calls", "dragEnd"),
        widgetHide: () => record("__calls", "hide"),
      };
    },
    { examples: EXAMPLES, opts, pages },
  );
  await page.goto(url);
}

export async function recorded(page: Page): Promise<Shell> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, string[] | undefined>;
    return { requests: w.__requests ?? [], calls: w.__calls ?? [] };
  });
}

/** Sends a shell event (tick, refresh, navigate) to the page. */
export async function emit(page: Page, event: unknown) {
  await page.evaluate(
    (e) => (window as unknown as { __emit: (e: unknown) => void }).__emit(e),
    event,
  );
}
