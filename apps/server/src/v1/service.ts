import { toLocal } from "@boni/calendar";
import {
  computeChart,
  fold,
  isSpending,
  moneyProfile,
  moneyRecords,
  monthsWithData,
  SpecError,
  shiftMonths,
  validate,
} from "@boni/views";
import {
  ACCOUNTS,
  ACTION,
  CAPTURE_FIELDS,
  captureScreen,
  SCREEN_ID,
  validateCapture,
} from "./capture.ts";
import { CATALOG, Invalid, PALETTE, type V1ChartSpec } from "./contract.ts";
import { Finanzas } from "./finanzas.ts";
import { asciiText, baseName, render } from "./note.ts";
import type { Shortcut, V1Store, Widget } from "./store.ts";

/**
 * The Boni API v1's logic between HTTP and the vault, ported from the first Boni's service.py: screens,
 * options, charts, widgets, shortcuts and captures (each sent once, by its client id). Per account:
 * its charts and shortcuts, its devices' widgets and preferences, its vault's money notes.
 */
export class NotFound extends Error {}
export class Unavailable extends Error {}
export { Invalid };

export const QUEUED_MESSAGE = "Guardado en Boni: se escribira en cuanto vuelva la conexion";
const VALUES_MONTHS = 24; // option lists made from movements look at the last 24 months
const STATUSES: Record<string, string> = { pendiente: "Pendiente", conciliado: "Conciliado" };
const SOURCES: Record<string, string> = { manual: "Manual", banco: "Banco", boni: "Boni" };

export type Change = "charts" | "widgets" | "data" | "shortcuts";
export interface Option {
  value: string;
  label: string;
  hint: string | null;
}
export interface ActionResult {
  status: "ok" | "queued" | "invalid" | "error";
  message: string | null;
  field_errors: Record<string, string>;
  navigate: string | null;
}
const result = (
  status: ActionResult["status"],
  message: string | null,
  extra: Partial<ActionResult> = {},
): ActionResult => ({
  status,
  message,
  field_errors: {},
  navigate: null,
  ...extra,
});

/** Who asks: the account and the device (widgets and preferences are per device). */
export interface Caller {
  account: number;
  device: string;
  /** The account's vault on this server; "" when it has none. */
  vault: string;
}

const nice = (s: string) => {
  const t = s.replaceAll("-", " ").trim();
  return (t[0]?.toUpperCase() ?? "") + t.slice(1);
};
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function civil(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export interface V1Options {
  store: V1Store;
  /** The server's time zone (BONI_TZ): "today" and the time a capture was saved. */
  tz: string;
  /** Whether the server may write notes (BONI_WRITE). */
  writable: boolean;
  now?: () => number;
}

export class V1Service {
  readonly store: V1Store;
  private tz: string;
  private writable: boolean;
  private nowMs: () => number;
  private fins = new Map<string, Finanzas>();
  private listeners = new Map<number, Set<(what: Change) => void>>();
  private prints = new Map<number, string>();

  constructor(o: V1Options) {
    this.store = o.store;
    this.tz = o.tz;
    this.writable = o.writable;
    this.nowMs = o.now ?? Date.now;
  }

  today(): string {
    return civil(toLocal(this.nowMs(), this.tz).day);
  }
  /** Now in the server's zone as Python's isoformat() with an offset ("2026-10-19T12:00:00.000+02:00"). */
  nowIso(): string {
    const ms = this.nowMs();
    const local = toLocal(ms, this.tz);
    const off = Math.round(local.day * 1440 + local.minute - ms / 60_000);
    const sign = off < 0 ? "-" : "+";
    const wall = new Date(ms + off * 60_000).toISOString().slice(0, 23);
    return `${wall}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  }

  private fin(c: Caller): Finanzas {
    if (!c.vault) throw new Unavailable("this account has no vault on this server");
    let f = this.fins.get(c.vault);
    if (!f) {
      f = new Finanzas(c.vault);
      this.fins.set(c.vault, f);
    }
    return f;
  }
  /** The vault's lists, or Unavailable when it cannot be read. */
  private read<T>(c: Caller, f: (fin: Finanzas) => T): T {
    if (!c.vault) throw new Unavailable("this account has no vault on this server");
    try {
      return f(this.fin(c));
    } catch (e) {
      throw new Unavailable(e instanceof Error ? e.message : String(e));
    }
  }

  // ----- live changes -----
  subscribe(account: number, l: (what: Change) => void): () => void {
    const set = this.listeners.get(account) ?? new Set();
    this.listeners.set(account, set);
    set.add(l);
    return () => set.delete(l);
  }
  publish(account: number, what: Change): void {
    for (const l of this.listeners.get(account) ?? []) l(what);
  }
  /** Tells the listening accounts when their money notes changed (another device, the reconciliation). */
  checkData(vaultOf: (account: number) => string): void {
    for (const [account, set] of this.listeners) {
      if (!set.size) continue;
      const vault = vaultOf(account);
      if (!vault) continue;
      let print: string;
      try {
        print = this.fin({ account, device: "", vault }).fingerprint();
      } catch {
        continue;
      }
      const before = this.prints.get(account);
      this.prints.set(account, print);
      if (before !== undefined && before !== print) this.publish(account, "data");
    }
  }

  // ----- screens -----
  home(c: Caller) {
    const comps: unknown[] = [
      { type: "button", label: "Apuntar gasto", screen: SCREEN_ID, icon: "add", style: "primary" },
    ];
    for (const ch of this.store.charts(c.account))
      if (ch.home)
        comps.push({
          type: "chart_card",
          chart_id: ch.id,
          title: ch.title,
          size:
            ch.kind === "hbar" || ch.kind === "table"
              ? "wide"
              : ch.kind === "number"
                ? "small"
                : "medium",
        });
    return { api_version: "1", id: "home", title: "Boni", components: comps };
  }

  screen(c: Caller, id: string) {
    if (id === "home") return this.home(c);
    if (id === SCREEN_ID)
      return captureScreen(this.store.pref(c.account, c.device, "last_account"));
    throw new NotFound(id);
  }

  // ----- options -----
  options(c: Caller, source: string, q = "", limit = 50): Option[] {
    const key = asciiText(q).toLowerCase().trim();
    const opt = (value: string, label: string, hint: string | null = null): Option => ({
      value,
      label,
      hint,
    });
    let opts: Option[];
    if (source === "categories") {
      const cats = this.read(c, (f) => f.categories());
      // Spending categories first: the form is mostly used for expenses.
      const order = cats.map((cat, i) => ({ cat, i, later: !isSpending(cat) }));
      order.sort((a, b) => Number(a.later) - Number(b.later) || a.i - b.i);
      opts = order.map((o) => opt(o.cat, o.cat));
    } else if (source === "people")
      opts = this.read(c, (f) => f.people()).map((p) => opt(p.slug, p.label, p.hint));
    else if (source === "groups")
      opts = [
        ...new Set(this.read(c, (f) => f.categories()).map((cat) => cat.split("/", 1)[0] ?? "")),
      ].map((g) => opt(g, nice(g)));
    else if (source === "accounts") opts = ACCOUNTS.map((a) => opt(a.value, a.label));
    else if (
      source === "merchants" ||
      source === "related" ||
      source === "statuses" ||
      source === "sources"
    )
      opts = this.valuesFromMovements(c, source);
    else throw new NotFound(source);
    if (key) {
      const words = key.split(/\s+/);
      opts = opts.filter((o) =>
        words.every((w) => asciiText(`${o.label} ${o.value}`).toLowerCase().includes(w)),
      );
    }
    return opts.slice(0, limit);
  }

  /** Distinct values seen in recent movements, most used first. */
  private valuesFromMovements(
    c: Caller,
    source: "merchants" | "related" | "statuses" | "sources",
  ): Option[] {
    const field = (
      { merchants: "merchant", related: "related", statuses: "status", sources: "source" } as const
    )[source];
    const today = this.today();
    const from = shiftMonths(`${today.slice(0, 7)}-01`, -(VALUES_MONTHS - 1)).slice(0, 7);
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const m of this.read(c, (f) => f.movements())) {
      const ym = m.date.slice(0, 7);
      if (ym < from || ym > today.slice(0, 7)) continue;
      const vals: string[] = field === "related" ? (m.related ?? []) : [m[field] ?? ""];
      for (const v of vals) {
        if (!v) continue;
        const k = field === "related" ? v : fold(v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        if (!labels.has(k)) labels.set(k, v);
      }
    }
    const known = source === "statuses" ? STATUSES : source === "sources" ? SOURCES : {};
    for (const k of Object.keys(known)) if (!counts.has(k)) counts.set(k, 0);
    const keys = [...counts.keys()].sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || byCodePoint(a, b),
    );
    return keys.map((k) => ({
      value: labels.get(k) ?? k,
      label: known[k] || nice(labels.get(k) ?? k),
      hint: null,
    }));
  }

  // ----- charts -----
  compute(c: Caller, spec: V1ChartSpec, drill: string | null = null) {
    try {
      validate(moneyProfile, spec);
    } catch (e) {
      if (e instanceof SpecError) throw new Invalid(e.message);
      throw e;
    }
    const [movements, debts] = this.read(c, (f) => [f.movements(), f.debts()] as const);
    try {
      const data = computeChart(moneyProfile, spec, moneyRecords(movements, debts), {
        today: this.today(),
        monthsWithData: monthsWithData(movements),
        drill,
        stale: false,
      });
      const { stale, ...rest } = data;
      return { ...rest, computed_at: this.nowIso(), stale };
    } catch (e) {
      if (e instanceof SpecError) throw new Invalid(e.message);
      throw e;
    }
  }

  chartData(c: Caller, id: string, drill: string | null) {
    const spec = this.store.chart(c.account, id);
    if (!spec) throw new NotFound(id);
    return this.compute(c, spec, drill);
  }

  private checked(spec: V1ChartSpec): V1ChartSpec {
    try {
      validate(moneyProfile, spec);
    } catch (e) {
      if (e instanceof SpecError) throw new Invalid(e.message);
      throw e;
    }
    return { ...spec, title: spec.title.trim() };
  }
  createChart(c: Caller, spec: V1ChartSpec): V1ChartSpec {
    const saved = this.store.createChart(c.account, this.checked(spec));
    this.publish(c.account, "charts");
    return saved;
  }
  updateChart(c: Caller, id: string, spec: V1ChartSpec): V1ChartSpec {
    const saved = this.store.updateChart(c.account, id, this.checked(spec));
    if (!saved) throw new NotFound(id);
    this.publish(c.account, "charts");
    return saved;
  }
  deleteChart(c: Caller, id: string): void {
    if (!this.store.deleteChart(c.account, id)) throw new NotFound(id);
    this.publish(c.account, "charts");
    this.publish(c.account, "widgets");
  }
  orderCharts(c: Caller, ids: string[]): void {
    this.store.orderCharts(c.account, ids);
    this.publish(c.account, "charts");
  }
  catalog() {
    return CATALOG;
  }

  // ----- widgets -----
  private knownChart(c: Caller, id: string): void {
    if (!this.store.chart(c.account, id)) throw new Invalid(`No existe la grafica ${id}`);
  }
  addWidget(c: Caller, chartId: string, size: Widget["size"]): Widget {
    this.knownChart(c, chartId);
    const w = this.store.addWidget(c.account, c.device, chartId, size);
    this.publish(c.account, "widgets");
    return w;
  }
  updateWidget(c: Caller, id: string, chartId: string, size: Widget["size"]): Widget {
    this.knownChart(c, chartId);
    const w = this.store.updateWidget(c.account, c.device, id, chartId, size);
    if (!w) throw new NotFound(id);
    this.publish(c.account, "widgets");
    return w;
  }
  deleteWidget(c: Caller, id: string): void {
    if (!this.store.deleteWidget(c.account, c.device, id)) throw new NotFound(id);
    this.publish(c.account, "widgets");
  }

  // ----- shortcuts -----
  /** A shortcut fills the form of a screen this server has: its values must be fields of that form. */
  private checkedShortcut(c: Caller, sc: Shortcut): Shortcut {
    const label = sc.label.trim();
    if (!label) throw new Invalid("El atajo necesita un nombre");
    let screen: { components: unknown[] };
    try {
      screen = this.screen(c, sc.screen);
    } catch (e) {
      if (e instanceof NotFound) throw new Invalid(`No existe la pantalla ${sc.screen}`);
      throw e;
    }
    const form = screen.components.find((x) => (x as { type: string }).type === "form");
    if (!form) throw new Invalid(`La pantalla ${sc.screen} no tiene formulario`);
    const unknown = Object.keys(sc.values)
      .filter((k) => !CAPTURE_FIELDS.has(k))
      .sort(byCodePoint);
    if (unknown.length)
      throw new Invalid(`Campos que el formulario no tiene: ${unknown.join(", ")}`);
    if (sc.color !== null && !PALETTE.includes(sc.color))
      throw new Invalid(`Color desconocido: ${sc.color}`);
    return { ...sc, label };
  }
  createShortcut(c: Caller, sc: Shortcut): Shortcut {
    const saved = this.store.createShortcut(c.account, this.checkedShortcut(c, sc));
    this.publish(c.account, "shortcuts");
    return saved;
  }
  updateShortcut(c: Caller, id: string, sc: Shortcut): Shortcut {
    const saved = this.store.updateShortcut(c.account, id, this.checkedShortcut(c, sc));
    if (!saved) throw new NotFound(id);
    this.publish(c.account, "shortcuts");
    return saved;
  }
  deleteShortcut(c: Caller, id: string): void {
    if (!this.store.deleteShortcut(c.account, id)) throw new NotFound(id);
    this.publish(c.account, "shortcuts");
  }
  orderShortcuts(c: Caller, ids: string[]): void {
    this.store.orderShortcuts(c.account, ids);
    this.publish(c.account, "shortcuts");
  }

  // ----- actions -----
  /** `req` is already checked (http.ts): action, client_id (canonical), values, created_at (ms or null). */
  action(
    c: Caller,
    req: {
      action: string;
      client_id: string;
      values: Record<string, unknown>;
      created_at: string | null;
    },
  ): ActionResult {
    if (req.action !== ACTION) return result("error", `Accion desconocida: ${req.action}`);
    if (!this.store.insertCapture(c.account, req.client_id, c.device, req.action, req)) {
      const prev = this.store.capture(c.account, req.client_id);
      if (prev?.result) return prev.result as unknown as ActionResult;
      return result("queued", QUEUED_MESSAGE);
    }
    return this.process(c, req.client_id, true);
  }

  /** Writes the queued captures again (the vault was unreachable). Returns how many were written. */
  flushOutbox(vaultOf: (account: number) => string | null): number {
    let written = 0;
    for (const q of this.store.queuedCaptures()) {
      const vault = vaultOf(q.account);
      const cap = this.store.capture(q.account, q.clientId);
      if (vault === null || !cap) continue;
      const r = this.process({ account: q.account, device: cap.device, vault }, q.clientId, false);
      if (r.status === "ok") written++;
    }
    return written;
  }

  private process(c: Caller, clientId: string, first: boolean): ActionResult {
    const cap = this.store.capture(c.account, clientId);
    if (cap?.status !== "queued")
      return (cap?.result as unknown as ActionResult) ?? result("error", "Captura no encontrada");
    const req = cap.request as { values: Record<string, unknown>; created_at: string | null };
    const createdMs = req.created_at ? Date.parse(req.created_at) : null;
    const created = createdMs === null ? null : toLocal(createdMs, this.tz);
    const createdAt = created
      ? {
          date: civil(created.day),
          time: `${pad(Math.floor(created.minute / 60))}:${pad(Math.floor(created.minute % 60))}`,
        }
      : null;
    // The day the user saved it, not the day the queue was written.
    const today = createdAt ? createdAt.date : this.today();
    let cats: string[] | null = null;
    let people: Set<string> | null = null;
    try {
      const fin = this.fin(c);
      cats = fin.categories();
      people = new Set(fin.people().map((p) => p.slug));
    } catch {
      cats = people = null;
    }
    const { draft, errors } = validateCapture(req.values, {
      categories: cats,
      people,
      createdAt,
      today,
    });
    if (!draft) {
      const res = result("invalid", "Revisa los campos marcados", { field_errors: errors });
      // Nothing was saved: the app fixes the form and may send it again with the same client id.
      if (first) this.store.discardCapture(c.account, clientId);
      else {
        const why = Object.entries(errors)
          .map(([k, v]) => `${k}: ${v}`)
          .join("; ");
        this.store.finishCapture(
          c.account,
          clientId,
          "invalid",
          res as unknown as Record<string, unknown>,
          null,
          why,
        );
        console.warn(`v1: queued capture ${clientId} became invalid: ${why}`);
      }
      return res;
    }
    if (!this.writable) {
      this.store.discardCapture(c.account, clientId);
      return result("error", "Este servidor no escribe notas (BONI_WRITE)");
    }
    const queued = result("queued", QUEUED_MESSAGE, { navigate: "home" });
    if (cats === null) {
      this.store.finishCapture(
        c.account,
        clientId,
        "queued",
        queued as unknown as Record<string, unknown>,
        null,
        "vault unavailable",
      );
      return queued;
    }
    let path: string;
    try {
      path = this.fin(c).createMovement(draft.date, baseName(draft), render(draft, today));
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const code = (e as { code?: string }).code;
      if (code === "bad-path" || code === "denied") {
        const res = result("error", `No se pudo escribir: ${msg}`);
        this.store.finishCapture(
          c.account,
          clientId,
          "failed",
          res as unknown as Record<string, unknown>,
          null,
          msg,
        );
        console.error(`v1: capture ${clientId} failed: ${msg}`);
        return res;
      }
      // The vault could not be reached (a volume not mounted...): written later by the outbox.
      this.store.finishCapture(
        c.account,
        clientId,
        "queued",
        queued as unknown as Record<string, unknown>,
        null,
        msg,
      );
      return queued;
    }
    const res = result("ok", `Guardado: ${(path.split("/").pop() ?? "").replace(/\.md$/, "")}`, {
      navigate: "home",
    });
    this.store.finishCapture(
      c.account,
      clientId,
      "written",
      res as unknown as Record<string, unknown>,
      path,
      null,
    );
    this.store.setPref(c.account, cap.device, "last_account", draft.account);
    console.log(`v1: capture ${clientId} written`);
    this.publish(c.account, "data");
    return res;
  }
}
