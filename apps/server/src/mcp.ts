import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readStore } from "@boni/agent";
import { type FieldDef, label, type TypeDef } from "@boni/entities";
import { BODY, closedToAi, type StoredEntity, type UserStore, type Writes } from "@boni/store";
import { type DatabaseFilter, filterErrors, matchesFilters } from "@boni/views";
import { type MoneyVault, reconcileClose, reconcileImport } from "./money/service.ts";

const require = createRequire(import.meta.url);
const { openVault } = require("../../calendar-desktop/vault-fs.cjs") as {
  openVault: (root: string) => MoneyVault;
};

/**
 * Boni's MCP server (Juan, 2026-10-22: everything done through vault-mcp moves to Boni). The assistants that
 * worked on the vault (Claude Code) work on Boni's collections instead, with the same kinds of tools: a guide,
 * the collections, search, query by properties, read, create, edit the text, append, set properties, the
 * recent changes, trash and undo. It is a Model Context Protocol server over HTTP (JSON-RPC 2.0 answered as
 * JSON, no stream), on the tailnet entry only, for a session of the account (`cli.ts token` makes one).
 *
 * What a model may see is the agent's own view (`readStore`): a restricted or private collection, or a part of
 * one, does not exist here; an opaque one is listed but its values are not given. Writes go only to what is
 * visible, labelled as written by a model (`model`, from this device: never authority for Boni's agent), each
 * call one run that `undo` (or Boni) takes back whole. Notes keep the path they had in the vault, so an
 * assistant finds `proyectos/boni-plan.md` where it always was.
 */

const PATH_FIELD = "f_vault_path";
const HASH_FIELD = "f_vault_hash";
const PROTOCOL = "2025-06-18";
const MAX_TEXT = 200_000;

interface Ctx {
  store: UserStore;
  device: string;
  now: () => number;
  /** The account's vault folder (the bank statements, rules and categories are read there). */
  vault?: string | null;
}
type Args = Record<string, unknown>;
class ToolFail extends Error {}

const str = (v: unknown, name: string, max = 2000): string => {
  if (typeof v !== "string" || !v.trim()) throw new ToolFail(`${name}: expected text`);
  if (v.length > max) throw new ToolFail(`${name}: too long`);
  return v;
};
const optStr = (v: unknown, name: string, max = MAX_TEXT): string | undefined =>
  v === undefined || v === null ? undefined : str(v, name, max);

// ------------------------------------------------------------------ the view a model has

function view(c: Ctx) {
  const ro = readStore(c.store, c.now);
  const types = () =>
    Object.values(ro.schema().types).filter((t) => !t.system && !t.archived) as TypeDef[];
  const level = (t: string) => c.store.aiAccess()[t] ?? "visible";
  const typeNamed = (name: string): TypeDef => {
    const n = name.trim().toLowerCase();
    const t = types().find((x) => x.id === name || x.name.toLowerCase() === n || x.key === n);
    if (!t) throw new ToolFail(`no collection "${name}" (see collections)`);
    return t;
  };
  const fields = (t: TypeDef) =>
    t.fields.filter((f) => !f.hidden && !f.archived && f.id !== PATH_FIELD && f.id !== HASH_FIELD);
  const titleOf = (id: string) => {
    const e = ro.get(id);
    const t = e ? c.store.schema().types[e.entity.type] : undefined;
    return e && t ? String(e.entity.values[t.titleField] ?? "") : "";
  };
  const shown = (f: FieldDef, v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    if (f.type === "select") return f.options?.find((o) => o.id === v)?.name ?? v;
    if (f.type === "multiselect")
      return (Array.isArray(v) ? v : [v]).map((x) => f.options?.find((o) => o.id === x)?.name ?? x);
    if (f.type === "relation") {
      const ids = Array.isArray(v) ? v : [v];
      const t = ids.map((id) => titleOf(String(id)) || `(${id})`);
      return f.relation?.many ? t : (t[0] ?? null);
    }
    if (f.type === "file") return `file:${v}`;
    return v;
  };
  /** An entity as a model gets it (null when it may not see it; values kept when opaque). */
  const asNote = (s: StoredEntity, withBody: boolean) => {
    const t = c.store.schema().types[s.entity.type] as TypeDef;
    const opaque = Object.values(s.labels).some((l) => l.noModel);
    const props: Record<string, unknown> = {};
    if (!opaque)
      for (const f of fields(t)) {
        const v = shown(f, s.entity.values[f.id]);
        if (v !== null && v !== undefined && v !== "") props[f.name] = v;
      }
    const path = s.entity.values[PATH_FIELD];
    return {
      id: s.entity.id,
      collection: t.name,
      title: opaque ? undefined : String(s.entity.values[t.titleField] ?? ""),
      ...(typeof path === "string" ? { path } : {}),
      updated: new Date(s.entity.updated).toISOString(),
      version: s.entity.version,
      ...(opaque ? { opaque: true } : { properties: props }),
      ...(withBody && !opaque && s.entity.body ? { body: s.entity.body } : {}),
    };
  };
  const find = (ref: Args): StoredEntity => {
    const id = optStr(ref.id, "id", 80);
    const path = optStr(ref.path, "path", 500);
    let s: StoredEntity | null = null;
    if (id) s = ro.get(id);
    else if (path) {
      const hit = c.store.findByValue(PATH_FIELD, path)[0];
      s = hit ? ro.get(hit.id) : null;
    } else throw new ToolFail("give id or path");
    if (!s || s.entity.deleted !== undefined) throw new ToolFail("not found (or not for a model)");
    return s;
  };
  return { ro, types, level, typeNamed, fields, asNote, find };
}

// ------------------------------------------------------------------ writing

function writer(c: Ctx) {
  const run = `mcp-${randomUUID()}`;
  const meta = { actor: "agent" as const, run, device: c.device };
  const def = (t: string) => c.store.schema().types[t] as TypeDef;
  const lbl = (t: string, f: FieldDef | null) =>
    label(
      "model",
      f?.sensitivity ?? def(t).sensitivity,
      [{ kind: "model", id: `mcp:${c.device}` }],
      Boolean(def(t).thirdParty),
    );
  const option = (t: string, f: FieldDef, name: string) => {
    const cur = def(t).fields.find((x) => x.id === f.id) as FieldDef;
    const o = cur.options?.find((x) => x.name === name || x.id === name);
    if (o) return o.id;
    const id = `o_${name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 40)}_${Date.now().toString(36)}`;
    c.store.applySchema(
      {
        op: "set_options",
        type: t,
        field: f.id,
        options: [...(cur.options ?? []), { id, name, label: lbl(t, f) }],
      },
      meta,
    );
    return id;
  };
  const byTitle = (target: string, title: string) => {
    const t = def(target);
    const want = title
      .replace(/^\[\[|\]\]$/g, "")
      .trim()
      .toLowerCase();
    return c.store
      .entities(target)
      .find((e) => String(e.values[t.titleField] ?? "").toLowerCase() === want)?.id;
  };
  /** Properties by their names into the type's fields (an unknown name is an error, never a new field). */
  const writes = (t: TypeDef, props: Args): Writes => {
    const out: Writes = {};
    for (const [name, raw] of Object.entries(props)) {
      const f = t.fields.find(
        (x) => !x.archived && !x.hidden && (x.name === name || x.key === name || x.id === name),
      );
      if (!f) throw new ToolFail(`no property "${name}" in ${t.name}`);
      let v: unknown = raw;
      if (raw !== null)
        switch (f.type) {
          case "select":
            v = option(t.id, f, String(raw));
            break;
          case "multiselect":
            v = (Array.isArray(raw) ? raw : [raw]).map((x) => option(t.id, f, String(x)));
            break;
          case "relation": {
            const ids = (Array.isArray(raw) ? raw : [raw]).map((x) => {
              const id = byTitle(f.relation?.target ?? "", String(x));
              if (!id) throw new ToolFail(`${name}: no "${x}" to point to`);
              return id;
            });
            v = f.relation?.many ? ids : ids[0];
            break;
          }
          case "file":
            throw new ToolFail(`${name}: files are not written here`);
        }
      out[f.id] = { value: v, label: lbl(t.id, f) };
    }
    return out;
  };
  return { run, meta, lbl, writes };
}

// ------------------------------------------------------------------ the tools

/** The account's vault, read-only here (statements, rules, categories). */
function moneyVault(c: Ctx): MoneyVault {
  // What Juan keeps from the models: a closed or opaque Movimientos or Deudas is not read here either.
  const levels = c.store.aiAccess();
  for (const t of ["t_movimiento", "t_deuda"])
    if (closedToAi(levels[t]) || levels[t] === "opaque")
      throw new ToolFail("Movimientos or Deudas are kept from the models (Lo que ve la IA)");
  if (!c.vault)
    throw new ToolFail("this account has no vault folder (the bank statements live there)");
  return openVault(c.vault);
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(c: Ctx, a: Args): unknown;
}
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const REF = {
  id: { type: "string", description: "The note's id (from search, query or read)" },
  path: {
    type: "string",
    description: "The path it had in the vault, e.g. proyectos/boni-plan.md",
  },
};

const TOOLS: Tool[] = [
  {
    name: "guide",
    description:
      "Start here: how to work with Juan's Boni (his instructions for assistants, the note AGENTS.md) and what each tool does.",
    inputSchema: obj({}),
    call(c) {
      const v = view(c);
      const hit = c.store.findByValue(PATH_FIELD, "AGENTS.md")[0];
      const agents = hit ? v.ro.get(hit.id) : null;
      return {
        instructions: agents?.entity.body ?? "(no AGENTS.md note in Boni)",
        tools:
          "collections → search / query → read → create, edit, append, set_properties; recent_changes; trash; undo. Notes keep their vault path (proyectos/boni-plan.md). Every write is labelled as a model's and can be undone whole (undo with its run).",
      };
    },
  },
  {
    name: "collections",
    description:
      "Juan's collections a model may see: name, how many notes, its properties and level.",
    inputSchema: obj({}),
    call(c) {
      const v = view(c);
      return v.types().map((t) => ({
        name: t.name,
        notes: c.store.count(t.id),
        level: v.level(t.id),
        properties: v.fields(t).map((f) => ({ name: f.name, type: f.type })),
      }));
    },
  },
  {
    name: "search",
    description:
      "Full-text search over the notes (titles, properties, text); optionally in one collection.",
    inputSchema: obj(
      {
        query: { type: "string" },
        collection: { type: "string" },
        limit: { type: "number", description: "At most 50 (default 20)" },
      },
      ["query"],
    ),
    call(c, a) {
      const v = view(c);
      const type = a.collection ? v.typeNamed(String(a.collection)).id : undefined;
      const limit = Math.min(50, Math.max(1, Number(a.limit) || 20));
      // FTS5 syntax is not for the caller: each word as a phrase.
      const q = str(a.query, "query", 500)
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => `"${w.replace(/"/g, "")}"`)
        .join(" ");
      return v.ro
        .search(q, { ...(type ? { type } : {}), limit })
        .map((id) => v.ro.get(id))
        .filter((s): s is StoredEntity => !!s)
        .map((s) => v.asNote(s, false));
    },
  },
  {
    name: "query",
    description:
      "The notes of a collection that match Notion-style filters on its properties ({property, op, value}; ops: is, is_not, contains, not_contains, empty, not_empty, checked, unchecked, before, after, gt, lt; value 'today' for dates), newest first.",
    inputSchema: obj(
      {
        collection: { type: "string" },
        filter: { type: "array", items: { type: "object" } },
        limit: { type: "number", description: "At most 200 (default 50)" },
      },
      ["collection"],
    ),
    call(c, a) {
      const v = view(c);
      const t = v.typeNamed(String(a.collection));
      const raw = Array.isArray(a.filter) ? (a.filter as Args[]) : [];
      const rules: DatabaseFilter[] = raw.map((r) => {
        const f = v.fields(t).find((x) => x.name === r.property || x.key === r.property);
        if (!f) throw new ToolFail(`no property "${String(r.property)}" in ${t.name}`);
        return {
          field: f.id,
          op: r.op as DatabaseFilter["op"],
          ...(r.value !== undefined ? { value: r.value as string } : {}),
        };
      });
      if (filterErrors(rules).length) throw new ToolFail("bad filter");
      const typeOf = (id: string) => t.fields.find((f) => f.id === id)?.type;
      const today = new Date(c.now()).toISOString().slice(0, 10);
      return v.ro
        .list(t.id)
        .filter((s) => matchesFilters(s.entity.values, typeOf, rules, today))
        .sort((x, y) => y.entity.updated - x.entity.updated)
        .slice(0, Math.min(200, Math.max(1, Number(a.limit) || 50)))
        .map((s) => v.asNote(s, false));
    },
  },
  {
    name: "read",
    description: "One note with its properties and text, by id or by its vault path.",
    inputSchema: obj(REF),
    call(c, a) {
      const v = view(c);
      return v.asNote(v.find(a), true);
    },
  },
  {
    name: "create",
    description:
      "A new note in a collection: its title, properties by name, its text; optionally the vault path it is written at.",
    inputSchema: obj(
      {
        collection: { type: "string" },
        title: { type: "string" },
        properties: { type: "object" },
        body: { type: "string" },
        path: { type: "string" },
      },
      ["collection", "title"],
    ),
    call(c, a) {
      const v = view(c);
      const t = v.typeNamed(String(a.collection));
      if (v.level(t.id) !== "visible") throw new ToolFail(`${t.name} is not writable for a model`);
      const w = writer(c);
      const writes = w.writes(t, (a.properties as Args) ?? {});
      writes[t.titleField] = { value: str(a.title, "title", 300), label: w.lbl(t.id, null) };
      const body = optStr(a.body, "body");
      if (body) writes[BODY] = { value: body, label: w.lbl(t.id, null) };
      const path = optStr(a.path, "path", 500);
      if (path) {
        if (!t.fields.some((f) => f.id === PATH_FIELD))
          throw new ToolFail(`${t.name} keeps no paths`);
        if (!/^[^/.][^\\]*\.md$/.test(path) || path.split("/").includes(".."))
          throw new ToolFail("path: a vault-relative .md path");
        if (c.store.findByValue(PATH_FIELD, path).length) throw new ToolFail("path: taken");
        writes[PATH_FIELD] = { value: path, label: w.lbl(t.id, null) };
      }
      const made = c.store.create(t.id, writes, w.meta);
      return { id: made.entity.id, run: w.run };
    },
  },
  {
    name: "edit",
    description:
      "Changes a note's text: replaces old_text (it must appear exactly once) with new_text; or the whole text with `body` and the `version` read last.",
    inputSchema: obj({
      ...REF,
      old_text: { type: "string" },
      new_text: { type: "string" },
      body: { type: "string" },
      version: { type: "number" },
    }),
    call(c, a) {
      const v = view(c);
      const s = v.find(a);
      const t = c.store.schema().types[s.entity.type] as TypeDef;
      if (v.level(t.id) !== "visible" || Object.values(s.labels).some((l) => l.noModel))
        throw new ToolFail("not writable for a model");
      const now = s.entity.body ?? "";
      let next: string;
      if (a.body !== undefined) {
        if (a.version !== s.entity.version)
          throw new ToolFail("changed since you read it: read again");
        next = optStr(a.body, "body") ?? "";
      } else {
        const old = str(a.old_text, "old_text", MAX_TEXT);
        const n = now.split(old).length - 1;
        if (n !== 1) throw new ToolFail(n ? `old_text appears ${n} times` : "old_text not found");
        next = now.replace(old, String(a.new_text ?? ""));
      }
      const w = writer(c);
      c.store.update(
        s.entity.id,
        { [BODY]: { value: next || null, label: w.lbl(t.id, null) } },
        w.meta,
      );
      return { id: s.entity.id, run: w.run };
    },
  },
  {
    name: "append",
    description: "Adds text at the end of a note (a log entry, a capture).",
    inputSchema: obj({ ...REF, text: { type: "string" } }, ["text"]),
    call(c, a) {
      const v = view(c);
      const s = v.find(a);
      const t = c.store.schema().types[s.entity.type] as TypeDef;
      if (v.level(t.id) !== "visible" || Object.values(s.labels).some((l) => l.noModel))
        throw new ToolFail("not writable for a model");
      const now = s.entity.body ?? "";
      const text = str(a.text, "text", MAX_TEXT);
      const next = now && !now.endsWith("\n") ? `${now}\n${text}` : `${now}${text}`;
      const w = writer(c);
      c.store.update(s.entity.id, { [BODY]: { value: next, label: w.lbl(t.id, null) } }, w.meta);
      return { id: s.entity.id, run: w.run };
    },
  },
  {
    name: "set_properties",
    description: "Sets properties of a note by their names (null clears one).",
    inputSchema: obj({ ...REF, properties: { type: "object" } }, ["properties"]),
    call(c, a) {
      const v = view(c);
      const s = v.find(a);
      const t = c.store.schema().types[s.entity.type] as TypeDef;
      if (v.level(t.id) !== "visible" || Object.values(s.labels).some((l) => l.noModel))
        throw new ToolFail("not writable for a model");
      const w = writer(c);
      c.store.update(s.entity.id, w.writes(t, (a.properties as Args) ?? {}), w.meta);
      return { id: s.entity.id, run: w.run };
    },
  },
  {
    name: "recent_changes",
    description: "The latest changes in Juan's Boni (what, when, by whom), newest first.",
    inputSchema: obj({ limit: { type: "number", description: "At most 100 (default 30)" } }),
    call(c, a) {
      const v = view(c);
      const n = Math.min(100, Math.max(1, Number(a.limit) || 30));
      return c.store
        .log()
        .slice(-n * 4)
        .reverse()
        .flatMap((r) => {
          if (r.kind === "schema") return [];
          const s = v.ro.get(r.target);
          if (!s) return [];
          const note = v.asNote(s, false);
          return [
            {
              at: new Date(r.at).toISOString(),
              kind: r.kind,
              by: r.device ?? r.actor,
              run: r.run,
              note: {
                id: note.id,
                collection: note.collection,
                title: note.title,
                path: note.path,
              },
            },
          ];
        })
        .slice(0, n);
    },
  },
  {
    name: "trash",
    description: "Sends a note to Boni's trash (it can be restored). Ask Juan first.",
    inputSchema: obj(REF),
    call(c, a) {
      const v = view(c);
      const s = v.find(a);
      if (v.level(s.entity.type) !== "visible") throw new ToolFail("not writable for a model");
      const w = writer(c);
      c.store.remove(s.entity.id, w.meta);
      return { id: s.entity.id, run: w.run };
    },
  },
  {
    name: "finanzas_import",
    description:
      "Monthly reconciliation, step 2 (procedure: the note registros/finanzas/procedimiento-conciliacion.md): reads the bank statements in registros/finanzas/extractos/ (Revolut, ING), joins each new line with the movement Juan noted in the app or creates a pending movement, and applies reglas.csv. Dry run unless dry_run is false; `output` is the report for Juan. Unclear lines are listed, never imported.",
    inputSchema: obj({ dry_run: { type: "boolean", default: true }, reason: { type: "string" } }),
    call(c, a) {
      const apply = a.dry_run === false;
      const run = apply ? `mcp-${randomUUID()}` : undefined;
      const r = reconcileImport(c.store, moneyVault(c), {
        apply,
        today: new Date(c.now()).toISOString().slice(0, 10),
        ...(run ? { run } : {}),
      });
      return {
        output: r.report.join("\n"),
        created: r.created.length,
        joined: r.joined.length,
        unclear: r.unclear,
        ...(run ? { run } : {}),
      };
    },
  },
  {
    name: "finanzas_close",
    description:
      "Monthly reconciliation, step 5: checks a month's pending movements (category, bank line, shared expenses and their debts, refunds), marks the complete ones conciliado and says what each of the rest needs, which bank texts have no rule and who owes what. Dry run unless dry_run is false.",
    inputSchema: obj(
      {
        month: { type: "string", description: "YYYY-MM" },
        dry_run: { type: "boolean", default: true },
        reason: { type: "string" },
      },
      ["month"],
    ),
    call(c, a) {
      const month = str(a.month, "month", 7);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new ToolFail("month: YYYY-MM");
      const apply = a.dry_run === false;
      const run = apply ? `mcp-${randomUUID()}` : undefined;
      const r = reconcileClose(c.store, moneyVault(c), { month, apply, ...(run ? { run } : {}) });
      return {
        output: r.report.join("\n"),
        ready: r.ready.length,
        blocked: r.blocked.length,
        ...(run ? { run } : {}),
      };
    },
  },
  {
    name: "undo",
    description: "Takes back a whole write of this server (its run, as each write returned it).",
    inputSchema: obj({ run: { type: "string" } }, ["run"]),
    call(c, a) {
      const run = str(a.run, "run", 80);
      if (!run.startsWith("mcp-")) throw new ToolFail("only this server's runs");
      return { undone: c.store.undoRun(run, { actor: "agent", device: c.device }).length };
    },
  },
];

// ------------------------------------------------------------------ JSON-RPC

interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Args;
}

function answer(c: Ctx, m: Rpc): unknown | null {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: m.id ?? null,
    error: { code, message },
  });
  if (m.id === undefined) return null; // a notification: nothing to answer
  switch (m.method) {
    case "initialize":
      return reply({
        protocolVersion:
          typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "boni", version: "1.0.0" },
        instructions:
          "Juan's Boni: his notes, projects, agenda and records as collections. Call `guide` first: it has his instructions for assistants.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return fail(-32602, `unknown tool ${String(m.params?.name)}`);
      try {
        const out = tool.call(c, (m.params?.arguments as Args) ?? {});
        return reply({
          content: [{ type: "text", text: JSON.stringify(out, null, 1) }],
          isError: false,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply({ content: [{ type: "text", text: msg }], isError: true });
      }
    }
    default:
      return fail(-32601, `no method ${String(m.method)}`);
  }
}

/** One HTTP request's JSON-RPC message (or batch): the answer to send, or null (202, nothing to say). */
export function mcpAnswer(
  store: UserStore,
  device: string,
  body: unknown,
  now: () => number = Date.now,
  vault: string | null = null,
): unknown | null {
  const c: Ctx = { store, device, now, vault };
  if (Array.isArray(body)) {
    const out = body.map((m) => answer(c, m as Rpc)).filter((x) => x !== null);
    return out.length ? out : null;
  }
  if (!body || typeof body !== "object")
    return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
  return answer(c, body as Rpc);
}
