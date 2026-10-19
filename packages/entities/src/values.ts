import type { FieldDef, Money, Value } from "./schema.ts";

/**
 * Checking and normalising a value for its field. The store calls it on every write, whoever writes
 * (Juan, the agent, an import): a value that does not fit is refused, never stored half-right.
 */

export type ValueResult = { ok: true; value: Value } | { ok: false; error: string };

const ok = (value: Value): ValueResult => ({ ok: true, value });
const bad = (error: string): ValueResult => ({ ok: false, error });

const MAX_TEXT = 10_000;
const MAX_LONGTEXT = 1_000_000;

function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return d <= (days[mo - 1] ?? 0);
}

const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function isInstant(s: string): boolean {
  const m =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.exec(
      s,
    );
  return !!m?.[1] && isDate(m[1]);
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

const isMoney = (v: unknown): v is Money =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length === 2 &&
  typeof (v as Money).amount === "number" &&
  Number.isFinite((v as Money).amount) &&
  typeof (v as Money).currency === "string" &&
  /^[A-Z]{3}$/.test((v as Money).currency);

/** `raw` checked (and normalised: trimmed text, sorted unique lists) for `field`. `null` always fits. */
export function checkValue(field: FieldDef, raw: unknown): ValueResult {
  if (raw === null || raw === undefined) return ok(null);
  const optionIds = new Set((field.options ?? []).map((o) => o.id));
  switch (field.type) {
    case "text":
    case "longtext": {
      if (typeof raw !== "string") return bad("expected text");
      const max = field.type === "text" ? MAX_TEXT : MAX_LONGTEXT;
      return raw.length <= max
        ? ok(field.type === "text" ? raw.trim() : raw)
        : bad("text too long");
    }
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? ok(raw) : bad("expected a number");
    case "money":
      return isMoney(raw)
        ? ok({ amount: raw.amount, currency: raw.currency })
        : bad("expected { amount, currency }");
    case "select":
      return typeof raw === "string" && optionIds.has(raw)
        ? ok(raw)
        : bad("not one of the options");
    case "multiselect": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string" || !optionIds.has(x)))
        return bad("expected options of the list");
      return ok([...new Set(raw as string[])].sort());
    }
    case "checkbox":
      return typeof raw === "boolean" ? ok(raw) : bad("expected true or false");
    case "date":
      return typeof raw === "string" && isDate(raw) ? ok(raw) : bad("expected YYYY-MM-DD");
    case "time":
      return typeof raw === "string" && isTime(raw) ? ok(raw) : bad("expected HH:MM");
    case "datetime":
      return typeof raw === "string" && isInstant(raw)
        ? ok(raw)
        : bad("expected an ISO instant with Z or an offset");
    case "dates": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string" || !isDate(x)))
        return bad("expected a list of YYYY-MM-DD");
      return ok([...new Set(raw as string[])].sort());
    }
    case "duration":
      return typeof raw === "number" && Number.isInteger(raw) && raw >= 0
        ? ok(raw)
        : bad("expected whole minutes");
    case "url":
      return typeof raw === "string" && isHttpUrl(raw.trim())
        ? ok(raw.trim())
        : bad("expected an http(s) address");
    case "email":
      return typeof raw === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())
        ? ok(raw.trim())
        : bad("expected an e-mail address");
    case "phone":
      return typeof raw === "string" && /^\+?[\d\s().-]{3,30}$/.test(raw.trim())
        ? ok(raw.trim())
        : bad("expected a phone number");
    case "relation": {
      const many = field.relation?.many ?? false;
      const isId = (x: unknown) => typeof x === "string" && x.length > 0 && x.length <= 80;
      if (many) {
        if (!Array.isArray(raw) || !raw.every(isId)) return bad("expected a list of ids");
        return ok([...new Set(raw as string[])]);
      }
      return isId(raw) ? ok(raw as string) : bad("expected an id");
    }
    case "file":
      return typeof raw === "string" && /^[0-9a-f]{64}$/.test(raw)
        ? ok(raw)
        : bad("expected the sha256 of a file");
  }
}

/**
 * `value` of field `from` as a value of field `to` (changing a field's type), or an error when it does
 * not convert: the caller keeps the old value in the log and leaves the field empty.
 */
export function convertValue(from: FieldDef, to: FieldDef, value: Value): ValueResult {
  if (value === null) return ok(null);
  if (from.type === to.type) return checkValue(to, value);
  const optionName = (id: string) => from.options?.find((o) => o.id === id)?.name ?? id;
  const asText = (): string | null => {
    if (typeof value === "string") return from.type === "select" ? optionName(value) : value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value))
      return (from.type === "multiselect" ? value.map(optionName) : value).join(", ");
    return `${value.amount} ${value.currency}`;
  };
  switch (to.type) {
    case "text":
    case "longtext": {
      const t = asText();
      return t === null ? bad("does not convert") : checkValue(to, t);
    }
    case "number": {
      const n =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value.replace(",", "."))
            : Number.NaN;
      if (typeof value === "object" && value !== null && !Array.isArray(value))
        return checkValue(to, value.amount);
      return checkValue(to, n);
    }
    case "checkbox":
      if (typeof value === "string" && /^(true|false|s[ií]|no)$/i.test(value.trim()))
        return ok(/^(true|s[ií])$/i.test(value.trim()));
      return bad("does not convert");
    case "select": {
      const t = asText();
      const match = to.options?.find(
        (o) => o.name.toLowerCase() === t?.toLowerCase() || o.id === t,
      );
      return match ? ok(match.id) : bad("no option with that name");
    }
    default:
      return typeof value === "string" ? checkValue(to, value) : bad("does not convert");
  }
}
