import { abs, type Dec, money, neg } from "./decimal.ts";

/**
 * The movement note, ported from the first Boni's expenses/note.py, itself a port of gastos-app's
 * MovementNote (gastos/Movement.kt): same file name, properties and heading, so notes written by Boni
 * and by the Android expenses app are the same for the monthly reconciliation (finanzas.py).
 */
export interface MovementDraft {
  kind: "gasto" | "ingreso";
  /** Positive, as typed. */
  amount: Dec;
  account: string;
  category: string;
  concept: string;
  merchant: string;
  date: string;
  /** "HH:MM", or null. */
  time: string | null;
  people: string[];
  invited: string[];
  related: string[];
  myShare: Dec | null;
}

/** "Peña y Ruíz" -> "Pena y Ruiz" (no accents in generated names). */
export const asciiText = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "");

/** "Cena con Peña!" -> "cena-con-pena" (Slug.of in gastos-app). */
export function slug(s: string, max = 60): string {
  return asciiText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
}

/** A double-quoted YAML scalar (Frontmatter.quote in gastos-app). */
export function yamlQuote(s: string): string {
  let out = '"';
  for (const c of s) {
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\t") out += "\\t";
    else if (c < " ") out += `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else out += c;
  }
  return `${out}"`;
}

const flowList = (items: string[]) => `[${items.map(yamlQuote).join(", ")}]`;
const euros = (x: Dec) => money(abs(x)).replace(".", ",");

export function baseName(d: MovementDraft): string {
  const t = d.time ? `-${d.time.replace(":", "")}` : "";
  const s = slug(d.concept.trim() || d.merchant.trim(), 40) || "movimiento";
  return `${d.date}${t}-${s}`;
}

export function render(d: MovementDraft, created: string): string {
  const signed = d.kind === "gasto" ? neg(abs(d.amount)) : abs(d.amount);
  const merchant = d.merchant.trim();
  const title = d.concept.trim() || merchant || "Movimiento";
  return [
    "---",
    "type: movement",
    `date: ${d.date}`,
    ...(d.time ? [`time: "${d.time}"`] : []),
    `amount: ${money(signed)}`,
    "currency: EUR",
    `my_share: ${d.myShare !== null ? money(abs(d.myShare)) : ""}`,
    `account: ${d.account}`,
    `category: ${d.category}`,
    `merchant: ${merchant ? yamlQuote(merchant) : ""}`,
    `concept: ${yamlQuote(d.concept.trim())}`,
    `people: ${flowList(d.people.map((p) => `[[${p}]]`))}`,
    `invited: ${flowList(d.invited.map((p) => `[[${p}]]`))}`,
    `related: ${flowList(d.related.map((r) => `[[${r}]]`))}`,
    "status: pendiente",
    "source: manual",
    "bank_ref: ",
    `created: ${created}`,
    "---",
    "",
    `# ${title} ${euros(d.amount)} EUR`,
    "",
  ].join("\n");
}
