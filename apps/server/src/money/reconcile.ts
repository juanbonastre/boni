import type { CategoryKind } from "@boni/views";
import { readRows } from "./sheets.ts";
import { asciiLow, type BankLine, parseStatement } from "./statements.ts";

/**
 * The monthly reconciliation (procedimiento-conciliacion.md in Juan's Boni),
 * ported from `finanzas.py` of the gastos-app repo (2026-10-23) so it runs on Boni's own movements once they live
 * in Boni: `importStatements` turns new bank lines into movements and joins them with what Juan noted in the app;
 * `closeMonth` checks a month's pending movements and marks the complete ones `conciliado`. Both are a dry run
 * unless `apply`; their report is the script's, line by line (Spanish without accents), for Juan or an AI. The
 * movements and debts come through a `Book` (the store, `book.ts`; plain notes in the tests): the logic is the
 * script's and never touches the store itself.
 */

/** A movement or a debt as the script read a note: its path and its properties by name. */
export interface MoneyNote {
  id: string;
  path: string;
  fm: Record<string, unknown>;
}
export type PropValue = string | number | boolean | null;
export interface Book {
  movements(): MoneyNote[];
  debts(): MoneyNote[];
  /** Whether a note path is taken (a movement's file name is never reused). */
  taken(path: string): boolean;
  /** A new movement from its note text (as the script wrote it), from that statement. */
  create(path: string, text: string, statement: string): void;
  /** Some properties of a movement, by name. */
  update(id: string, props: Record<string, PropValue>, statement?: string): void;
}
/** A statement file: its name and bytes. */
export interface StatementFile {
  name: string;
  bytes: Buffer;
}

export const MOV = "registros/finanzas/movimientos";
export const UNKNOWN = "otros/desconocido";
const NOT_EXPENSE = ["ingreso/", "inversion", "transferencia/"];
const MATCH_DAYS = 3;

const fmt = (x: number) => x.toFixed(2);
/** The report, a line at a time. */
function logger() {
  const lines: string[] = [];
  return Object.assign((s: string) => void lines.push(s), { lines });
}
const euro = (x: number) => Math.abs(x).toFixed(2).replace(".", ",");
const toFloat = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asList = (v: unknown): unknown[] =>
  v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v];
/** "[[a/b|alias]]" → "b"; plain text as it is. */
export const linkName = (v: unknown) => {
  const s = String(v ?? "").trim();
  const m = /^\[\[([^\]|#]+)/.exec(s);
  return m ? ((m[1] as string).split("/").pop() as string).trim() : s;
};
const noteName = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");
const yq = (s: string) => JSON.stringify(s);
const slug = (s: string, max = 40) =>
  asciiLow(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");

// ------------------------------------------------------------------ rules

export type Rule = [pattern: string, merchant: string, category: string];

/** A bank text as rules compare it: ASCII, lower case. */
export const rulePattern = (s: string) => asciiLow(s).trim();
/** Longest pattern first (the first that matches wins). */
export const sortRules = (rules: Rule[]) => [...rules].sort((a, b) => b[0].length - a[0].length);

/** reglas.csv's rows (pattern,merchant,category,notes), in the file's order. */
export function parseRuleRows(
  csv: string,
): { pattern: string; merchant: string; category: string; notes: string }[] {
  const lines = csv.replace(/\r\n?/g, "\n").split("\n");
  const head = (lines.shift() ?? "").split(",").map((h) => h.trim());
  const col = (n: string) => head.indexOf(n);
  const rows: { pattern: string; merchant: string; category: string; notes: string }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const pattern = rulePattern(cells[col("pattern")] ?? "");
    if (pattern)
      rows.push({
        pattern,
        merchant: (cells[col("merchant")] ?? "").trim(),
        category: (cells[col("category")] ?? "").trim(),
        notes: col("notes") < 0 ? "" : (cells[col("notes")] ?? "").trim(),
      });
  }
  return rows;
}

/** reglas.csv as rules: longest pattern first. */
export const parseRules = (csv: string): Rule[] =>
  sortRules(parseRuleRows(csv).map((r) => [r.pattern, r.merchant, r.category]));
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

/** The longest rule whose pattern is in the text; a pattern starting with "=" must be the whole text. */
export function matchRule(rules: Rule[], text: unknown): Rule | null {
  const t = asciiLow(text).split(/\s+/).filter(Boolean).join(" ");
  return (
    rules.find((r) => (r[0].startsWith("=") ? t === r[0].slice(1).trim() : t.includes(r[0]))) ??
    null
  );
}

/** A merchant's name from a bank text: ASCII, no * or #, Title Case when the bank shouts. */
export function prettyMerchant(text: string): string {
  const t = (text ?? "")
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .replace(/[*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[A-Z]/.test(t) && t === t.toUpperCase()
    ? t
        .toLowerCase()
        .replace(/(^|[^a-z])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    : t;
}

// ------------------------------------------------------------------ import

function minutesApart(aDate: string, aTime: string, bDate: string, bTime: string): number {
  const da = Date.parse(`${aDate}T00:00:00Z`);
  const db = Date.parse(`${bDate}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) throw new Error("bad date");
  let m = Math.abs(Math.round((da - db) / 86_400_000)) * 1440;
  if (aTime && bTime && da === db) {
    const [ah, am] = aTime.split(":").map(Number) as [number, number];
    const [bh, bm] = bTime.split(":").map(Number) as [number, number];
    m = Math.abs(ah * 60 + am - (bh * 60 + bm));
  }
  return m;
}

/**
 * Each bank line with at most one app note (same account or none, same amount, at most MATCH_DAYS apart), the
 * closest first; a tie for the best pair makes both sides unclear (never a guess, never a possible duplicate).
 */
export function joinCandidates(
  lines: BankLine[],
  notes: MoneyNote[],
): { joined: Map<number, string>; unclear: Map<number, string[]> } {
  const pairs: [number, number, string][] = [];
  lines.forEach((ln, i) => {
    for (const n of notes) {
      const acc = String(n.fm.account ?? "");
      if (acc !== "" && acc !== ln.account) continue;
      const amt = toFloat(n.fm.amount);
      if (amt === null || Math.abs(amt - ln.amount) > 0.005) continue;
      let gap: number;
      try {
        gap = minutesApart(ln.date, ln.time, String(n.fm.date ?? ""), String(n.fm.time ?? ""));
      } catch {
        continue;
      }
      if (gap <= MATCH_DAYS * 1440) pairs.push([gap, i, n.path]);
    }
  });
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  const usedL = new Set<number>();
  const usedN = new Set<string>();
  const unclearNotes = new Set<string>();
  const joined = new Map<number, string>();
  const unclear = new Map<number, string[]>();
  for (const [gap, i, p] of pairs) {
    if (usedL.has(i) || usedN.has(p)) continue;
    const tie = pairs.filter(
      (q) => q[0] === gap && (q[1] === i) !== (q[2] === p) && !usedL.has(q[1]) && !usedN.has(q[2]),
    );
    if (tie.length) {
      const groupLines = new Set([i, ...tie.map((q) => q[1])]);
      const groupNotes = new Set([p, ...tie.map((q) => q[2])]);
      for (const l of groupLines) {
        const cand = new Set(pairs.filter((q) => q[1] === l && !usedN.has(q[2])).map((q) => q[2]));
        if (l === i) for (const n of groupNotes) cand.add(n);
        unclear.set(l, [...cand].sort());
      }
      for (const l of groupLines) usedL.add(l);
      for (const n of groupNotes) {
        usedN.add(n);
        unclearNotes.add(n);
      }
      continue;
    }
    joined.set(i, p);
    usedL.add(i);
    usedN.add(p);
  }
  // A line that could have been one of the unclear notes is unclear too.
  for (const [, i, p] of pairs)
    if (!joined.has(i) && unclearNotes.has(p)) {
      const list = unclear.get(i) ?? [];
      if (!list.includes(p)) list.push(p);
      unclear.set(i, list);
    }
  return { joined, unclear };
}

function newMovementText(ln: BankLine, rule: Rule | null, created: string) {
  const merchant = rule?.[1] || prettyMerchant(ln.text) || "Movimiento";
  const category = rule?.[2] || UNKNOWN;
  const fm = ["type: movement", `date: ${ln.date}`];
  if (ln.time) fm.push(`time: "${ln.time}"`);
  fm.push(
    `amount: ${fmt(ln.amount)}`,
    `currency: ${ln.currency}`,
    "my_share:",
    `account: ${ln.account}`,
    `category: ${category}`,
    `merchant: ${yq(merchant)}`,
    'concept: ""',
    "people: []",
    "invited: []",
    "related: []",
    "status: pendiente",
    `source: ${ln.account}`,
    `bank_ref: ${ln.ref}`,
    `bank_text: ${yq(ln.text)}`,
    `created: ${created}`,
  );
  const body = ln.body.join("\n");
  const text = `---\n${fm.join("\n")}\n---\n\n# ${merchant} ${euro(ln.amount)} EUR\n${body ? `\n${body}\n` : ""}`;
  return { merchant, category, text };
}

export interface ImportResult {
  created: string[];
  joined: string[];
  unclear: string[];
  report: string[];
}

/** New bank lines into movements, joined with the app's notes; the script's `import`. */
export function importStatements(
  book: Book,
  files: StatementFile[],
  o: { rules: Rule[]; apply: boolean; today: string },
): ImportResult {
  const out = logger();
  const all = book.movements();
  const known = new Set(
    all
      .map((n) => n.fm.bank_ref)
      .filter(Boolean)
      .map(String),
  );
  const openApp = all.filter(
    (n) => !n.fm.bank_ref && n.fm.status === "pendiente" && n.fm.account !== "efectivo",
  );
  if (!files.length) {
    out(`No hay extractos en registros/finanzas/extractos/`);
    return { created: [], joined: [], unclear: [], report: out.lines };
  }
  const lines: (BankLine & { file: string })[] = [];
  for (const f of files) {
    try {
      const st = parseStatement(readRows(f.bytes, f.name));
      let msg = `${f.name}: ${st.bank}, ${st.lines.length} lineas`;
      const list = (m: Map<string, number>) =>
        [...m.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([k, v]) => `${k} ${v}`)
          .join(", ");
      if (st.skipped.size) msg += `; descartadas: ${list(st.skipped)}`;
      if (st.products.size) msg += `; productos: ${list(st.products)}`;
      out(msg);
      lines.push(...st.lines.map((l) => ({ ...l, file: f.name })));
    } catch (e) {
      out(`ERROR ${f.name}: ${(e as Error).message}`);
    }
  }
  // The same line can come in two overlapping statements: one is kept.
  const fresh: (BankLine & { file: string })[] = [];
  const seen = new Set<string>();
  let already = 0;
  for (const ln of lines) {
    if (known.has(ln.ref)) already++;
    else if (!seen.has(ln.ref)) {
      seen.add(ln.ref);
      fresh.push(ln);
    }
  }
  fresh.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? -1
        : 1
      : a.time !== b.time
        ? a.time < b.time
          ? -1
          : 1
        : a.ref < b.ref
          ? -1
          : 1,
  );
  const { joined, unclear } = joinCandidates(fresh, openApp);
  const byPath = new Map(openApp.map((n) => [n.path, n]));
  const edits = new Map<
    string,
    { note: MoneyNote; props: Record<string, PropValue>; file: string }
  >();
  const creates: { path: string; text: string; file: string }[] = [];
  const taken = new Set<string>();
  let byRule = 0;
  let unknown = 0;
  fresh.forEach((ln, i) => {
    const rule = matchRule(o.rules, ln.text);
    const p = joined.get(i);
    if (p !== undefined) {
      const note = byPath.get(p) as MoneyNote;
      const props: Record<string, PropValue> = { bank_ref: ln.ref, bank_text: ln.text };
      if (!note.fm.account) props.account = ln.account;
      if (!note.fm.merchant) props.merchant = rule?.[1] || prettyMerchant(ln.text);
      if (!note.fm.time && ln.time) props.time = ln.time;
      edits.set(p, { note, props, file: ln.file });
    } else if (!unclear.has(i)) {
      const { merchant, category, text } = newMovementText(ln, rule, o.today);
      const base = `${ln.date}${ln.time ? `-${ln.time.replace(":", "")}` : ""}-${slug(merchant) || "movimiento"}`;
      const dir = `${MOV}/${ln.date.slice(0, 4)}/${ln.date.slice(5, 7)}`;
      let path = "";
      for (let n = 1; ; n++) {
        path = `${dir}/${base}${n === 1 ? "" : `-${n}`}.md`;
        if (!taken.has(path) && !book.taken(path)) break;
      }
      taken.add(path);
      creates.push({ path, text, file: ln.file });
      if (category === UNKNOWN) unknown++;
      else byRule++;
    }
  });
  out(`Lineas del banco: ${lines.length}; ya importadas: ${already}; nuevas: ${fresh.length}`);
  out(
    `Unidas a notas de la app: ${edits.size}; notas nuevas: ${creates.length} (categoria por regla ${byRule}, sin categoria ${unknown}); dudosas: ${unclear.size}`,
  );
  for (const [i, p] of [...joined.entries()].sort((a, b) => a[0] - b[0])) {
    const ln = fresh[i] as BankLine;
    out(`  UNIDA   ${ln.date} ${fmt(ln.amount)} ${ln.text}  ->  ${p}`);
  }
  for (const [i, paths] of [...unclear.entries()].sort((a, b) => a[0] - b[0])) {
    const ln = fresh[i] as BankLine;
    out(
      `  DUDOSA  ${ln.date} ${fmt(ln.amount)} ${ln.text} [${ln.ref}]  posibles notas: ${paths.join(", ")}`,
    );
  }
  if (unclear.size)
    out(
      "  (las dudosas no se importan: en la nota correcta pon bank_ref y vuelve a importar, o pon 'separadas')",
    );
  const result = (report: string[]): ImportResult => ({
    created: creates.map((c) => c.path),
    joined: [...edits.keys()],
    unclear: [...unclear.keys()].sort((a, b) => a - b).map((i) => (fresh[i] as BankLine).ref),
    report,
  });
  if (!o.apply) {
    for (const c of creates.slice(0, 2)) out(`\n=== ${c.path}\n${c.text}`);
    out("\n(simulacion: no se ha escrito nada)");
    return result(out.lines);
  }
  for (const e of edits.values()) book.update(e.note.id, e.props, e.file);
  for (const c of creates) book.create(c.path, c.text, c.file);
  out(`Escrito: ${edits.size} notas unidas, ${creates.length} notas nuevas en ${MOV}/`);
  return result(out.lines);
}

// ------------------------------------------------------------------ close

const byName = (category: string): CategoryKind =>
  category.startsWith("ingreso/")
    ? "ingreso"
    : NOT_EXPENSE.some((p) => category.startsWith(p))
      ? "otro"
      : "gasto";

/** Why a pending movement cannot be `conciliado` yet (empty: ready). */
export function movementProblems(
  fm: Record<string, unknown>,
  name: string,
  cats: string[],
  debtsByMovement: Map<string, Record<string, unknown>[]>,
  targets: Set<string>,
  kindOf: (category: string) => CategoryKind = byName,
): string[] {
  const isSpending = (c: string) => kindOf(c) === "gasto";
  const probs: string[] = [];
  const cat = String(fm.category ?? "");
  const amount = toFloat(fm.amount) ?? 0;
  if (!cat || cat === UNKNOWN) probs.push("sin categoria");
  else if (cats.length && !cats.includes(cat))
    probs.push(`categoria '${cat}' no esta en las categorias`);
  if ((fm.account === "revolut" || fm.account === "ing") && !fm.bank_ref)
    probs.push("sin linea del banco (no esta en los extractos importados)");
  const invited = new Set(asList(fm.invited).map(linkName));
  const owing = asList(fm.people)
    .map(linkName)
    .filter((x) => !invited.has(x));
  if (amount < 0 && owing.length && isSpending(cat)) {
    if (toFloat(fm.my_share) === null) probs.push(`compartido sin my_share (${owing.join(", ")})`);
    const have = new Set((debtsByMovement.get(name) ?? []).map((d) => linkName(d.person)));
    const missing = owing.filter((x) => !have.has(x));
    if (missing.length) probs.push(`faltan deudas de: ${missing.join(", ")}`);
  }
  if (amount > 0 && isSpending(cat) && !fm.settles)
    probs.push(
      "ingreso de una categoria de gasto sin settles (de que deuda o gasto es el reembolso?)",
    );
  if (fm.settles && !targets.has(linkName(fm.settles)))
    probs.push(`settles apunta a una nota que no existe: ${String(fm.settles)}`);
  return probs;
}

export interface CloseResult {
  ready: string[];
  blocked: [string, string[]][];
  report: string[];
}

/** A month's pending movements checked, the complete ones marked `conciliado`; the script's `close`. */
export function closeMonth(
  book: Book,
  month: string | null,
  o: {
    cats: string[];
    rules: Rule[];
    apply: boolean;
    kindOf?: (category: string) => CategoryKind;
  },
): CloseResult {
  const out = logger();
  const notes = book.movements();
  const debts = book.debts().filter((d) => d.fm.type === "debt" || d.fm.type === undefined);
  const debtsByMovement = new Map<string, Record<string, unknown>[]>();
  for (const d of debts) {
    const k = linkName(d.fm.movement);
    debtsByMovement.set(k, [...(debtsByMovement.get(k) ?? []), d.fm]);
  }
  const targets = new Set([...notes, ...debts].map((n) => noteName(n.path)));
  const pending = notes.filter(
    (n) => n.fm.status === "pendiente" && (!month || String(n.fm.date ?? "").startsWith(month)),
  );
  const ready: MoneyNote[] = [];
  const blocked: [MoneyNote, string[]][] = [];
  const noRule = new Set<string>();
  for (const n of pending) {
    const probs = movementProblems(
      n.fm,
      noteName(n.path),
      o.cats,
      debtsByMovement,
      targets,
      o.kindOf,
    );
    if (probs.length) blocked.push([n, probs]);
    else ready.push(n);
    if (n.fm.bank_text && !probs.length && !matchRule(o.rules, n.fm.bank_text))
      noRule.add(
        `${String(n.fm.bank_text)}  ->  ${String(n.fm.merchant ?? "")}, ${String(n.fm.category ?? "")}`,
      );
  }
  out(
    `Movimientos pendientes${month ? ` de ${month}` : ""}: ${pending.length}; listos para conciliar: ${ready.length}; siguen pendientes: ${blocked.length}`,
  );
  for (const [n, probs] of blocked)
    out(
      `  PENDIENTE ${String(n.fm.date)} ${fmt(toFloat(n.fm.amount) ?? 0)} ${n.path}: ${probs.join("; ")}`,
    );
  if (noRule.size) {
    out("Textos del banco sin regla (candidatos para Reglas):");
    for (const r of [...noRule].sort()) out(`  ${r}`);
  }
  const owed = new Map<string, number>();
  const owe = new Map<string, number>();
  for (const d of debts) {
    if (d.fm.status !== "pendiente") continue;
    const m = (d.fm.direction ?? "me-deben") === "me-deben" ? owed : owe;
    const who = linkName(d.fm.person);
    m.set(who, (m.get(who) ?? 0) + (toFloat(d.fm.amount) ?? 0));
  }
  const sum = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `${k} ${euro(v)} EUR`)
      .join(", ");
  if (owed.size) out(`Te deben: ${sum(owed)}`);
  if (owe.size) out(`Debes: ${sum(owe)}`);
  const result = (): CloseResult => ({
    ready: ready.map((n) => n.path),
    blocked: blocked.map(([n, p]) => [n.path, p]),
    report: out.lines,
  });
  if (!o.apply) {
    out("(simulacion: no se ha escrito nada)");
    return result();
  }
  for (const n of ready) book.update(n.id, { status: "conciliado" });
  out(`Marcados como conciliado: ${ready.length}`);
  return result();
}
