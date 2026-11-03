import { decodeEntities, htmlToText } from "./html.ts";

/**
 * A mail (RFC 5322 + MIME) as what Boni keeps of it: who, when, the subject, the body as plain text and the
 * attachments (their names always; their bytes when the caller keeps them, `keep`, and they fit: Juan,
 * 2026-11-02, so an attached sheet can be read). Never HTML. Text parts are preferred to HTML ones (an HTML-only
 * body becomes text, its hidden elements dropped and counted). Any charset Node's TextDecoder knows; anything
 * malformed degrades to text instead of failing.
 */
export interface Address {
  name: string;
  address: string;
}
export interface Attachment {
  name: string;
  type: string;
  size: number;
  /** Shown inside the text (an image the HTML refers to by its `cid`), not sent as a file of its own. */
  inline: boolean;
  cid: string | null;
  /** Its bytes, when the caller keeps attachments (`keep`) and it fits; absent otherwise. */
  content?: Uint8Array;
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
  /** The first calendar part with an event (an invitation's .ics text), for the code that reads invitations. */
  calendar: string | null;
  /** The thread's headers (RFC 5322): the message this one answers, and the thread's ids, oldest first. */
  inReplyTo: string | null;
  references: string[];
}

const MAX_TEXT = 50_000;
/** An invitation's calendar part is small; anything bigger is a feed, not an invitation. */
const CALENDAR_MAX = 200_000;
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
  texts: {
    type: string;
    text: string;
  }[];
  attachments: Attachment[];
  /** Bytes of an attachment kept at most (0: names only). */
  keep: number;
  /** The calendar parts' text (text/calendar, .ics), at most a few. */
  calendars: string[];
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

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
      // A calendar invitation travels as one more alternative (Google): read beside the text.
      for (const p of parts)
        if (p !== chosen && params(p.headers.get("content-type")).value === "text/calendar")
          walk(p, w, depth + 1);
      return;
    }
    for (const p of parts) walk(p, w, depth + 1);
    return;
  }
  // An invitation's calendar part (text/calendar, or an .ics file): its text is kept apart for the code that
  // reads invitations (task 45); it stays a file only when it came as one.
  if (
    ct.value === "text/calendar" ||
    ct.value === "application/ics" ||
    /\.ics$/i.test(filename ?? "")
  ) {
    const text = decodeCharset(decodeBody(part), ct.p.charset);
    if (w.calendars.length < 4 && text.length <= CALENDAR_MAX) w.calendars.push(text);
    if (disp.value !== "attachment" && !filename) return;
  }
  const isText = ct.value === "text/plain" || ct.value === "text/html" || ct.value === "";
  if (isText && disp.value !== "attachment" && !filename) {
    w.texts.push({
      type: ct.value || "text/plain",
      text: decodeCharset(decodeBody(part), ct.p.charset),
    });
    return;
  }
  const bytes = decodeBody(part);
  const type = ct.value || "application/octet-stream";
  const cid = (part.headers.get("content-id") ?? "").trim().replace(/^<|>$/g, "") || null;
  // An image the HTML shows by its cid comes with no file name: named by its order and kind.
  const unnamed = `${cid ? "imagen" : "adjunto"}-${w.attachments.length + 1}.${EXT[type] ?? "bin"}`;
  w.attachments.push({
    name: decodeWords(filename ?? "").slice(0, 200) || unnamed,
    type,
    size: bytes.length,
    inline: disp.value === "inline" || (!!cid && !filename),
    cid,
    ...(w.keep > 0 && bytes.length > 0 && bytes.length <= w.keep ? { content: bytes } : {}),
  });
}

/**
 * `raw`: the message's bytes; `partial`: it was fetched only up to a limit; `keep`: how many bytes of an attachment
 * to keep (its `content`), none by default.
 */
export function parseMessage(raw: Uint8Array, partial = false, o: { keep?: number } = {}): Message {
  const top = splitHead(latin1.decode(raw));
  const h = (k: string) => top.headers.get(k);
  const w: Walk = { texts: [], attachments: [], keep: o.keep ?? 0, calendars: [] };
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
  const ids = (v: string | undefined) =>
    (v ?? "")
      .split(/\s+/)
      .map((x) => x.replace(/^<|>$/g, "").slice(0, 300))
      .filter(Boolean);
  return {
    messageId: (h("message-id") ?? "").replace(/^<|>$/g, "").slice(0, 300),
    inReplyTo: ids(h("in-reply-to"))[0] ?? null,
    references: ids(h("references")).slice(0, 20),
    from: parseAddresses(h("from")),
    to: parseAddresses(h("to")),
    cc: parseAddresses(h("cc")),
    date: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
    // Some senders put HTML entities in the subject ("&#8220;Tu investigación&#8221;"): read as the characters.
    subject: decodeEntities(decodeWords(h("subject") ?? "")).slice(0, 500),
    text: cut ? text.slice(0, MAX_TEXT) : text,
    format,
    hidden,
    attachments: w.attachments.slice(0, 50),
    truncated: partial || cut,
    calendar: w.calendars.find((c) => /BEGIN:VEVENT/i.test(c)) ?? null,
  };
}
