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
  /** Answers of the agent's API, in order, by "METHOD path" ("POST api/agent/turn"); the last one repeats. */
  agent?: Record<string, unknown[]>;
}

/**
 * Opens the page with a stand-in for the desktop shell (`window.boniDesktop`, as preload.cjs gives it): its
 * requests are answered from api/examples, its files live in memory, and what the page asks is recorded.
 */
export async function openApp(page: Page, url = "/", opts: Options = {}): Promise<void> {
  await page.addInitScript(
    ({ examples, opts }) => {
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
      // The inbox as the server keeps it: accepting or rejecting a proposal takes it out.
      let inbox = (
        opts.agent?.["GET api/agent/proposals"]?.[0] as { proposals: { id: string }[] } | undefined
      )?.proposals;
      const answer = (method: string, path: string, body?: unknown): [number, string] | null => {
        const p = path.split("?")[0]!;
        if (p === "api/agent/proposals" && inbox)
          return [200, JSON.stringify({ proposals: inbox })];
        const decided = /^api\/agent\/proposals\/([^/]+)\//.exec(p);
        if (decided && inbox) inbox = inbox.filter((x) => x.id !== decided[1]);
        if (p.startsWith("api/agent/")) {
          const key = `${method} ${p.replace(/\/proposals\/[^/]+\//, "/proposals/:id/").replace(/\/runs\/[^/]+\//, "/runs/:id/")}`;
          const list = opts.agent?.[key];
          if (!list?.length) return [503, '{"error":"agent-off"}'];
          const n = agentCalls[key] ?? 0;
          agentCalls[key] = n + 1;
          return [200, JSON.stringify(list[Math.min(n, list.length - 1)])];
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
          await new Promise((r) => setTimeout(r, 20));
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
    { examples: EXAMPLES, opts },
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
