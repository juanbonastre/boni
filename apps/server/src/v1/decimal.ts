/**
 * Exact decimals for money, as Python's Decimal in the first Boni (expenses/note.py, capture.py): a value
 * is n / 10^scale with a bigint n, and rounding to cents is half up. No floats anywhere near amounts.
 */
export interface Dec {
  n: bigint;
  scale: number;
}

/** Python's Decimal(str(v).strip().replace(",", ".")), or null when it is not a number. */
export function parseDec(v: unknown): Dec | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const s = String(v).trim().replace(",", ".");
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? "";
  let scale = frac.length - Number(m[4] ?? 0);
  let n = BigInt(`${m[1] === "-" ? "-" : ""}${m[2] || "0"}${frac}`);
  if (scale < 0) {
    n *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { n, scale };
}

const pow = (k: number) => 10n ** BigInt(k);
const align = (a: Dec, b: Dec): [bigint, bigint] => {
  const s = Math.max(a.scale, b.scale);
  return [a.n * pow(s - a.scale), b.n * pow(s - b.scale)];
};
export const cmp = (a: Dec, b: Dec) => {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const dec = (s: string) => parseDec(s) as Dec;
export const abs = (a: Dec): Dec => ({ n: a.n < 0n ? -a.n : a.n, scale: a.scale });
export const neg = (a: Dec): Dec => ({ n: -a.n, scale: a.scale });

/** num / den rounded half up (away from zero on .5) to whole units. */
function divHalfUp(num: bigint, den: bigint): bigint {
  const negative = num < 0n !== den < 0n;
  const [a, b] = [num < 0n ? -num : num, den < 0n ? -den : den];
  let q = a / b;
  if ((a % b) * 2n >= b) q += 1n;
  return negative ? -q : q;
}

/** Rounded to cents, half up (Python: x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)). */
export function cents(a: Dec): Dec {
  return { n: divHalfUp(a.n * 100n, pow(a.scale)), scale: 2 };
}

/** "94.10" (str() of a quantized Decimal). */
export function money(a: Dec): string {
  const c = cents(a);
  const sign = c.n < 0n ? "-" : "";
  const v = c.n < 0n ? -c.n : c.n;
  return `${sign}${v / 100n}.${String(v % 100n).padStart(2, "0")}`;
}

/** amount * (1 + invited) / (people + 1), to cents half up (gastos-app's suggested share). */
export function share(amount: Dec, people: number, invited: number): Dec {
  const a = abs(amount);
  return {
    n: divHalfUp(a.n * BigInt(1 + invited) * 100n, pow(a.scale) * BigInt(people + 1)),
    scale: 2,
  };
}
