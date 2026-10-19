/**
 * Python's round(x, n) for floats, so the ported engine gives the very numbers of the first Boni:
 * the nearest value of the exact binary number, and on an exact tie the even digit (round(0.125, 2)
 * is 0.12 in Python, 0.13 with toFixed). Never -0.
 */
export function pyRound(x: number, n: number): number {
  if (!Number.isFinite(x)) return x;
  const exact = Math.abs(x).toFixed(100); // the exact decimal digits of the double
  const [int = "0", frac = ""] = exact.split(".");
  const tail = frac.slice(n);
  let out: number;
  if (tail[0] === "5" && /^0*$/.test(tail.slice(1))) {
    const last = n > 0 ? Number(frac[n - 1]) : Number(int[int.length - 1]);
    const down = Number(`${int}.${frac.slice(0, n) || "0"}`);
    out = last % 2 === 0 ? down : down + 10 ** -n;
    out = Number(out.toFixed(n));
  } else out = Number(Math.abs(x).toFixed(n));
  out = x < 0 ? -out : out;
  return out === 0 ? 0 : out;
}

/**
 * Python's sum() of floats (CPython 3.12 and later): Neumaier's compensated summation, which the
 * first Boni's server ran on. Plain left-to-right addition differs in the last bits, and that shows
 * after rounding when a total sits on a tie.
 */
export function pySum(values: Iterable<number>): number {
  let sum = 0;
  let c = 0;
  for (const x of values) {
    const t = sum + x;
    if (Math.abs(sum) >= Math.abs(x)) c += sum - t + x;
    else c += x - t + sum;
    sum = t;
  }
  if (c && Number.isFinite(c)) sum += c;
  return sum;
}
