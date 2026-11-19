/**
 * What a mail's Authentication-Results headers say (RFC 8601), and whether its sender is authenticated by them.
 *
 * Only the receiving provider's own header counts, recognised by its authserv-id: a provider removes headers bearing
 * its own id that arrive from outside (RFC 8601 §5), so one with that id is the provider's, and one with any other id
 * was brought by the mail and is never trusted. Of the provider's, only the topmost (the last one it added) is read.
 * The sender is authenticated when that header says `dmarc=pass` with `header.from` equal to the From address's
 * domain, or `dkim=pass` with `header.d` equal to it. No trusted id, no such header, anything else: not authenticated.
 * Everything here came with the mail, from outside; the code reads it, never a model.
 */

/** One result of one header: the method, its result, and the two properties that name a domain. */
export interface AuthResult {
  method: string;
  result: string;
  /** `header.from` (DMARC), lower-case. */
  from?: string;
  /** `header.d` (DKIM), lower-case. */
  d?: string;
}
/** One Authentication-Results header: who wrote it (its authserv-id, lower-case) and its results. */
export interface AuthResults {
  authserv: string;
  results: AuthResult[];
}

/** At most this many headers and results are kept of one mail: a mail could bring any number. */
const MAX_HEADERS = 20;
const MAX_RESULTS = 20;

/** Drops RFC 5322 comments ("(…)", nested), outside quoted strings. */
function uncomment(s: string): string {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (quoted) {
      out += c;
      if (c === "\\" && i + 1 < s.length) out += s[++i];
      else if (c === '"') quoted = false;
    } else if (depth > 0) {
      if (c === "\\") i++;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    } else if (c === "(") {
      depth = 1;
      out += " ";
    } else {
      if (c === '"') quoted = true;
      out += c;
    }
  }
  return out;
}

/** Splits on `;` outside quoted strings. */
function split(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (quoted && c === "\\") {
      cur += c + (s[++i] ?? "");
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === ";" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

const unquote = (v: string) => (v.startsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v);

/** One header's value as written: null when it has no authserv-id. */
export function parseAuthResults(value: string): AuthResults | null {
  const [head = "", ...rest] = split(uncomment(value));
  const authserv = (head.trim().split(/\s+/)[0] ?? "").toLowerCase();
  if (!/^[a-z0-9._-]{1,253}$/.test(authserv)) return null;
  const results: AuthResult[] = [];
  for (const part of rest) {
    const pairs = [...part.matchAll(/([a-z0-9_./-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s;"]+)/gi)];
    const [first, ...props] = pairs;
    if (!first || results.length >= MAX_RESULTS) continue;
    const method = (first[1] as string).toLowerCase().replace(/\/.*$/, "");
    if (method === "reason") continue;
    const r: AuthResult = { method, result: unquote(first[2] as string).toLowerCase() };
    for (const p of props) {
      const k = (p[1] as string).toLowerCase();
      const v = unquote(p[2] as string).toLowerCase();
      if (k === "header.from" && r.from === undefined) r.from = v;
      else if (k === "header.d" && r.d === undefined) r.d = v;
    }
    results.push(r);
  }
  return { authserv, results };
}

/** A mail's headers, in the order they come (topmost first), as the connector keeps them. */
export function authResultsOf(values: readonly string[]): AuthResults[] {
  return values
    .slice(0, MAX_HEADERS)
    .map(parseAuthResults)
    .filter((r): r is AuthResults => r !== null);
}

/**
 * Whether the mail from `from` (its From address) is authenticated by the provider whose authserv-id is `trustedId`:
 * its topmost header with that id says `dmarc=pass` for the From domain, or `dkim=pass` with that domain as `d`.
 */
export function authenticated(
  headers: readonly AuthResults[],
  from: string,
  trustedId: string | null | undefined,
): boolean {
  const id = (trustedId ?? "").trim().toLowerCase();
  const at = from.lastIndexOf("@");
  const domain = at > 0 ? from.slice(at + 1).toLowerCase() : "";
  if (!id || !domain) return false;
  const own = headers.find((h) => h.authserv === id);
  if (!own) return false;
  return own.results.some(
    (r) =>
      r.result === "pass" &&
      ((r.method === "dmarc" && r.from === domain) || (r.method === "dkim" && r.d === domain)),
  );
}
