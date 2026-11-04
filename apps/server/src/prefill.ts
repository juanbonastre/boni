/**
 * Relations a mail's proposal gets by code (task 51, phases B and C; Juan, 2026-11-03: «cruzar distintas fuentes de
 * datos para que realmente entienda el contexto»): for each relation field of the collection a proposal goes to,
 * the one record of the related collection the mail plainly names: the sender, when a record's title is the
 * sender's name; else a record whose title the sender's own words contain («IPM 25-26»; a reply's quoted part does
 * not count: the names in it are of others). One match or none,
 * never a guess, never a model, nothing of the user's domain named here (D-14). The reader may still choose
 * another among the options it sees: its choice comes first (`first` in the plan).
 */
import { normalizeTitle } from "@boni/calendar";
import type { TypeDef } from "@boni/entities";

export interface Prefill {
  key: string;
  name: string;
  id: string;
  title: string;
  by: "sender" | "text";
}
export interface Named {
  id: string;
  title: string;
}

/** A title a mail may carry by chance («Casa»): never looked for inside the text. One with a number is specific. */
const specific = (norm: string) => norm.length >= 6 || (norm.length >= 4 && /\d/.test(norm));

/** Where a reply starts quoting earlier mail: what the sender wrote is above it (the web's mailText.ts cuts alike). */
const QUOTE =
  /^(>.*|El .{0,120} escribi[oó]:|On .{0,120} wrote:|-{2,} ?(Original|Mensaje original|Forwarded).*|De: .*|From: .*)$/im;
/** The sender's own words: the subject and the body above its first quoted part. */
export function ownText(subject: string, body: string): string {
  const m = QUOTE.exec(body);
  return `${subject}\n${m ? body.slice(0, m.index) : body}`;
}

export function prefillOf(
  t: TypeDef,
  types: Readonly<Record<string, TypeDef>>,
  recordsOf: (type: string) => Named[],
  mail: { sender: string; text: string },
): Prefill[] {
  const sender = normalizeTitle(mail.sender);
  const text = ` ${normalizeTitle(mail.text)} `;
  const out: Prefill[] = [];
  for (const f of t.fields) {
    if (f.type !== "relation" || !f.relation || f.relation.many) continue;
    if (f.hidden || f.archived || f.sensitivity === "sensitive") continue;
    const target = types[f.relation.target];
    if (!target || target.system || target.archived) continue;
    const named = recordsOf(target.id)
      .map((r) => ({ ...r, norm: normalizeTitle(r.title) }))
      .filter((r) => r.norm);
    const bySender = sender ? named.filter((r) => r.norm === sender) : [];
    if (bySender.length > 1) continue;
    const one = bySender[0];
    if (one) {
      out.push({ key: f.key, name: f.name, id: one.id, title: one.title, by: "sender" });
      continue;
    }
    const inText = named
      .filter((r) => specific(r.norm) && text.includes(` ${r.norm} `))
      .sort((a, b) => b.norm.length - a.norm.length);
    const best = inText[0];
    if (!best) continue;
    // The most specific one, when every other match is part of it («FUP 1» over «FUP»); two alike: none.
    const alike = inText.filter((r) => r.norm === best.norm).length;
    if (alike > 1 || !inText.every((r) => best.norm.includes(r.norm))) continue;
    out.push({ key: f.key, name: f.name, id: best.id, title: best.title, by: "text" });
  }
  return out;
}
