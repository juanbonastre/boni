import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db } from "../db.ts";
import { DEFAULT_CHARTS, normalizeSpec, PALETTE, type V1ChartSpec } from "./contract.ts";
import { slug } from "./note.ts";

/**
 * What the Boni API v1 keeps (the first Boni's store.py): charts and shortcuts shared by every device of
 * an account, widgets and preferences per device, and the captures sent (so a capture resent by an
 * offline queue is never written twice). In system.db next to the accounts, one set per account (the
 * first server had one set for all). Until the Boni apps move to the core's views, then they live in
 * the user's own store.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS v1_charts (account_id INTEGER NOT NULL, id TEXT NOT NULL, spec TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (account_id, id));
CREATE TABLE IF NOT EXISTS v1_widgets (account_id INTEGER NOT NULL, device TEXT NOT NULL, id TEXT NOT NULL, chart_id TEXT NOT NULL, size TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (account_id, device, id));
CREATE TABLE IF NOT EXISTS v1_shortcuts (account_id INTEGER NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (account_id, id));
CREATE TABLE IF NOT EXISTS v1_prefs (account_id INTEGER NOT NULL, device TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (account_id, device, key));
CREATE TABLE IF NOT EXISTS v1_captures (account_id INTEGER NOT NULL, client_id TEXT NOT NULL, device TEXT NOT NULL, action TEXT NOT NULL, request TEXT NOT NULL,
  status TEXT NOT NULL, result TEXT, path TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (account_id, client_id));
CREATE TABLE IF NOT EXISTS v1_seeded (account_id INTEGER PRIMARY KEY);
`;

export interface Shortcut {
  id: string;
  label: string;
  screen: string;
  values: Record<string, unknown>;
  mode: "open" | "save";
  color: string | null;
}
export interface Widget {
  id: string;
  chart_id: string;
  size: "small" | "medium" | "large";
}
export interface Capture {
  client_id: string;
  device: string;
  action: string;
  request: Record<string, unknown>;
  status: string;
  result: Record<string, unknown> | null;
  path: string | null;
  /** When it reached the server (ms). */
  created: number;
}

export class V1Store {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
    db.exec(SCHEMA);
  }

  /** A new account starts with the default charts, once (deleting them all does not bring them back). */
  private seed(a: number): void {
    if (this.db.prepare("SELECT 1 FROM v1_seeded WHERE account_id = ?").get(a)) return;
    this.db.prepare("INSERT INTO v1_seeded (account_id) VALUES (?)").run(a);
    if (this.db.prepare("SELECT 1 FROM v1_charts WHERE account_id = ? LIMIT 1").get(a)) return;
    DEFAULT_CHARTS().forEach((spec, i) => {
      this.db
        .prepare("INSERT INTO v1_charts (account_id, id, spec, position) VALUES (?, ?, ?, ?)")
        .run(a, spec.id, JSON.stringify(spec), i);
    });
  }

  /**
   * Whether the account really used the first Boni: something captured, a shortcut, a widget or a preference
   * of its own (asking for the charts alone makes the default ones, so that does not count).
   */
  used(a: number): boolean {
    return ["v1_captures", "v1_shortcuts", "v1_widgets", "v1_prefs"].some(
      (t) => !!this.db.prepare(`SELECT 1 FROM ${t} WHERE account_id = ? LIMIT 1`).get(a),
    );
  }

  charts(a: number): V1ChartSpec[] {
    this.seed(a);
    return (
      this.db
        .prepare("SELECT spec FROM v1_charts WHERE account_id = ? ORDER BY position")
        .all(a) as { spec: string }[]
    ).map((r) => normalizeSpec(JSON.parse(r.spec)));
  }

  chart(a: number, id: string): V1ChartSpec | null {
    this.seed(a);
    const r = this.db
      .prepare("SELECT spec FROM v1_charts WHERE account_id = ? AND id = ?")
      .get(a, id) as { spec: string } | undefined;
    return r ? normalizeSpec(JSON.parse(r.spec)) : null;
  }

  private freeId(
    table: "v1_charts" | "v1_shortcuts" | "v1_widgets",
    a: number,
    base: string,
    device?: string,
  ): string {
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const taken =
        device === undefined
          ? this.db.prepare(`SELECT 1 FROM ${table} WHERE account_id = ? AND id = ?`).get(a, id)
          : this.db
              .prepare(`SELECT 1 FROM ${table} WHERE account_id = ? AND id = ? AND device = ?`)
              .get(a, id, device);
      if (!taken) return id;
    }
  }

  private nextPosition(table: string, a: number, device?: string): number {
    const row = (
      device === undefined
        ? this.db
            .prepare(
              `SELECT COALESCE(MAX(position) + 1, 0) AS p FROM ${table} WHERE account_id = ?`,
            )
            .get(a)
        : this.db
            .prepare(
              `SELECT COALESCE(MAX(position) + 1, 0) AS p FROM ${table} WHERE account_id = ? AND device = ?`,
            )
            .get(a, device)
    ) as { p: number };
    return row.p;
  }

  createChart(a: number, spec: V1ChartSpec): V1ChartSpec {
    this.seed(a);
    const saved = { ...spec, id: this.freeId("v1_charts", a, slug(spec.title) || "grafica") };
    this.db
      .prepare("INSERT INTO v1_charts (account_id, id, spec, position) VALUES (?, ?, ?, ?)")
      .run(a, saved.id, JSON.stringify(saved), this.nextPosition("v1_charts", a));
    return saved;
  }

  updateChart(a: number, id: string, spec: V1ChartSpec): V1ChartSpec | null {
    const saved = { ...spec, id };
    const r = this.db
      .prepare("UPDATE v1_charts SET spec = ? WHERE account_id = ? AND id = ?")
      .run(JSON.stringify(saved), a, id);
    return r.changes ? saved : null;
  }

  /** Deletes a chart and the widgets showing it (on every device). */
  deleteChart(a: number, id: string): boolean {
    const r = this.db.prepare("DELETE FROM v1_charts WHERE account_id = ? AND id = ?").run(a, id);
    this.db.prepare("DELETE FROM v1_widgets WHERE account_id = ? AND chart_id = ?").run(a, id);
    return r.changes > 0;
  }

  /** The given ones first, in that order; the rest keep their order after them. */
  private reorder(
    table: "v1_charts" | "v1_shortcuts",
    a: number,
    current: string[],
    ids: string[],
  ): void {
    const wanted = [...new Set(ids)].filter((i) => current.includes(i));
    const final = [...wanted, ...current.filter((i) => !wanted.includes(i))];
    final.forEach((id, pos) => {
      this.db
        .prepare(`UPDATE ${table} SET position = ? WHERE account_id = ? AND id = ?`)
        .run(pos, a, id);
    });
  }
  orderCharts(a: number, ids: string[]): void {
    this.reorder(
      "v1_charts",
      a,
      this.charts(a).map((c) => c.id),
      ids,
    );
  }

  widgets(a: number, device: string): Widget[] {
    return (
      this.db
        .prepare(
          "SELECT id, chart_id, size FROM v1_widgets WHERE account_id = ? AND device = ? ORDER BY position",
        )
        .all(a, device) as unknown as Widget[]
    ).map((w) => ({
      id: w.id,
      chart_id: w.chart_id,
      size: w.size,
    }));
  }
  addWidget(a: number, device: string, chartId: string, size: Widget["size"]): Widget {
    const id = this.freeId("v1_widgets", a, `w-${chartId}`, device);
    this.db
      .prepare(
        "INSERT INTO v1_widgets (account_id, device, id, chart_id, size, position) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(a, device, id, chartId, size, this.nextPosition("v1_widgets", a, device));
    return { id, chart_id: chartId, size };
  }
  updateWidget(
    a: number,
    device: string,
    id: string,
    chartId: string,
    size: Widget["size"],
  ): Widget | null {
    const r = this.db
      .prepare(
        "UPDATE v1_widgets SET chart_id = ?, size = ? WHERE account_id = ? AND device = ? AND id = ?",
      )
      .run(chartId, size, a, device, id);
    return r.changes ? { id, chart_id: chartId, size } : null;
  }
  deleteWidget(a: number, device: string, id: string): boolean {
    return (
      this.db
        .prepare("DELETE FROM v1_widgets WHERE account_id = ? AND device = ? AND id = ?")
        .run(a, device, id).changes > 0
    );
  }

  shortcuts(a: number): Shortcut[] {
    return (
      this.db
        .prepare("SELECT data FROM v1_shortcuts WHERE account_id = ? ORDER BY position")
        .all(a) as { data: string }[]
    ).map((r) => JSON.parse(r.data) as Shortcut);
  }
  createShortcut(a: number, sc: Shortcut): Shortcut {
    const saved = { ...sc, id: this.freeId("v1_shortcuts", a, slug(sc.label) || "atajo") };
    this.db
      .prepare("INSERT INTO v1_shortcuts (account_id, id, data, position) VALUES (?, ?, ?, ?)")
      .run(a, saved.id, JSON.stringify(saved), this.nextPosition("v1_shortcuts", a));
    return saved;
  }
  updateShortcut(a: number, id: string, sc: Shortcut): Shortcut | null {
    const saved = { ...sc, id };
    return this.db
      .prepare("UPDATE v1_shortcuts SET data = ? WHERE account_id = ? AND id = ?")
      .run(JSON.stringify(saved), a, id).changes
      ? saved
      : null;
  }
  deleteShortcut(a: number, id: string): boolean {
    return (
      this.db.prepare("DELETE FROM v1_shortcuts WHERE account_id = ? AND id = ?").run(a, id)
        .changes > 0
    );
  }
  orderShortcuts(a: number, ids: string[]): void {
    this.reorder(
      "v1_shortcuts",
      a,
      this.shortcuts(a).map((s) => s.id),
      ids,
    );
  }

  pref(a: number, device: string, key: string): string | null {
    return (
      (
        this.db
          .prepare("SELECT value FROM v1_prefs WHERE account_id = ? AND device = ? AND key = ?")
          .get(a, device, key) as { value: string } | undefined
      )?.value ?? null
    );
  }
  setPref(a: number, device: string, key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO v1_prefs (account_id, device, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, device, key) DO UPDATE SET value = excluded.value",
      )
      .run(a, device, key, value);
  }

  /** false when that capture (client id) was already sent. */
  insertCapture(
    a: number,
    clientId: string,
    device: string,
    action: string,
    request: Record<string, unknown>,
  ): boolean {
    const now = Date.now();
    const r = this.db
      .prepare(
        "INSERT OR IGNORE INTO v1_captures (account_id, client_id, device, action, request, status, created, updated) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
      )
      .run(a, clientId, device, action, JSON.stringify(request), now, now);
    return r.changes > 0;
  }
  capture(a: number, clientId: string): Capture | null {
    const r = this.db
      .prepare("SELECT * FROM v1_captures WHERE account_id = ? AND client_id = ?")
      .get(a, clientId) as
      | {
          client_id: string;
          device: string;
          action: string;
          request: string;
          status: string;
          result: string | null;
          path: string | null;
          created: number;
        }
      | undefined;
    return r
      ? {
          client_id: r.client_id,
          device: r.device,
          action: r.action,
          request: JSON.parse(r.request),
          status: r.status,
          result: r.result ? JSON.parse(r.result) : null,
          path: r.path,
          created: r.created,
        }
      : null;
  }
  finishCapture(
    a: number,
    clientId: string,
    status: string,
    result: Record<string, unknown>,
    path: string | null,
    error: string | null,
  ): void {
    this.db
      .prepare(
        "UPDATE v1_captures SET status = ?, result = ?, path = COALESCE(?, path), error = ?, attempts = attempts + 1, updated = ? WHERE account_id = ? AND client_id = ?",
      )
      .run(status, JSON.stringify(result), path, error, Date.now(), a, clientId);
  }
  /** Captures waiting to be written (they could not be written when sent), oldest first. */
  queuedCaptures(): { account: number; clientId: string }[] {
    return (
      this.db
        .prepare(
          "SELECT account_id, client_id FROM v1_captures WHERE status = 'queued' ORDER BY created",
        )
        .all() as { account_id: number; client_id: string }[]
    ).map((r) => ({ account: r.account_id, clientId: r.client_id }));
  }
  discardCapture(a: number, clientId: string): void {
    this.db
      .prepare("DELETE FROM v1_captures WHERE account_id = ? AND client_id = ?")
      .run(a, clientId);
  }

  /**
   * Moves the first Boni's charts, shortcuts, widgets, preferences and captures (its boni.sqlite3, opened
   * read-only) into this account. Its tables had no account; everything goes to `a`. Charts saved before
   * charts had a colour get one, as that server did. Nothing is moved twice.
   */
  importFrom(
    path: string,
    a: number,
  ): { charts: number; shortcuts: number; widgets: number; prefs: number; captures: number } {
    const old = new DatabaseSync(path, { readOnly: true });
    const count = { charts: 0, shortcuts: 0, widgets: 0, prefs: 0, captures: 0 };
    const put = (sql: string, ...args: SQLInputValue[]) =>
      Number(this.db.prepare(sql).run(...args).changes);
    try {
      const has = (t: string) =>
        !!old.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
      this.db.prepare("INSERT OR IGNORE INTO v1_seeded (account_id) VALUES (?)").run(a);
      const seeds = Object.fromEntries(DEFAULT_CHARTS().map((c) => [c.id, c.color]));
      if (has("charts"))
        (
          old.prepare("SELECT id, spec, position FROM charts ORDER BY position").all() as {
            id: string;
            spec: string;
            position: number;
          }[]
        ).forEach((r, i) => {
          const raw = JSON.parse(r.spec) as Record<string, unknown>;
          if (!("color" in raw)) raw.color = seeds[r.id] ?? PALETTE[i % PALETTE.length];
          count.charts += put(
            "INSERT OR IGNORE INTO v1_charts (account_id, id, spec, position) VALUES (?, ?, ?, ?)",
            a,
            r.id,
            JSON.stringify(raw),
            r.position,
          );
        });
      if (has("shortcuts"))
        for (const r of old.prepare("SELECT id, data, position FROM shortcuts").all() as {
          id: string;
          data: string;
          position: number;
        }[])
          count.shortcuts += put(
            "INSERT OR IGNORE INTO v1_shortcuts (account_id, id, data, position) VALUES (?, ?, ?, ?)",
            a,
            r.id,
            r.data,
            r.position,
          );
      if (has("widgets"))
        for (const r of old
          .prepare("SELECT device, id, chart_id, size, position FROM widgets")
          .all() as {
          device: string;
          id: string;
          chart_id: string;
          size: string;
          position: number;
        }[])
          count.widgets += put(
            "INSERT OR IGNORE INTO v1_widgets (account_id, device, id, chart_id, size, position) VALUES (?, ?, ?, ?, ?, ?)",
            a,
            r.device,
            r.id,
            r.chart_id,
            r.size,
            r.position,
          );
      if (has("prefs"))
        for (const r of old.prepare("SELECT device, key, value FROM prefs").all() as {
          device: string;
          key: string;
          value: string;
        }[])
          count.prefs += put(
            "INSERT OR IGNORE INTO v1_prefs (account_id, device, key, value) VALUES (?, ?, ?, ?)",
            a,
            r.device,
            r.key,
            r.value,
          );
      if (has("captures"))
        for (const r of old
          .prepare(
            "SELECT client_id, device, action, request, status, result, path, error, attempts, created FROM captures",
          )
          .all() as Record<string, string | number | null>[])
          count.captures += put(
            "INSERT OR IGNORE INTO v1_captures (account_id, client_id, device, action, request, status, result, path, error, attempts, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            a,
            r.client_id ?? null,
            r.device ?? null,
            r.action ?? null,
            r.request ?? null,
            r.status ?? null,
            r.result ?? null,
            r.path ?? null,
            r.error ?? null,
            r.attempts ?? 0,
            Date.parse(String(r.created)) || Date.now(),
            Date.now(),
          );
    } finally {
      old.close();
    }
    return count;
  }
}
