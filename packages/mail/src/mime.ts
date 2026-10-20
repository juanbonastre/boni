import { htmlToText } from "./html.ts";

/**
 * A mail (RFC 5322 + MIME) as what Boni keeps of it: who, when, the subject, the body as plain text and the
 * attachments' names. Never HTML, never the attachments themselves. Text parts are preferred to HTML ones
 * (an HTML-only body becomes text, its hidden elements dropped and counted). Any charset Node's TextDecoder
 * knows; anything malformed degrades to text instead of failing.
 */
export interface Address {
  name: string;
  address: string;
}
export interface Attachment {
  name: string;
  type: string;
  size: number;
}
export interface Message {
  messageId: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  /** ISO 8601, or null when the header is missing or unreadable. */
  date: string | null;
  subject: string;
  text: string;
  format: "text" | "html" | "none";
  /** Elements of an HTML body hidden with CSS or `hidden`, left out of `text`. */
  hidden: number;
  attachments: Attachment[];
  /** The body was cut (the fetch was partial or the text too long). */
  truncated: boolean;
}

const MAX_TEXT = 50_000;
const latin1 = new TextDecoder("latin1");

function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  const cs = (charset ?? "utf-8").trim().toLowerCase();
  try {
    return new TextDecoder(cs === "utf8" ? "utf-8" : cs).decode(bytes);
  } catch {
    // An unknown label: UTF-8 if it is valid, else Latin-1 (never fails).
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return latin1.decode(bytes);
    }
  }
}

const bin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function fromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/[^A-Za-z0-9+/=]/g, ""), "base64"));
}

function fromQuotedPrintable(s: string, header = false): Uint8Array {
  const t = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 0x3d && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(Number.parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c & 0xff);
  }
  return Uint8Array.from(out);
}

/** RFC 2047: "=?utf-8?B?...?=" words, the whitespace between two of them dropped. */
export function decodeWords(s: string): string {
  return s
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]+\?[BbQq]\?[^?]*\?=)/g, "$1")
    .replace(
      /=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g,
      (_m, cs: string, enc: string, data: string) =>
        decodeCharset(
          enc.toUpperCase() === "B" ? fromBase64(data) : fromQuotedPrintable(data, true),
          cs,
        ),
    );
}

/** A header in raw 8-bit UTF-8 (not encoded words, but servers send it): read as UTF-8 when it is. */
function utf8IfValid(s: string): string {
  if (!/[\x80-\xff]/.test(s)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bin(s));
  } catch {
    return s;
  }
}

interface Part {
  headers: Map<string, string>;
  body: string; // bytes as a binary string (one char per byte)
}

function splitHead(raw: string): Part {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : "";
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!headers.has(k)) headers.set(k, utf8IfValid(line.slice(i + 1).trim()));
  }
  return { headers, body };
}

/** "text/plain; charset=utf-8; name=..." -> value and parameters (RFC 2231 `name*=` read as UTF-8). */
function params(v: string | undefined): { value: string; p: Record<string, string> } {
  const [first, ...rest] = (v ?? "").split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const p: Record<string, string> = {};
  for (const r of rest) {
    const i = r.indexOf("=");
    if (i < 0) continue;
    let k = r.slice(0, i).trim().toLowerCase();
    let val = r
      .slice(i + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (k.endsWith("*")) {
      k = k.replace(/\*\d*\*?$/, "");
      const m = /^([^']*)'[^']*'(.*)$/.exec(val);
      try {
        val = m ? decodeURIComponent(m[2] as string) : decodeURIComponent(val);
      } catch {
        // left as it is
      }
      p[k] = (p[k] ?? "") + val;
    } else p[k.replace(/\*\d+$/, "")] = (p[k] ?? "") + val;
  }
  return { value: (first ?? "").trim().toLowerCase(), p };
}

function decodeBody(part: Part): Uint8Array {
  const enc = (part.headers.get("content-transfer-encoding") ?? "").trim().toLowerCase();
  if (enc === "base64") return fromBase64(part.body);
  if (enc === "quoted-printable") return fromQuotedPrintable(part.body);
  return bin(part.body);
}

/** "Ana <ana@example.com>, \"Ruiz, Luis\" <luis@example.com>" -> addresses. */
export function parseAddresses(v: string | undefined): Address[] {
  if (!v) return [];
  const out: Address[] = [];
  for (const one of decodeWords(v).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const s = one.trim();
    if (!s) continue;
    const m = /^(.*?)\s*<([^<>]+)>\s*$/.exec(s);
    const address = (m ? (m[2] as string) : s).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(address)) continue;
    out.push({ name: (m ? (m[1] as string) : "").replace(/^"|"$/g, "").trim(), address });
  }
  return out.slice(0, 100);
}

interface Walk {
  texts: { type: string; text: string }[];
  attachments: Attachment[];
}

function walk(part: Part, w: Walk, depth: number): void {
  const ct = params(part.headers.get("content-type") ?? "text/plain");
  const disp = params(part.headers.get("content-disposition"));
  const filename = disp.p.filename ?? ct.p.name;
  if (ct.value.startsWith("multipart/") && ct.p.boundary && depth < 20) {
    const b = `--${ct.p.boundary}`;
    const chunks = part.body.split(
      new RegExp(`(?:^|\\r?\\n)${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    const inner = chunks.slice(1).filter((c) => !c.startsWith("--"));
    const parts = inner.map((c) => splitHead(c.replace(/^[ \t]*\r?\n/, "")));
    if (ct.value === "multipart/alternative") {
      // One of the alternatives: plain text if there is one, else the last (the richest).
      const plain = parts.find((p) => params(p.headers.get("content-type")).value === "text/plain");
      const chosen = plain ?? parts[parts.length - 1];
      if (chosen) walk(chosen, w, depth + 1);
      return;
    }
    for (const p of parts) walk(p, w, depth + 1);
    return;
  }
  const isText = ct.value === "text/plain" || ct.value === "text/html" || ct.value === "";
  if (isText && disp.value !== "attachment" && !filename) {
    w.texts.push({
      type: ct.value || "text/plain",
      text: decodeCharset(decodeBody(part), ct.p.charset),
    });
    return;
  }
  w.attachments.push({
    name: decodeWords(filename ?? "").slice(0, 200) || "(sin nombre)",
    type: ct.value || "application/octet-stream",
    size: decodeBody(part).length,
  });
}

/** `raw`: the message's bytes; `partial`: it was fetched only up to a limit. */
export function parseMessage(raw: Uint8Array, partial = false): Message {
  const top = splitHead(latin1.decode(raw));
  const h = (k: string) => top.headers.get(k);
  const w: Walk = { texts: [], attachments: [] };
  walk(top, w, 0);
  const plain = w.texts.filter((t) => t.type === "text/plain");
  const html = w.texts.filter((t) => t.type === "text/html");
  let text = "";
  let format: Message["format"] = "none";
  let hidden = 0;
  if (plain.length) {
    text = plain.map((t) => t.text).join("\n\n");
    format = "text";
  } else if (html.length) {
    const parts = html.map((t) => htmlToText(t.text));
    text = parts.map((p) => p.text).join("\n\n");
    hidden = parts.reduce((n, p) => n + p.hidden, 0);
    format = "html";
  }
  text = text.replace(/\r\n?/g, "\n").trim();
  const cut = text.length > MAX_TEXT;
  const parsedDate = Date.parse((h("date") ?? "").replace(/\s*\([^)]*\)\s*$/, ""));
  return {
    messageId: (h("message-id") ?? "").replace(/^<|>$/g, "").slice(0, 300),
    from: parseAddresses(h("from")),
    to: parseAddresses(h("to")),
    cc: parseAddresses(h("cc")),
    date: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
    subject: decodeWords(h("subject") ?? "").slice(0, 500),
    text: cut ? text.slice(0, MAX_TEXT) : text,
    format,
    hidden,
    attachments: w.attachments.slice(0, 50),
    truncated: partial || cut,
  };
}
