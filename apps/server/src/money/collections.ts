import { randomUUID } from "node:crypto";
import { type FieldDef, type Label, label, type TypeDef } from "@boni/entities";
import type { OpMeta, UserStore, Writes } from "@boni/store";
import { type CategoryKind, kindByName } from "@boni/views";
import { PATH_FIELD } from "../paths.ts";
import { CATEGORIES, storeNotes } from "./book.ts";
import { parseRuleRows, type Rule, rulePattern, sortRules } from "./reconcile.ts";

/**
 * The money's own collections (Juan, 2026-10-23: in Boni everything is a collection, but for attachments and
 * notes): "Categorías" (a row per category: its name, its kind, what goes in it) and "Reglas" (a bank text, the
 * merchant and category it means). A movement's `category` points to a row of Categorías. They replace the
 * `registros/finanzas/categorias.md` list and `reglas.csv` the money came with; `moneyCollections` moves those in
 * once (`cli.ts money <name>`).
 */
export { CATEGORIES };
export const RULES = "t_regla";
const MOVEMENTS = "t_movimiento";
const CATEGORIES_NOTE = "registros/finanzas/categorias.md";
const RULES_FILE = "registros/finanzas/reglas.csv";
/** The movement's category: a relation once moved here (the text it was is kept, archived). */
const CATEGORY_REF = "f_category_ref";

const CODE = label("own", "personal", [{ kind: "code", id: "money" }]);
const KINDS: [CategoryKind, string][] = [
  ["gasto", "Gasto"],
  ["ingreso", "Ingreso"],
  ["otro", "Ni gasto ni ingreso"],
];
const kindOption = (k: CategoryKind) => `o_${k}`;

const field = (id: string, key: string, name: string, type: FieldDef["type"]): FieldDef => ({
  id,
  key,
  name,
  type,
  label: CODE,
});
function categoriesType(): TypeDef {
  return {
    id: CATEGORIES,
    key: "categoria",
    name: "Categorías",
    fields: [
      field("f_nombre", "nombre", "Nombre", "text"),
      {
        ...field("f_tipo", "tipo", "Tipo", "select"),
        options: KINDS.map(([k, name]) => ({ id: kindOption(k), name, label: CODE })),
      },
      field("f_que_va", "que_va", "Qué va", "longtext"),
      field("f_ejemplos", "ejemplos", "Ejemplos", "text"),
    ],
    titleField: "f_nombre",
    sensitivity: "personal",
    schemaVersion: 1,
    label: CODE,
  };
}
function rulesType(): TypeDef {
  return {
    id: RULES,
    key: "regla",
    name: "Reglas",
    fields: [
      field("f_texto", "texto", "Texto del banco", "text"),
      field("f_comercio", "comercio", "Comercio", "text"),
      {
        ...field("f_categoria", "categoria", "Categoría", "relation"),
        relation: { target: CATEGORIES, many: false },
      },
      field("f_notas", "notas", "Notas", "text"),
    ],
    titleField: "f_texto",
    sensitivity: "personal",
    schemaVersion: 1,
    label: CODE,
  };
}

const has = (store: UserStore, type: string) => {
  const t = store.schema().types[type];
  return !!t && !t.archived;
};
/**
 * Whether the money uses its collections: a movement's category points to Categorías. That change is in the
 * move's run, so undoing it goes back to the vault's list and file (the collections, emptied, stay: a type with
 * rows in the trash cannot be removed, and a second move uses them again).
 */
export function moneyCollectionsOn(store: UserStore): boolean {
  const f = store
    .schema()
    .types[MOVEMENTS]?.fields.find((x) => !x.archived && x.name === "category");
  return f?.type === "relation" && f.relation?.target === CATEGORIES && has(store, CATEGORIES);
}
const titleOf = (store: UserStore, id: unknown): string => {
  const e = typeof id === "string" ? store.get(id)?.entity : undefined;
  const t = e ? store.schema().types[e.type] : undefined;
  return e && t && e.deleted === undefined ? String(e.values[t.titleField] ?? "") : "";
};

/** The account's categories (name and kind), by name; null before they are a collection. */
export function categoryRows(store: UserStore): { name: string; kind: CategoryKind }[] | null {
  if (!moneyCollectionsOn(store)) return null;
  const byOption = new Map(KINDS.map(([k]) => [kindOption(k), k]));
  return store
    .entities(CATEGORIES)
    .map((e) => ({
      name: String(e.values.f_nombre ?? "").trim(),
      kind: byOption.get(String(e.values.f_tipo)) ?? kindByName(String(e.values.f_nombre ?? "")),
    }))
    .filter((c) => c.name)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The account's rules, longest bank text first; null before they are a collection. */
export function ruleRows(store: UserStore): Rule[] | null {
  if (!moneyCollectionsOn(store) || !has(store, RULES)) return null;
  return sortRules(
    store
      .entities(RULES)
      .map(
        (e): Rule => [
          rulePattern(String(e.values.f_texto ?? "")),
          String(e.values.f_comercio ?? "").trim(),
          titleOf(store, e.values.f_categoria),
        ],
      ),
  ).filter((r) => r[0]);
}

// ------------------------------------------------------------------ moving them in

export interface MoneyMove {
  report: string[];
  /** The run that `undoRun` takes back whole (applied only). */
  run: string | null;
}

/** "| cat | what | examples |" rows of the categories note's tables, by category. */
function describedIn(body: string, names: Set<string>): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  for (const line of body.split("\n")) {
    const cells = line.split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
    if (cells.length < 4 || !names.has(cells[1] as string)) continue;
    out.set(cells[1] as string, [cells[2] ?? "", cells.length > 4 ? (cells[3] ?? "") : ""]);
  }
  return out;
}

/**
 * The vault's categories note and `reglas.csv` (as the import left them: a note and a row of "Archivos") into
 * the collections Categorías and Reglas, and each movement's category text into a relation to its row. A
 * category a movement uses that the list did not have becomes a row too (named in the report): nothing is
 * lost. Dry run unless `apply`; applied, it is one run (`undoRun` takes it all back) and the `reglas.csv` row
 * goes to the trash (its rules are rows now). The note stays (its text explains the categories); its list is
 * no longer read.
 */
export function moneyCollections(
  store: UserStore,
  o: { apply: boolean; device?: string },
): MoneyMove {
  const report: string[] = [];
  if (!has(store, MOVEMENTS)) throw new Error("no movements in Boni (the collection Movimiento)");
  if (moneyCollectionsOn(store))
    throw new Error("the money already uses Categorías: nothing to move");
  const mov = store.schema().types[MOVEMENTS] as TypeDef;
  const oldField = mov.fields.find((f) => !f.archived && f.name === "category");
  if (!oldField) throw new Error("Movimiento has no category property");
  if (oldField.type !== "text" && oldField.type !== "select")
    throw new Error(`Movimiento's category is a ${oldField.type}, not text`);

  // The list and its descriptions, from the note.
  const note = store.findByValue(PATH_FIELD, CATEGORIES_NOTE)[0];
  const fromNote = note
    ? storeNotes(store)(note.type, "").find((n) => n.id === note.id)
    : undefined;
  const raw = fromNote?.fm.categories;
  const listed = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\n,]/) : [])
    .map((x) => String(x).trim())
    .filter(Boolean);
  const body = note ? (store.get(note.id)?.entity.body ?? "") : "";
  // What the movements use: by name (a select's option by its name).
  const used = new Map<string, number>();
  const textOf = (v: unknown) =>
    oldField.type === "select"
      ? (oldField.options?.find((x) => x.id === v)?.name ?? "")
      : String(v ?? "").trim();
  for (const e of store.entities(MOVEMENTS)) {
    const t = textOf(e.values[oldField.id]);
    if (t) used.set(t, (used.get(t) ?? 0) + 1);
  }
  const extra = [...used.keys()].filter((c) => !listed.includes(c)).sort();
  const names = [...listed, ...extra];
  const described = describedIn(body, new Set(names));
  report.push(
    `Categorias: ${names.length} (${listed.length} de ${CATEGORIES_NOTE}, ${described.size} con su explicacion)`,
  );
  if (extra.length)
    report.push(
      `  usadas por movimientos sin estar en la lista (se crean igual): ${extra.map((c) => `${c} (${used.get(c)})`).join(", ")}`,
    );
  for (const k of KINDS)
    report.push(
      `  ${k[1]}: ${names.filter((c) => kindByName(c) === k[0]).join(", ") || "ninguna"}`,
    );

  // The rules, from the file.
  const file = store.findByValue(PATH_FIELD, RULES_FILE)[0];
  const sha = file ? store.get(file.id)?.entity.values.f_boni_file : undefined;
  const bytes = typeof sha === "string" ? store.getFile(sha)?.data : undefined;
  const csv = bytes ? Buffer.from(bytes).toString("utf8") : "";
  const rules = csv ? parseRuleRows(csv) : [];
  const ruleCats = rules.filter((r) => r.category && !names.includes(r.category));
  report.push(`Reglas: ${rules.length}${file ? ` (de ${RULES_FILE})` : ` (no hay ${RULES_FILE})`}`);
  for (const r of ruleCats)
    report.push(
      `  regla '${r.pattern}' con categoria '${r.category}' que no existe: queda sin categoria`,
    );
  const moved = [...used.values()].reduce((a, b) => a + b, 0);
  report.push(`Movimientos: ${moved} pasan su categoria de texto a la fila de Categorias`);

  if (!o.apply) {
    report.push("(simulacion: no se ha escrito nada; --apply para hacerlo)");
    return { report, run: null };
  }
  const run = `money-${randomUUID()}`;
  const meta: OpMeta = { actor: "import", device: o.device ?? "cli", run };
  const w = (value: unknown, l: Label = CODE) => ({ value, label: l });

  // The collections outside the run (see moneyCollectionsOn); what fills them and the switch, inside.
  const outside: OpMeta = { actor: "import", device: o.device ?? "cli" };
  if (!has(store, CATEGORIES))
    store.applySchema({ op: "create_type", type: categoriesType() }, outside);
  if (!has(store, RULES)) store.applySchema({ op: "create_type", type: rulesType() }, outside);
  const ids = new Map<string, string>();
  for (const name of names) {
    const [what, examples] = described.get(name) ?? ["", ""];
    const writes: Writes = {
      f_nombre: w(name),
      f_tipo: w(kindOption(kindByName(name))),
    };
    if (what) writes.f_que_va = w(what);
    if (examples) writes.f_ejemplos = w(examples);
    ids.set(name, store.create(CATEGORIES, writes, meta).entity.id);
  }
  for (const r of rules) {
    const writes: Writes = { f_texto: w(r.pattern) };
    if (r.merchant) writes.f_comercio = w(r.merchant);
    const cat = ids.get(r.category);
    if (cat) writes.f_categoria = w(cat);
    if (r.notes) writes.f_notas = w(r.notes);
    store.create(RULES, writes, meta);
  }
  if (file) store.remove(file.id, meta);

  // The movements' category: the old text field kept, archived and renamed; a relation in its place.
  store.applySchema(
    {
      op: "rename_field",
      type: MOVEMENTS,
      field: oldField.id,
      key: `${oldField.key}_texto`.slice(0, 64),
      name: "category (texto)",
      label: CODE,
    },
    meta,
  );
  store.applySchema(
    { op: "archive_field", type: MOVEMENTS, field: oldField.id, archived: true },
    meta,
  );
  store.applySchema(
    {
      op: "add_field",
      type: MOVEMENTS,
      field: {
        ...field(CATEGORY_REF, oldField.key, "category", "relation"),
        relation: { target: CATEGORIES, many: false },
      },
      at: mov.fields.indexOf(oldField),
    },
    meta,
  );
  for (const s of store.list(MOVEMENTS)) {
    const cat = ids.get(textOf(s.entity.values[oldField.id]));
    if (cat)
      store.update(s.entity.id, { [CATEGORY_REF]: w(cat, s.labels[oldField.id] ?? CODE) }, meta);
  }
  report.push(`Hecho (run ${run}); ${RULES_FILE} a la papelera de Archivos`);
  return { report, run };
}
