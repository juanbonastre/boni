import { createHash } from "node:crypto";
import { type Json, leaf, rec, typeName, type Val } from "@boni/agent";
import { formatNote, NoteError, parseNote, patchNote } from "@boni/calendar";
import { label, type TypeDef } from "@boni/entities";
import type { StoredEntity, UserStore } from "@boni/store";
import {
  CORE_MARK,
  FOLDER_FIELD,
  importable,
  PATH_FIELD,
  propertyFields,
} from "@boni/vault-import";
import {
  changesFor,
  ID_KEY,
  INTEGRITY_KEY,
  type Links,
  OMITTED_KEY,
  parseEdit,
  type Rendered,
  render,
} from "./render.ts";
import type { MirroredType, MirrorState, Profile } from "./state.ts";

/**
 * The Markdown mirror (docs/nucleo.md 9.2, 9.4): for each type in `core` mode the core writes one note
 * per entity into the vault, in a profile's format (`generic`: a folder of its own, a property per field
 * by its name; `vault`: the notes stay where the import found them, under the properties they had).
 * Only the lines that change are written (`patchNote`). A note whose sha256 is not the one the mirror
 * last wrote is never overwritten: a hand edit (Obsidian, Syncthing, another agent) becomes a proposal in
 * the inbox, labelled `imported` with the note as its source; a new note in the folder proposes a new
 * entity, a removed one proposes removing it. Rejecting puts the core's version back.
 *
 * Types not listed in the state are in `vault` mode (the vault is the truth, the import keeps the core in
 * step) or not mirrored at all. `switchToCore` reports first (dry run by default); Juan runs it.
 */
export interface MirrorFs {
  scan(dir: string): { path: string; mtimeMs: number; size: number }[];
  read(path: string): { text: string; mtimeMs: number };
  write(path: string, text: string, expectedMtimeMs: number | null): { conflict: boolean };
  create(path: string, text: string): { exists: boolean };
  trash(path: string): Promise<void>;
}

export interface Proposal {
  tool: "entities.update" | "entities.create" | "entities.delete";
  args: Record<string, Val>;
  origin: string;
  title: string;
  rows: {
    arg: string;
    role: string;
    value: string;
    integrity: string;
    sources: string[];
    marks: string[];
  }[];
}

export interface MirrorOptions {
  store: UserStore;
  state: MirrorState;
  fs: MirrorFs;
  /** Puts a proposal in the inbox (the server passes `Agent.propose`); returns its id. */
  propose: (p: Proposal) => string;
}

export interface SwitchReport {
  type: string;
  name: string;
  profile: Profile;
  folder: string;
  applied: boolean;
  entities: number;
  /** Notes that already say what the core says (they only gain the `boni_*` lines). */
  unchanged: number;
  /** Notes the switch would rewrite, with the properties that differ. */
  changed: { path: string; props: string[]; body: boolean }[];
  /** Entities without a note yet (one is created). */
  created: string[];
  /** Notes in the folder the core does not have (after the switch they become proposals). */
  unknown: string[];
  /** Notes that cannot be read (their properties do not parse): left as they are. */
  unreadable: string[];
}

export interface SyncReport {
  written: number;
  created: number;
  trashed: number;
  /** Hand edits waiting in the inbox: those notes were not overwritten. */
  held: string[];
}

export interface ScanReport {
  proposed: number;
  adopted: number;
  restored: number;
  unreadable: string[];
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const GONE = "gone";
const baseName = (path: string) => (path.split("/").pop() ?? "").replace(/\.md$/i, "");
const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
/** A file name from a title: no characters Obsidian or the file systems refuse. */
export const safeName = (title: string) =>
  title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "Sin título";

export class Mirror {
  private o: MirrorOptions;
  /** Size and time of the notes last found to be the mirror's own: those are not read again. */
  private stamps = new Map<string, string>();
  constructor(o: MirrorOptions) {
    this.o = o;
  }

  private get store() {
    return this.o.store;
  }
  private get state() {
    return this.o.state;
  }

  /** The mode of each of Boni's own types that can be mirrored. */
  modes(): { type: string; name: string; mode: "core" | "vault" | "none"; profile?: Profile }[] {
    const zones = this.store.zones();
    return Object.values(this.store.schema().types)
      .filter((t) => !t.system && !t.archived)
      .map((t) => {
        // A vault zone never goes back to the vault; the vault's files are not notes to mirror.
        if (zones[t.id] || t.fields.some((f) => f.id === FOLDER_FIELD))
          return { type: t.id, name: t.name, mode: "none" as const };
        const m = this.state.type(t.id);
        if (m) return { type: t.id, name: t.name, mode: "core" as const, profile: m.profile };
        const imported = t.fields.some((f) => f.id === PATH_FIELD);
        return {
          type: t.id,
          name: t.name,
          mode: imported ? ("vault" as const) : ("none" as const),
        };
      });
  }

  // ------------------------------------------------------------------ links between notes

  private links(): Links {
    const names = new Map<string, string>(); // entity -> note name
    const byName = new Map<string, Map<string, string>>(); // type -> lower name -> entity
    // One query for the mirrored notes and one per type for its values (no labels): this runs every round.
    const mirrored = new Map(this.state.refs().map((r) => [r.entity, r.path]));
    for (const t of Object.values(this.store.schema().types)) {
      if (t.system) continue;
      const m = new Map<string, string>();
      for (const e of this.store.entities(t.id)) {
        const s = { entity: e };
        const row = mirrored.has(e.id) ? { path: mirrored.get(e.id) as string } : null;
        const p = s.entity.values[PATH_FIELD];
        const title = s.entity.values[t.titleField];
        const name = row
          ? baseName(row.path)
          : typeof p === "string"
            ? baseName(p)
            : typeof title === "string" && title
              ? title
              : null;
        if (!name) continue;
        names.set(s.entity.id, name);
        m.set(name.toLowerCase(), s.entity.id);
      }
      byName.set(t.id, m);
    }
    return {
      nameOf: (id) => names.get(id) ?? null,
      resolve: (name, target) =>
        byName.get(target)?.get(name.split("/").pop()?.toLowerCase() ?? "") ?? null,
    };
  }

  // ------------------------------------------------------------------ switching a type to `core`

  private defaults(t: TypeDef, profile?: Profile, folder?: string) {
    const entities = this.store.list(t.id);
    const paths = entities
      .map((s) => s.entity.values[PATH_FIELD])
      .filter((p): p is string => typeof p === "string");
    const p: Profile = profile ?? (paths.length ? "vault" : "generic");
    let f = folder;
    if (f === undefined && p === "vault" && paths.length) {
      // The folder all its notes are under ("" when they are spread over the vault).
      let common = dirOf(paths[0] as string).split("/");
      for (const x of paths) {
        const d = dirOf(x).split("/");
        let i = 0;
        while (i < common.length && common[i] === d[i]) i++;
        common = common.slice(0, i);
      }
      f = common.join("/");
    }
    return { profile: p, folder: (f ?? `Boni/${safeName(t.name)}`).replace(/^\/+|\/+$/g, "") };
  }

  /** The properties each field had in the type's notes, as the import named them. */
  private propsFromNotes(t: TypeDef, notes: Map<string, string>): Record<string, string> {
    const seen = new Set<string>();
    for (const text of notes.values()) {
      const p = parseNote(text);
      if (!p.error) for (const k of Object.keys(p.values)) seen.add(k);
    }
    const props: Record<string, string> = {};
    for (const [prop, field] of propertyFields([...seen])) props[field] = prop;
    // A title the notes never had came from the file name.
    if (!seen.has("title") && t.fields.some((f) => f.id === t.titleField && f.id === "f_title"))
      props[t.titleField] = "";
    return props;
  }

  private readMaybe(path: string): { text: string; mtimeMs: number } | null {
    try {
      return this.o.fs.read(path);
    } catch {
      return null;
    }
  }

  /**
   * The notes under a type's folder the import would read (never `private/`, `restricted/`, `_system/`,
   * dot folders or folder indexes), with a stamp of their size and time. Not for the vault's root: a type
   * spread over the whole vault gets no "new note" proposals.
   */
  private notesUnder(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!dir) return out;
    try {
      for (const f of this.o.fs.scan(dir))
        if (importable(f.path)) out.set(f.path, `${f.mtimeMs}:${f.size}`);
    } catch {
      // A folder that is not there yet has no notes.
    }
    return out;
  }

  /** Every note path an entity of any type came from or is mirrored to. */
  private knownPaths(): Set<string> {
    const known = new Set(this.state.refs().map((n) => n.path));
    for (const t of Object.values(this.store.schema().types))
      if (!t.system)
        for (const s of this.store.list(t.id, { includeDeleted: true })) {
          const p = s.entity.values[PATH_FIELD];
          if (typeof p === "string") known.add(p);
        }
    return known;
  }

  /**
   * What switching `type` to `core` would do, and with `apply` doing it: from then on the core is the truth
   * and its notes are the mirror. Nothing is written without `apply`.
   */
  switchToCore(
    typeId: string,
    opts: { profile?: Profile; folder?: string; apply?: boolean } = {},
  ): SwitchReport {
    const t = this.store.schema().types[typeId];
    if (!t || t.system || t.archived) throw new Error(`No such type: ${typeId}`);
    if (this.state.type(typeId)) throw new Error(`Already in core mode: ${t.name}`);
    // A vault zone moved into Boni never goes back to the vault, where other agents read.
    if (this.store.zones()[typeId]) throw new Error(`In a zone, never mirrored: ${t.name}`);
    if (t.fields.some((f) => f.id === FOLDER_FIELD))
      throw new Error(`Files, not notes: never mirrored: ${t.name}`);
    const { profile, folder } = this.defaults(t, opts.profile, opts.folder);
    const entities = this.store.list(typeId);
    // Where each entity's note is (the import's path, for the vault profile).
    const pathOf = new Map<string, string>();
    const existing = new Map<string, string>(); // path -> text
    if (profile === "vault")
      for (const s of entities) {
        const p = s.entity.values[PATH_FIELD];
        if (typeof p !== "string") continue;
        const f = this.readMaybe(p);
        if (f) {
          pathOf.set(s.entity.id, p);
          existing.set(p, f.text);
        }
      }
    const m: MirroredType = {
      type: typeId,
      profile,
      folder,
      props: profile === "vault" ? this.propsFromNotes(t, existing) : {},
      schema: t.schemaVersion,
    };
    const report: SwitchReport = {
      type: typeId,
      name: t.name,
      profile,
      folder,
      applied: !!opts.apply,
      entities: entities.length,
      unchanged: 0,
      changed: [],
      created: [],
      unknown: [],
      unreadable: [],
    };
    const links = this.links();
    const writes: { entity: string; path: string | null; text: string; old: string | null }[] = [];
    for (const s of entities) {
      const r = render(s, t, m, links);
      const path = pathOf.get(s.entity.id) ?? null;
      const old = path ? (existing.get(path) as string) : null;
      if (path && old !== null) {
        const parsed = parseNote(old);
        if (parsed.error) {
          report.unreadable.push(path);
          continue;
        }
        const changes = changesFor(parsed.values, r);
        const props = Object.keys(changes).filter(
          (k) => k !== ID_KEY && k !== INTEGRITY_KEY && k !== OMITTED_KEY,
        );
        const body = parsed.body !== r.body;
        if (props.length || body) report.changed.push({ path, props, body });
        else report.unchanged++;
        writes.push({
          entity: s.entity.id,
          path,
          text: patchNote(old, changes, { body: r.body }),
          old,
        });
      } else {
        report.created.push(r.title || s.entity.id);
        writes.push({
          entity: s.entity.id,
          path: null,
          text: formatNote(r.props, r.body),
          old: null,
        });
      }
    }
    const known = this.knownPaths();
    for (const p of this.notesUnder(folder).keys()) if (!known.has(p)) report.unknown.push(p);
    report.unknown.sort();
    if (!opts.apply) return report;

    this.state.setType(m);
    // The core is its truth from now on: the vault's import leaves it alone (`CORE_MARK`).
    this.store.setSetting(`${CORE_MARK}${typeId}`, profile);
    for (const w of writes) {
      const s = entities.find((x) => x.entity.id === w.entity) as StoredEntity;
      if (w.path && w.old !== null) {
        const f = this.o.fs.read(w.path);
        if (f.text !== w.old) continue; // changed meanwhile: the next scan sees it as a hand edit
        if (w.text !== w.old) this.o.fs.write(w.path, w.text, f.mtimeMs);
        this.state.setNote({
          entity: w.entity,
          type: typeId,
          path: w.path,
          sha: sha(w.text),
          text: w.text,
        });
      } else this.createNote(s, t, m, render(s, t, m, links));
    }
    this.state.setSynced(Math.max(this.state.synced(), this.store.version()));
    return report;
  }

  /** Stops mirroring a type (back to `vault` mode or none): its notes stay as they are. */
  stop(typeId: string): void {
    this.state.dropType(typeId);
    this.store.setSetting(`${CORE_MARK}${typeId}`, null);
  }

  // ------------------------------------------------------------------ core -> notes

  /** A new note: where the import found it when that place is free, else `<folder>/<title>.md`. */
  private createNote(s: StoredEntity, t: TypeDef, m: MirroredType, r: Rendered): string {
    const text = formatNote(r.props, r.body);
    const was = s.entity.values[PATH_FIELD];
    const base = m.folder ? `${m.folder}/${safeName(r.title)}` : safeName(r.title);
    const paths = function* () {
      if (m.profile === "vault" && typeof was === "string") yield was;
      for (let i = 1; ; i++) yield i === 1 ? `${base}.md` : `${base} ${i}.md`;
    };
    for (const path of paths()) {
      const other = this.state.noteAt(path);
      if (other && other.entity !== s.entity.id) continue;
      if (!this.o.fs.create(path, text).exists) {
        this.state.setNote({ entity: s.entity.id, type: t.id, path, sha: sha(text), text });
        return path;
      }
    }
    throw new Error("unreachable");
  }

  /** Whether Juan already decided the hand edit that left `text` there (accepted or rejected). */
  private decided(path: string, text: string): boolean {
    const e = this.state.edit(path, sha(text));
    const status = e ? this.store.journal.proposal(e.proposal)?.status : null;
    return status === "accepted" || status === "rejected";
  }

  /** Writes one entity's note; false when a hand edit is still waiting there. */
  private async writeEntity(
    s: StoredEntity,
    t: TypeDef,
    m: MirroredType,
    links: Links,
    report: SyncReport,
  ): Promise<void> {
    const row = this.state.note(s.entity.id);
    if (s.entity.deleted !== undefined) {
      if (!row || row.sha === GONE) return;
      const f = this.readMaybe(row.path);
      if (f && (sha(f.text) === row.sha || this.decided(row.path, f.text))) {
        await this.o.fs.trash(row.path);
        report.trashed++;
        // The place is kept: Undo brings the note back where it was.
        this.state.setNote({ ...row, sha: GONE, text: "" });
      } else this.state.dropNote(s.entity.id); // edited by hand meanwhile: left as it is
      this.state.dropEdit(row.path, GONE);
      return;
    }
    const r = render(s, t, m, links);
    if (!row) {
      this.createNote(s, t, m, r);
      report.created++;
      return;
    }
    const f = this.readMaybe(row.path);
    if (!f) {
      // Trashed by the mirror (the entity is back), or removed by hand and that proposal rejected.
      const e = this.state.edit(row.path, GONE);
      const status = e ? this.store.journal.proposal(e.proposal)?.status : null;
      if (row.sha !== GONE && status !== "rejected") return void report.held.push(row.path);
      const text = formatNote(r.props, r.body);
      if (this.o.fs.create(row.path, text).exists) return void report.held.push(row.path);
      this.state.setNote({ ...row, sha: sha(text), text });
      if (e) this.state.dropEdit(row.path, GONE);
      report.created++;
      return;
    }
    const fileSha = sha(f.text);
    if (fileSha !== row.sha && !this.decided(row.path, f.text))
      return void report.held.push(row.path);
    const parsed = parseNote(f.text);
    if (parsed.error) return void report.held.push(row.path);
    let text: string;
    try {
      text = patchNote(f.text, changesFor(parsed.values, r), { body: r.body });
    } catch (e) {
      if (e instanceof NoteError) return void report.held.push(row.path);
      throw e;
    }
    if (text !== f.text) {
      if (this.o.fs.write(row.path, text, f.mtimeMs).conflict)
        return void report.held.push(row.path);
      report.written++;
    }
    this.state.setNote({ ...row, sha: sha(text), text });
    if (fileSha !== row.sha) this.state.dropEdit(row.path, fileSha);
  }

  /** Writes what changed in the core since the last sync (and everything of a type whose schema changed). */
  async sync(): Promise<SyncReport> {
    const report: SyncReport = { written: 0, created: 0, trashed: 0, held: [] };
    const mirrored = this.state.types();
    if (!mirrored.length) return report;
    const schema = this.store.schema();
    const ch = this.store.changesSince(this.state.synced());
    // Nothing changed in the core and nothing waits to be linked: a quiet round costs two queries.
    if (
      !ch.entities.length &&
      mirrored.every((m) => schema.types[m.type]?.schemaVersion === m.schema) &&
      !this.state.edits().some((e) => e.kind === "create")
    ) {
      this.state.setSynced(ch.version);
      return report;
    }
    const links = this.links();
    this.linkCreated(links);
    const todo = new Map<string, StoredEntity>();
    for (const m of mirrored) {
      const t = schema.types[m.type];
      if (!t) continue;
      if (t.schemaVersion !== m.schema) {
        for (const s of this.store.list(m.type, { includeDeleted: true })) todo.set(s.entity.id, s);
        this.state.setType({ ...m, schema: t.schemaVersion });
      }
    }
    for (const s of ch.entities) todo.set(s.entity.id, s);
    for (const s of todo.values()) {
      const m = this.state.type(s.entity.type);
      const t = schema.types[s.entity.type];
      if (m && t) await this.writeEntity(s, t, m, links, report);
    }
    this.state.setSynced(ch.version);
    return report;
  }

  /** An accepted "new note" proposal: the entity it made takes that note instead of getting another. */
  private linkCreated(links: Links): void {
    for (const e of this.state.edits()) {
      if (e.kind !== "create" || this.store.journal.proposal(e.proposal)?.status !== "accepted")
        continue;
      const f = this.readMaybe(e.path);
      const typeId = e.entity;
      const m = typeId ? this.state.type(typeId) : null;
      const t = typeId ? this.store.schema().types[typeId] : undefined;
      if (!f || !m || !t || sha(f.text) !== e.sha) {
        this.state.dropEdit(e.path, e.sha);
        continue;
      }
      const parsed = parseNote(f.text);
      const match = this.store
        .list(t.id)
        .find(
          (s) =>
            !this.state.note(s.entity.id) &&
            !Object.keys(
              parseEdit(
                parsed.values,
                parsed.body,
                baseName(e.path),
                t,
                m,
                render(s, t, m, links),
                links,
              ).values,
            ).length,
        );
      if (!match) continue;
      this.state.setNote({
        entity: match.entity.id,
        type: t.id,
        path: e.path,
        sha: sha(f.text),
        text: f.text,
      });
      this.state.dropEdit(e.path, e.sha);
    }
  }

  // ------------------------------------------------------------------ notes -> proposals

  private noteLabel(t: TypeDef, path: string, hash: string) {
    return label(
      "imported",
      t.sensitivity,
      [{ kind: "vault", id: `${path}@${hash.slice(0, 12)}` }],
      !!t.thirdParty,
    );
  }

  private rowsFor(path: string, problems: { prop: string; error: string }[]): Proposal["rows"] {
    const rows: Proposal["rows"] = [
      {
        arg: "note",
        role: "value",
        value: path,
        integrity: "imported",
        sources: ["vault"],
        marks: [],
      },
    ];
    for (const p of problems)
      rows.push({
        arg: "ignored",
        role: "value",
        value: `${p.prop}: ${p.error}`,
        integrity: "imported",
        sources: ["vault"],
        marks: [],
      });
    return rows;
  }

  private valuesVal(
    parsed: { values: Record<string, unknown>; body?: string },
    l: ReturnType<typeof label>,
  ): Val {
    const fields: Record<string, Val> = {};
    for (const [k, v] of Object.entries(parsed.values)) fields[k] = leaf(v as Json, l);
    if (parsed.body !== undefined) fields.body = leaf(parsed.body, l);
    return rec(fields, l);
  }

  /** What the mirror last wrote at a note, as the base a hand edit is compared with (three-way). */
  private base(row: { path: string; text: string }): Rendered {
    const p = parseNote(row.text);
    return { props: p.values, body: p.body, omitted: [], title: baseName(row.path) };
  }

  /** The status of the proposal a hand edit became, or null when there is none (or it went stale). */
  private editStatus(path: string, hash: string): string | null {
    const e = this.state.edit(path, hash);
    if (!e) return null;
    const status = this.store.journal.proposal(e.proposal)?.status ?? "stale";
    if (status !== "stale") return status;
    // The entity changed after the edit: the edit is proposed again over what the core says now.
    this.state.dropEdit(path, hash);
    return null;
  }

  /**
   * Turns hand edits of the mirror into proposals: only what Juan (or whoever) changed since the mirror
   * last wrote the note, never a newer change of the core undone. Puts back the core's version of a
   * rejected one.
   */
  async scan(): Promise<ScanReport> {
    const report: ScanReport = { proposed: 0, adopted: 0, restored: 0, unreadable: [] };
    const schema = this.store.schema();
    // Read only when a note changed: most rounds find none.
    let linksMemo: Links | null = null;
    const real = (): Links => {
      if (!linksMemo) linksMemo = this.links();
      return linksMemo;
    };
    const lazy: Links = {
      nameOf: (id) => real().nameOf(id),
      resolve: (name, target) => real().resolve(name, target),
    };
    const links = lazy;
    let knownMemo: Set<string> | null = null;
    const statePaths = new Set(this.state.refs().map((r) => r.path));
    const sync: SyncReport = { written: 0, created: 0, trashed: 0, held: [] };
    for (const m of this.state.types()) {
      const t = schema.types[m.type];
      if (!t) continue;
      const refs = this.state.refs(m.type);
      const under = this.notesUnder(m.folder);
      for (const ref of refs) {
        const stamp = under.get(ref.path);
        if (stamp && this.stamps.get(ref.path) === stamp) continue;
        const row = this.state.noteAt(ref.path);
        if (!row) continue;
        const s = this.store.get(row.entity);
        // Trashed by the mirror: the next sync brings the note back if the entity is restored.
        if (!s || s.entity.deleted !== undefined || row.sha === GONE) continue;
        const f = this.readMaybe(row.path);
        if (!f) {
          const status = this.editStatus(row.path, GONE);
          if (status === "rejected") {
            await this.writeEntity(s, t, m, links, sync);
            report.restored++;
          } else if (status === null) {
            const l = this.noteLabel(t, row.path, GONE);
            const id = this.o.propose({
              tool: "entities.delete",
              args: { id: leaf(row.entity, l) },
              origin: "mirror",
              title: "Nota borrada en Obsidian",
              rows: this.rowsFor(row.path, []),
            });
            this.state.addEdit({
              path: row.path,
              sha: GONE,
              proposal: id,
              kind: "delete",
              entity: row.entity,
            });
            report.proposed++;
          }
          continue;
        }
        const h = sha(f.text);
        if (h === row.sha) {
          if (stamp) this.stamps.set(row.path, stamp);
          continue;
        }
        const status = this.editStatus(row.path, h);
        if (status === "pending" || status === "postponed") continue;
        if (status !== null) {
          // Decided: accepted (the note is the mirror's again) or rejected (the core's comes back).
          await this.writeEntity(s, t, m, links, sync);
          if (status !== "accepted") report.restored++;
          continue;
        }
        const parsed = parseNote(f.text);
        if (parsed.error) {
          report.unreadable.push(row.path);
          continue;
        }
        const p = parseEdit(
          parsed.values,
          parsed.body,
          baseName(row.path),
          t,
          m,
          this.base(row),
          links,
        );
        if (!Object.keys(p.values).length && p.body === undefined && !p.problems.length) {
          // Only the layout changed (or a property the mirror does not know): it is the mirror's again.
          this.state.setNote({ ...row, sha: h, text: f.text });
          report.adopted++;
          continue;
        }
        const l = this.noteLabel(t, row.path, h);
        const id = this.o.propose({
          tool: "entities.update",
          args: { id: leaf(row.entity, l), values: this.valuesVal(p, l) },
          origin: "mirror",
          title: "Cambio hecho a mano en Obsidian",
          rows: this.rowsFor(row.path, p.problems),
        });
        this.state.addEdit({
          path: row.path,
          sha: h,
          proposal: id,
          kind: "update",
          entity: row.entity,
        });
        report.proposed++;
      }
      // New notes in the type's folder.
      const empty: Rendered = { props: {}, body: "", omitted: [], title: "" };
      const creating = new Set(
        this.state
          .edits()
          .filter((e) => e.kind === "create")
          .map((e) => e.path),
      );
      for (const path of under.keys()) {
        if (statePaths.has(path) || creating.has(path)) continue;
        knownMemo ??= this.knownPaths();
        if (knownMemo.has(path)) continue;
        const f = this.readMaybe(path);
        if (!f) continue;
        const h = sha(f.text);
        const parsed = parseNote(f.text);
        if (parsed.error) {
          report.unreadable.push(path);
          continue;
        }
        const p = parseEdit(parsed.values, parsed.body, baseName(path), t, m, empty, links);
        const l = this.noteLabel(t, path, h);
        const id = this.o.propose({
          tool: "entities.create",
          args: { type: leaf(typeName(t), l), values: this.valuesVal(p, l) },
          origin: "mirror",
          title: "Nota nueva en Obsidian",
          rows: this.rowsFor(path, p.problems),
        });
        this.state.addEdit({ path, sha: h, proposal: id, kind: "create", entity: t.id });
        report.proposed++;
      }
    }
    return report;
  }
}
