import { randomUUID } from "node:crypto";
import { readStore } from "@boni/agent";
import {
  type FieldDef,
  type FieldType,
  label,
  MAX_DESCRIPTION,
  type SelectOption,
  type TypeDef,
} from "@boni/entities";
import {
  BODY,
  closedToAi,
  MAX_FILE_BYTES,
  type Seen,
  type StoredEntity,
  type UserStore,
  type Writes,
} from "@boni/store";
import { type DatabaseFilter, filterErrors, matchesFilters } from "@boni/views";
import { type MoneyFiles, reconcileClose, reconcileImport } from "./money/service.ts";
import { storeFiles } from "./money/storeFiles.ts";
import { FILE_FIELD, FOLDER_FIELD, mimeOf } from "./paths.ts";

/**
 * Boni's MCP server (Juan, 2026-10-22: everything done through vault-mcp moves to Boni). The assistants that
 * worked on the vault (Claude Code) work on Boni's collections instead, with the same kinds of tools: a guide,
 * the collections, search, query by properties, read, create, edit the text, append, set properties, the
 * recent changes, trash and undo. It is a Model Context Protocol server over HTTP (JSON-RPC 2.0 answered as
 * JSON, no stream), on the tailnet entry only, for a session of the account (`cli.ts token` makes one).
 *
 * What it says about itself and about the data is computed when it is asked, never written by hand (Juan,
 * 2026-10-27; docs/contexto.md): `guide` gives the user's instructions for assistants, every collection with what
 * goes in it (its description) and the tools, from this code. A collection's description replaces a folder's README.
 *
 * What a model may see is the agent's own view (`readStore`): a restricted or private collection, or a part of
 * one, does not exist here; an opaque one is listed but its values are not given. Writes go only to what is
 * visible, labelled as written by a model (`model`, from this device: never authority for Boni's agent), each
 * call one run that `undo` (or Boni) takes back whole. A note is found by its id, or by its collection and title
 * (D-17: records are known by their id, never by a path).
 */

const PROTOCOL = "2025-06-18";
/** The record whose text is the user's instructions for assistants (a setting: its id). */
const INSTRUCTIONS = "mcp/instructions";
/** Several notes trashed in one call (one run, undone together). */
const MAX_BATCH = 500;
const MAX_TEXT = 200_000;

interface Ctx {
  store: UserStore;
  device: string;
  now: () => number;
  /** This call's run: its writes are undone together, and its audit action names it. */
  run: string;
  /** What of Juan's entities this call sends back to the model (the audit). */
  seen: Seen[];
}
/** Arguments as the audit keeps them: no long texts (what a call writes is in the operation log anyway). */
const auditArgs = (a: Args): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(a)
      .filter(([k]) => !["body", "new_text", "old_text", "text", "content", "data"].includes(k))
      .map(([k, v]) => [
        k,
        typeof v === "string" ? v.slice(0, 300) : JSON.stringify(v ?? null).slice(0, 300),
      ]),
  );
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
  const fields = (t: TypeDef) => t.fields.filter((f) => !f.hidden && !f.archived);
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
    // The audit: the fields it got (a relation's entries by their titles), its text or not.
    const sent: Seen = {
      entity: s.entity.id,
      type: t.id,
      version: s.entity.version,
      fields: opaque
        ? []
        : [
            ...new Set([
              t.titleField,
              ...fields(t)
                .filter((f) => props[f.name] !== undefined)
                .map((f) => f.id),
            ]),
          ],
      shapes: [],
      body: withBody && !opaque && s.entity.body ? "text" : null,
      files: [],
    };
    c.seen.push(sent);
    if (!opaque)
      for (const f of fields(t))
        if (f.type === "relation" && props[f.name] !== undefined)
          for (const id of [s.entity.values[f.id]].flat()) {
            const r = ro.get(String(id));
            const rt = r ? c.store.schema().types[r.entity.type] : undefined;
            if (r && rt)
              c.seen.push({
                entity: r.entity.id,
                type: rt.id,
                version: r.entity.version,
                fields: [rt.titleField],
                shapes: [],
                body: null,
                files: [],
              });
          }
    return {
      id: s.entity.id,
      collection: t.name,
      title: opaque ? undefined : String(s.entity.values[t.titleField] ?? ""),
      updated: new Date(s.entity.updated).toISOString(),
      version: s.entity.version,
      ...(opaque ? { opaque: true } : { properties: props }),
      ...(withBody && !opaque && s.entity.body ? { body: s.entity.body } : {}),
    };
  };
  const find = (ref: Args): StoredEntity => {
    const id = optStr(ref.id, "id", 80);
    const title = optStr(ref.title, "title", 300);
    let s: StoredEntity | null = null;
    if (id) s = ro.get(id);
    else if (title && ref.collection) {
      const t = typeNamed(String(ref.collection));
      const want = title.trim().toLowerCase();
      const hits = ro.list(t.id, { deep: true }).filter(
        (x) =>
          String(x.entity.values[t.titleField] ?? "")
            .trim()
            .toLowerCase() === want,
      );
      if (hits.length > 1)
        throw new ToolFail(`${hits.length} notes of ${t.name} have that title: use the id`);
      s = hits[0] ?? null;
    } else throw new ToolFail("give the id, or the collection and the title");
    if (!s || s.entity.deleted !== undefined) throw new ToolFail("not found (or not for a model)");
    return s;
  };
  /** What goes in a collection, as its description says (none yet: undefined). */
  const description = (t: TypeDef) => t.description?.text;
  /** The name of the collection a collection is inside (its mother), when the model may see her. */
  const mother = (t: TypeDef) =>
    t.parent ? types().find((m) => m.id === t.parent)?.name : undefined;
  return { ro, types, level, typeNamed, fields, shown, asNote, find, description, mother };
}

// ------------------------------------------------------------------ writing

function writer(c: Ctx) {
  const run = c.run;
  const meta = { actor: "agent" as const, run, device: c.device, by: `mcp:${c.device}` };
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

/** What Juan keeps from the models: a closed or opaque Movimientos or Deudas is not reconciled here either. */
function moneyOpen(c: Ctx): void {
  const levels = c.store.aiAccess();
  for (const t of ["t_movimiento", "t_deuda"])
    if (closedToAi(levels[t]) || levels[t] === "opaque")
      throw new ToolFail("Movimientos or Deudas are kept from the models (Lo que ve la IA)");
}

/** The reconciliation's statements, read-only here. */
function moneyFiles(c: Ctx): MoneyFiles {
  moneyOpen(c);
  return storeFiles(c.store);
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
  collection: { type: "string", description: "With `title`: the collection the note is in" },
  title: { type: "string", description: "With `collection`: the note's exact title" },
};

/** The record the user keeps as instructions for assistants: the one the setting names. */
function instructionsOf(c: Ctx, v: ReturnType<typeof view>): StoredEntity | null {
  const id = c.store.setting(INSTRUCTIONS);
  const named = id ? v.ro.get(id) : null;
  return named && named.entity.deleted === undefined ? named : null;
}

/** The first sentence of a tool's description: enough to choose it (its whole text comes with tools/list). */
const firstSentence = (text: string) => /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;

/** A name as ASCII words for ids and keys ("Cola de Boni" → "cola_de_boni"). */
const slug = (name: string, max = 36) => {
  const s = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
  return /^[a-z]/.test(s) ? s : `c_${s}`.slice(0, max);
};

/** Property types a model may give a new collection (relations and files are made in Boni itself). */
const NEW_FIELD_TYPES: readonly FieldType[] = [
  "text",
  "longtext",
  "number",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "datetime",
  "time",
  "url",
  "email",
  "phone",
];

const TOOLS: Tool[] = [
  {
    name: "guide",
    description:
      "Start here: Juan's instructions for assistants, his collections with what goes in each and how many notes they have (computed now), and what each tool does.",
    inputSchema: obj({}),
    call(c) {
      const v = view(c);
      const own = instructionsOf(c, v);
      if (own?.entity.body)
        c.seen.push({
          entity: own.entity.id,
          type: own.entity.type,
          version: own.entity.version,
          fields: [],
          shapes: [],
          body: "text",
          files: [],
        });
      return {
        instructions: own?.entity.body ?? "(Juan has no instructions for assistants in Boni yet)",
        collections: v.types().map((t) => {
          const about = v.description(t);
          return {
            name: t.name,
            ...(v.mother(t) ? { inside: v.mother(t) } : {}),
            ...(about ? { description: about } : {}),
            notes: c.store.count(t.id),
            level: v.level(t.id),
          };
        }),
        tools: TOOLS.map((t) => ({ name: t.name, does: firstSentence(t.description) })),
        writes:
          "Every write is labelled as a model's and is one run that `undo` takes back whole. Read a note before changing it.",
      };
    },
  },
  {
    name: "collections",
    description:
      "Juan's collections a model may see: name, the collection it is inside (its mother: a mother's queries include it), what goes in it, how many notes, its properties and level.",
    inputSchema: obj({}),
    call(c) {
      const v = view(c);
      return v.types().map((t) => ({
        name: t.name,
        ...(v.mother(t) ? { inside: v.mother(t) } : {}),
        ...(v.description(t) ? { description: v.description(t) } : {}),
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
      "The notes of a collection, the collections inside it included (each note says its own), that match Notion-style filters on its properties as notes show them: options and related notes by their names ({property, op, value}; ops: is, is_not, contains, not_contains, empty, not_empty, checked, unchecked, before, after, gt, lt; value 'today' for dates), newest first.",
    inputSchema: obj(
      {
        collection: { type: "string" },
        filter: { type: "array", items: { type: "object" } },
        limit: { type: "number", description: "At most 200 (default 50)" },
        offset: { type: "number", description: "Skip this many first (to read on, page by page)" },
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
      // A model names options and related notes as notes show them (never by id): compare what it sees, in any case.
      const named = new Map(
        v
          .fields(t)
          .filter((f) => ["select", "multiselect", "relation"].includes(f.type))
          .filter((f) => rules.some((r) => r.field === f.id))
          .map((f) => [f.id, f]),
      );
      const fold = (x: unknown) =>
        String(x ?? "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
      const seen = (values: Record<string, unknown>) => {
        const out = { ...values };
        for (const [id, f] of named) {
          const x = v.shown(f, values[id]);
          out[id] = Array.isArray(x) ? x.map(fold) : x;
        }
        return out;
      };
      const asSeen = rules.map((r) =>
        named.has(r.field) && typeof r.value === "string" ? { ...r, value: fold(r.value) } : r,
      );
      return v.ro
        .list(t.id, { deep: true })
        .filter((s) => matchesFilters(seen(s.entity.values), typeOf, asSeen, today))
        .sort((x, y) => y.entity.updated - x.entity.updated || (x.entity.id < y.entity.id ? -1 : 1))
        .slice(Math.max(0, Math.floor(Number(a.offset) || 0)))
        .slice(0, Math.min(200, Math.max(1, Number(a.limit) || 50)))
        .map((s) => v.asNote(s, false));
    },
  },
  {
    name: "read",
    description: "One note with its properties and text: by id, or by collection and exact title.",
    inputSchema: obj(REF),
    call(c, a) {
      const v = view(c);
      return v.asNote(v.find(a), true);
    },
  },
  {
    name: "create",
    description:
      "A new note in a collection: its title, properties by name, its text. It is known by its id (notes have no paths).",
    inputSchema: obj(
      {
        collection: { type: "string" },
        title: { type: "string" },
        properties: { type: "object" },
        body: { type: "string" },
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
      const made = c.store.create(t.id, writes, w.meta);
      return { id: made.entity.id, run: w.run };
    },
  },
  {
    name: "upload_file",
    description:
      "Adds a file to Boni (collection Archivos): `path` is its folder and name, a bank statement registros/finanzas/extractos/<name>.csv, where finanzas_import reads it. content_base64: the file's bytes (at most ~6 MB). Never over another file of that folder and name.",
    inputSchema: obj({ path: { type: "string" }, content_base64: { type: "string" } }, [
      "path",
      "content_base64",
    ]),
    call(c, a) {
      const v = view(c);
      const t = v.typeNamed("Archivos");
      if (v.level(t.id) !== "visible") throw new ToolFail(`${t.name} is not writable for a model`);
      const path = str(a.path, "path", 500);
      const name = path.split("/").pop() ?? "";
      if (
        !/^[^/.][^\\]*$/.test(path) ||
        path.split("/").some((p) => p === "" || p === "." || p === "..") ||
        path.toLowerCase().endsWith(".md") ||
        /^(private|restricted)\//.test(path) ||
        !name.includes(".")
      )
        throw new ToolFail("path: a folder and a file name (not a note)");
      const folder = path.slice(0, path.lastIndexOf("/"));
      const taken = c.store
        .entities(t.id)
        .some((e) => e.values[FOLDER_FIELD] === folder && e.values[t.titleField] === name);
      if (taken) throw new ToolFail("path: taken");
      const raw = str(a.content_base64, "content_base64", Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4);
      const bytes = Buffer.from(raw, "base64");
      if (!bytes.length) throw new ToolFail("content_base64: empty");
      const w = writer(c);
      const sha = c.store.putFile(bytes, mimeOf(name));
      const made = c.store.create(
        t.id,
        {
          [t.titleField]: { value: name, label: w.lbl(t.id, null) },
          [FILE_FIELD]: { value: sha, label: w.lbl(t.id, null) },
          [FOLDER_FIELD]: { value: folder, label: w.lbl(t.id, null) },
        },
        w.meta,
      );
      return { id: made.entity.id, run: w.run, bytes: bytes.length };
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
      // Only the latest operations, without what each changed: the whole log of a big store is more than the
      // server's memory (2026-10-28: reading it to keep the last ones stopped the server).
      return c.store
        .recentOps(n * 4)
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
              },
            },
          ];
        })
        .slice(0, n);
    },
  },
  {
    name: "trash",
    description:
      "Sends notes to Boni's trash (they can be restored): one by its reference, or several by `ids`, all in one run that `undo` takes back together. Ask Juan first, saying exactly what goes.",
    inputSchema: obj({
      ...REF,
      ids: {
        type: "array",
        items: { type: "string" },
        description: `Several notes at once (at most ${MAX_BATCH})`,
      },
    }),
    call(c, a) {
      const v = view(c);
      let targets: StoredEntity[];
      if (Array.isArray(a.ids)) {
        const ids = [...new Set(a.ids.map((x) => str(x, "ids", 80)))];
        if (!ids.length || ids.length > MAX_BATCH) throw new ToolFail(`ids: 1 to ${MAX_BATCH}`);
        targets = ids.map((id) => v.find({ id }));
      } else targets = [v.find(a)];
      // All checked before any goes: a call trashes everything it names or nothing.
      for (const s of targets)
        if (v.level(s.entity.type) !== "visible" || Object.values(s.labels).some((l) => l.noModel))
          throw new ToolFail(`${s.entity.id}: not writable for a model`);
      const w = writer(c);
      for (const s of targets) c.store.remove(s.entity.id, w.meta);
      return targets.length === 1
        ? { id: targets[0]?.entity.id, run: w.run }
        : { trashed: targets.length, run: w.run };
    },
  },
  {
    name: "set_description",
    description:
      "Says in a few words what goes in a collection (it replaces a folder's README: Juan reads it on the collection's page and `guide` gives it to every assistant). Empty text takes it away. When Juan asks, or when he agrees to your wording.",
    inputSchema: obj({ collection: { type: "string" }, description: { type: "string" } }, [
      "collection",
      "description",
    ]),
    call(c, a) {
      const v = view(c);
      const t = v.typeNamed(String(a.collection));
      if (v.level(t.id) !== "visible") throw new ToolFail(`${t.name} is not writable for a model`);
      const text = typeof a.description === "string" ? a.description.trim() : "";
      if (text.length > MAX_DESCRIPTION)
        throw new ToolFail(`description: at most ${MAX_DESCRIPTION} characters`);
      const w = writer(c);
      c.store.applySchema(
        {
          op: "describe_type",
          type: t.id,
          description: text ? { text, label: w.lbl(t.id, null) } : null,
        },
        w.meta,
      );
      return { collection: t.name, run: w.run };
    },
  },
  {
    name: "create_collection",
    description: `A new collection, only when Juan asks for one: its name, what goes in it (description) and its properties ({name, type, options}; types: ${NEW_FIELD_TYPES.join(", ")}). Every note of it also has a title (title_property, «Título» unless said) and a text of its own. Inside another collection (inside): it has that one's properties too, and that one's queries include it. One run: \`undo\` takes it back while it is empty.`,
    inputSchema: obj(
      {
        name: { type: "string" },
        description: { type: "string" },
        inside: { type: "string", description: "The collection it goes inside (its mother)" },
        title_property: { type: "string" },
        properties: { type: "array", items: { type: "object" } },
      },
      ["name", "description"],
    ),
    call(c, a) {
      const v = view(c);
      const name = str(a.name, "name", 80).trim();
      if (v.types().some((t) => t.name.toLowerCase() === name.toLowerCase()))
        throw new ToolFail(`there is a collection "${name}" already`);
      const about = str(a.description, "description", MAX_DESCRIPTION).trim();
      const mother = a.inside === undefined ? null : v.typeNamed(str(a.inside, "inside", 80));
      const w = writer(c);
      const lbl = label("model", "personal", [{ kind: "model", id: `mcp:${c.device}` }], false);
      const taken = c.store.schema().types;
      let id = `t_${slug(name)}`;
      for (let n = 2; taken[id]; n++) id = `t_${slug(name, 32)}_${n}`;
      const fields: FieldDef[] = [];
      const field = (fname: string, type: FieldType, options?: SelectOption[]) => {
        let fid = `f_${slug(fname)}`;
        for (let n = 2; fields.some((f) => f.id === fid); n++) fid = `f_${slug(fname, 32)}_${n}`;
        if (fields.some((f) => f.name.toLowerCase() === fname.toLowerCase()))
          throw new ToolFail(`two properties named "${fname}"`);
        fields.push({
          id: fid,
          key: fid.slice(2).replace(/_/g, "-").slice(0, 40),
          name: fname,
          type,
          ...(options ? { options } : {}),
          label: lbl,
        });
      };
      // Inside another, the title is its mother's.
      if (!mother)
        field(optStr(a.title_property, "title_property", 80)?.trim() || "Título", "text");
      const props = Array.isArray(a.properties) ? (a.properties as Args[]) : [];
      if (props.length > 60) throw new ToolFail("properties: at most 60");
      for (const p of props) {
        const pname = str(p.name, "properties.name", 80).trim();
        const type = String(p.type ?? "text") as FieldType;
        if (!NEW_FIELD_TYPES.includes(type))
          throw new ToolFail(`${pname}: type is one of ${NEW_FIELD_TYPES.join(", ")}`);
        let options: SelectOption[] | undefined;
        if (type === "select" || type === "multiselect") {
          const names = Array.isArray(p.options)
            ? p.options.map((o) => str(o, "options", 80).trim())
            : [];
          if (!names.length) throw new ToolFail(`${pname}: a ${type} needs its options`);
          options = [...new Set(names)].map((o, i) => ({
            id: `o_${slug(o, 30)}_${i}`,
            name: o,
            label: lbl,
          }));
        }
        field(pname, type, options);
      }
      const def: TypeDef = {
        id,
        key: id.slice(2).replace(/_/g, "-").slice(0, 40),
        name,
        ...(mother ? { parent: mother.id } : {}),
        fields,
        titleField: mother ? mother.titleField : (fields[0] as FieldDef).id,
        sensitivity: mother ? mother.sensitivity : "personal",
        schemaVersion: 1,
        label: lbl,
        description: { text: about, label: lbl },
      };
      try {
        c.store.applySchema({ op: "create_type", type: def }, w.meta);
      } catch (e) {
        throw new ToolFail(e instanceof Error ? e.message : String(e));
      }
      return { collection: name, properties: fields.map((f) => f.name), run: w.run };
    },
  },
  {
    name: "finanzas_import",
    description:
      "Monthly reconciliation, step 2 (its procedure is a note: search «conciliación»): reads the bank statements (Revolut, ING) kept in Archivos in the folder registros/finanzas/extractos (added with upload_file), joins each new line with the movement Juan noted in the app or creates a pending movement, and applies the collection Reglas. Dry run unless dry_run is false; `output` is the report for Juan. Unclear lines are listed, never imported.",
    inputSchema: obj({ dry_run: { type: "boolean", default: true }, reason: { type: "string" } }),
    call(c, a) {
      const apply = a.dry_run === false;
      const run = apply ? `mcp-${randomUUID()}` : undefined;
      const r = reconcileImport(c.store, moneyFiles(c), {
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
      moneyOpen(c);
      const r = reconcileClose(c.store, { month, apply, ...(run ? { run } : {}) });
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
      return {
        undone: c.store.undoRun(run, { actor: "agent", device: c.device, by: `mcp:${c.device}` })
          .length,
      };
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
          "Juan's Boni: his data as collections of notes. Call `guide` first: his instructions for assistants, every collection with what goes in it, and the tools.",
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
      const args = (m.params?.arguments as Args) ?? {};
      c.run = `mcp-${randomUUID()}`;
      c.seen = [];
      // Every call is in the audit: who (this device's MCP), what with which arguments (no long texts), what
      // of Juan's entities went back to the model, and whether it failed.
      const record = (result: unknown) =>
        c.store.audit.record({
          at: c.now(),
          by: `mcp:${c.device}`,
          run: c.run,
          tool: `mcp.${tool.name}`,
          target: auditArgs(args),
          decision: "allow",
          result,
          seen: c.seen,
        });
      try {
        const out = tool.call(c, args);
        record(null);
        return reply({
          content: [{ type: "text", text: JSON.stringify(out, null, 1) }],
          isError: false,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        record({ error: msg.slice(0, 200) });
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
): unknown | null {
  const c: Ctx = { store, device, now, run: "", seen: [] };
  if (Array.isArray(body)) {
    const out = body.map((m) => answer(c, m as Rpc)).filter((x) => x !== null);
    return out.length ? out : null;
  }
  if (!body || typeof body !== "object")
    return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
  return answer(c, body as Rpc);
}
