/** Wall clock with an optional fixed instant (`?now=2025-09-17T14:29` in the URL) for tests and screenshots. */
let fixed: number | null = null;
let startedAt = 0;

export function initClock(
  search: string,
  tz: string,
  parse: (iso: string, tz: string) => number | null,
): void {
  const raw = new URLSearchParams(search).get("now");
  if (!raw) return;
  const ms = parse(raw, tz);
  if (ms !== null) {
    fixed = ms;
    startedAt = performance.now();
  }
}

export function nowMs(): number {
  return fixed === null ? Date.now() : fixed + (performance.now() - startedAt);
}
