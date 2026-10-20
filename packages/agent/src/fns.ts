import { join, type Label } from "@boni/entities";
import {
  asKey,
  codeLabel,
  deepLabel,
  type Json,
  leaf,
  list,
  plain,
  rec,
  truthy,
  type Val,
} from "./values.ts";

/**
 * The plan's pure functions (FNS in plan.ts). Each result carries the joined label of everything it
 * read and is `derived`, so it is never a destination; nothing here can reach the store or the network.
 */
export class FnError extends Error {}

const num = (v: Val): number => {
  const x = plain(v);
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (x && typeof x === "object" && !Array.isArray(x) && typeof x.amount === "number")
    return x.amount;
  throw new FnError("not-a-number");
};
const items = (v: Val): Val[] => {
  if (v.t !== "list") throw new FnError("not-a-list");
  return v.items;
};
const text = (v: Val): string => {
  const x = plain(v);
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (x === null) return "";
  throw new FnError("not-text");
};
const key = (v: Val): string => {
  const x = plain(v);
  if (typeof x !== "string") throw new FnError("not-a-key");
  return x;
};
const fieldOf = (v: Val, k: string): Val | null => (v.t === "rec" ? (v.fields[k] ?? null) : null);
const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `today` is the turn's civil day in Juan's zone (the code gives it, the model cannot choose it). */
export function callFn(name: string, args: Val[], today: string): Val {
  const lab = args.length
    ? join(deepLabel(args[0] as Val), ...args.slice(1).map(deepLabel))
    : codeLabel("today");
  const out = (value: Json) => leaf(value, lab, true);
  const [a, b, c] = args as [Val, Val, Val];
  switch (name) {
    case "count":
      return out(items(a).length);
    case "sum":
    case "min":
    case "max": {
      const xs = items(a).map((i) => num(b ? (fieldOf(i, key(b)) ?? leaf(null, i.label)) : i));
      if (name === "sum") return out(Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100);
      if (!xs.length) return out(null);
      return out(name === "min" ? Math.min(...xs) : Math.max(...xs));
    }
    case "pick": {
      const f = fieldOf(a, key(b));
      return f ? { ...f, label: join(deepLabel(f), lab), derived: true } : out(null);
    }
    case "item": {
      const i = num(b);
      const it = items(a)[i];
      return it ? { ...it, label: join(deepLabel(it), lab), derived: true } : out(null);
    }
    case "field": {
      const k = key(b);
      return list(
        items(a).map((i) => {
          const f = fieldOf(i, k);
          return f ? { ...f, derived: true } : leaf(null, i.label, true);
        }),
        join(a.label, b.label),
        true,
      );
    }
    case "filter_eq": {
      const k = key(b);
      const want = plain(c);
      // Which items stay depends on each item's value: the kept ones carry the filter's labels too.
      const kept = items(a).filter((i) => {
        const f = fieldOf(i, k);
        return f !== null && same(plain(f), want);
      });
      return list(
        kept.map((i) => ({ ...i, derived: true })),
        join(a.label, b.label, c.label, ...items(a).map((i) => deepLabel(fieldOf(i, k) ?? i))),
        true,
      );
    }
    case "obj": {
      // obj(key1, value1, key2, value2...): the values keep their own labels (each field is
      // written with its label); the record itself is the planner's.
      if (args.length % 2) throw new FnError("wrong-arguments");
      const fields: Record<string, Val> = {};
      for (let i = 0; i < args.length; i += 2) {
        const given = key(args[i] as Val);
        const k = /^[a-z_$][a-z0-9_]{0,40}$/.test(given) ? given : asKey(given);
        if (!/^[a-z_$][a-z0-9_]{0,40}$/.test(k) || Object.hasOwn(fields, k))
          throw new FnError("bad-key");
        fields[k] = args[i + 1] as Val;
      }
      return rec(
        fields,
        join(...(args.filter((_, i) => i % 2 === 0).map(deepLabel) as [Label, ...Label[]])),
        true,
      );
    }
    case "concat":
      return out(args.map(text).join(""));
    case "length":
      return out(a.t === "list" ? a.items.length : [...text(a)].length);
    case "eq":
      return out(same(plain(a), plain(b)));
    case "ne":
      return out(!same(plain(a), plain(b)));
    case "gt":
      return out(num(a) > num(b));
    case "lt":
      return out(num(a) < num(b));
    case "and":
      return out(args.every(truthy));
    case "or":
      return out(args.some(truthy));
    case "not":
      return out(!truthy(a));
    case "today":
      return out(today);
    case "add_days": {
      const m = DAY.exec(text(a));
      if (!m) throw new FnError("not-a-date");
      const n = num(b);
      if (!Number.isInteger(n) || Math.abs(n) > 3660) throw new FnError("bad-days");
      const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + n * 86_400_000;
      return out(new Date(t).toISOString().slice(0, 10));
    }
    default:
      throw new FnError("unknown-function");
  }
}
