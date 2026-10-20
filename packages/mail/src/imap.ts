import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";

/**
 * A read-only IMAP client (RFC 9051 / 3501), as small as Boni needs: log in, open a folder read-only, find
 * messages by UID or date, fetch them without marking them read. Read-only in three ways: the folder is
 * opened with EXAMINE, bodies are fetched with BODY.PEEK, and every command outside an allow-list is refused
 * before it is sent (no STORE, COPY, MOVE, EXPUNGE, APPEND, DELETE...). The credential itself can do more
 * (a Google app password can even send mail): it lives encrypted in Boni and only this code uses it.
 * TLS always (port 993); tests pass `connect` to talk to a fake server without it.
 */
export interface ImapOptions {
  host: string;
  port?: number;
  user: string;
  password: string;
  timeoutMs?: number;
  /** Tests only: the connection (plain TCP to a fake server). */
  connect?: () => Duplex;
}

export class ImapError extends Error {
  /** "auth" (wrong user or password), "network", "timeout", "protocol", "refused" (a command not allowed). */
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** One untagged or tagged response: its line (literals replaced by `{n}`) and the literals in order. */
interface Line {
  text: string;
  literals: Buffer[];
}

const ALLOWED = new Set([
  "CAPABILITY",
  "LOGIN",
  "EXAMINE",
  "UID SEARCH",
  "UID FETCH",
  "NOOP",
  "LOGOUT",
]);
const MAX_LITERAL = 30 * 1024 * 1024;

/** A string as an IMAP quoted string; CR and LF can never be in one (they would end the command). */
export function quote(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new ImapError("refused", "a value with a line break");
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A day as IMAP writes it in SEARCH SINCE ("17-Oct-2026"). */
export const imapDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${d}-${MONTHS[(m as number) - 1]}-${y}`;
};

export class ImapReader {
  private socket: Duplex;
  private buf = Buffer.alloc(0);
  private lines: Line[] = [];
  private waiting: (() => void) | null = null;
  private failed: ImapError | null = null;
  private tag = 0;
  private timeoutMs: number;

  private constructor(socket: Duplex, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    socket.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.parse();
    });
    socket.on("error", (e) => this.fail(new ImapError("network", e.message)));
    socket.on("close", () => this.fail(new ImapError("network", "connection closed")));
  }

  static async open(o: ImapOptions): Promise<ImapReader> {
    const timeoutMs = o.timeoutMs ?? 30_000;
    const socket =
      o.connect?.() ??
      tlsConnect({ host: o.host, port: o.port ?? 993, servername: o.host, minVersion: "TLSv1.2" });
    const r = new ImapReader(socket, timeoutMs);
    const greeting = await r.next();
    if (!/^\* (OK|PREAUTH)\b/i.test(greeting.text))
      throw new ImapError("protocol", "the server did not greet");
    try {
      await r.command("LOGIN", `${quote(o.user)} ${quote(o.password)}`);
    } catch (e) {
      r.close();
      if (e instanceof ImapError && e.code === "protocol")
        throw new ImapError("auth", "the server refused the user or password");
      throw e;
    }
    return r;
  }

  private fail(e: ImapError) {
    if (!this.failed) this.failed = e;
    this.waiting?.();
  }

  /** Splits what arrived into responses, a literal `{n}` at a line's end being the next n bytes. */
  private parse() {
    for (;;) {
      let text = "";
      const literals: Buffer[] = [];
      let at = 0;
      let complete = false;
      for (;;) {
        const eol = this.buf.indexOf("\r\n", at);
        if (eol < 0) break;
        const piece = this.buf.subarray(at, eol).toString("latin1");
        const m = /\{(\d{1,9})\}$/.exec(piece);
        if (!m) {
          text += piece;
          at = eol + 2;
          complete = true;
          break;
        }
        const n = Number(m[1]);
        if (n > MAX_LITERAL) {
          this.fail(new ImapError("protocol", "a literal too large"));
          this.socket.destroy();
          return;
        }
        if (this.buf.length < eol + 2 + n) break;
        text += piece;
        literals.push(Buffer.from(this.buf.subarray(eol + 2, eol + 2 + n)));
        at = eol + 2 + n;
      }
      if (!complete) return;
      this.buf = this.buf.subarray(at);
      this.lines.push({ text, literals });
      this.waiting?.();
    }
  }

  private next(): Promise<Line> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new ImapError("timeout", "the server did not answer"));
        this.socket.destroy();
      }, this.timeoutMs);
      const check = () => {
        const line = this.lines.shift();
        if (line) {
          clearTimeout(timer);
          this.waiting = null;
          resolve(line);
        } else if (this.failed) {
          clearTimeout(timer);
          this.waiting = null;
          reject(this.failed);
        } else this.waiting = check;
      };
      check();
    });
  }

  /** One command; its untagged responses, or ImapError("protocol") when it ends in NO or BAD. */
  private async command(name: string, args = ""): Promise<Line[]> {
    if (!ALLOWED.has(name)) throw new ImapError("refused", `IMAP command not allowed: ${name}`);
    if (name === "UID FETCH" && /\bBODY\[/i.test(args))
      throw new ImapError("refused", "bodies are fetched with BODY.PEEK only");
    const tag = `B${++this.tag}`;
    this.socket.write(`${tag} ${name}${args ? ` ${args}` : ""}\r\n`);
    const untagged: Line[] = [];
    for (;;) {
      const line = await this.next();
      if (line.text.startsWith(`${tag} `)) {
        if (!/^\S+ OK\b/i.test(line.text))
          throw new ImapError("protocol", line.text.slice(tag.length + 1, 200));
        return untagged;
      }
      untagged.push(line);
    }
  }

  /** Opens a folder read-only: its UIDVALIDITY (UIDs mean nothing across a change of it) and size. */
  async examine(
    folder = "INBOX",
  ): Promise<{ uidValidity: number; uidNext: number; exists: number }> {
    const lines = await this.command("EXAMINE", quote(folder));
    const num = (re: RegExp) => {
      for (const l of lines) {
        const m = re.exec(l.text);
        if (m) return Number(m[1]);
      }
      return 0;
    };
    return {
      uidValidity: num(/\[UIDVALIDITY (\d+)\]/i),
      uidNext: num(/\[UIDNEXT (\d+)\]/i),
      exists: num(/^\* (\d+) EXISTS/i),
    };
  }

  /** UIDs of the messages after `afterUid`, or received since `day` (YYYY-MM-DD), ascending. */
  async search(q: { afterUid: number } | { since: string }): Promise<number[]> {
    const criteria =
      "afterUid" in q
        ? `UID ${Math.max(1, Math.floor(q.afterUid) + 1)}:*`
        : /^\d{4}-\d{2}-\d{2}$/.test(q.since)
          ? `SINCE ${imapDate(q.since)}`
          : null;
    if (!criteria) throw new ImapError("refused", "bad search");
    const lines = await this.command("UID SEARCH", criteria);
    const uids = lines
      .filter((l) => /^\* SEARCH\b/i.test(l.text))
      .flatMap((l) =>
        l.text
          .replace(/^\* SEARCH/i, "")
          .trim()
          .split(/\s+/),
      )
      .filter((x) => /^\d+$/.test(x))
      .map(Number);
    // "UID n:*" always matches the last message, even below n.
    const after = "afterUid" in q ? q.afterUid : 0;
    return [...new Set(uids)].filter((u) => u > after).sort((a, b) => a - b);
  }

  /** One message's first `maxBytes` bytes (never marked read), its size and its arrival time. */
  async fetch(
    uid: number,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<{ raw: Buffer; size: number; internalDate: string | null } | null> {
    if (!Number.isInteger(uid) || uid <= 0) throw new ImapError("refused", "bad uid");
    const lines = await this.command(
      "UID FETCH",
      `${uid} (UID RFC822.SIZE INTERNALDATE BODY.PEEK[]<0.${Math.floor(maxBytes)}>)`,
    );
    const line = lines.find(
      (l) => /^\* \d+ FETCH/i.test(l.text) && new RegExp(`\\bUID ${uid}\\b`).test(l.text),
    );
    if (!line || !line.literals.length) return null;
    const size = Number(/RFC822\.SIZE (\d+)/i.exec(line.text)?.[1] ?? 0);
    const date = /INTERNALDATE "([^"]+)"/i.exec(line.text)?.[1];
    const parsed = date ? Date.parse(date.replace(/^(\d+)-(\w+)-(\d+)/, "$1 $2 $3")) : Number.NaN;
    return {
      raw: line.literals[line.literals.length - 1] as Buffer,
      size,
      internalDate: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    };
  }

  close(): void {
    if (!this.failed && this.socket.writable) {
      this.socket.write(`B${++this.tag} LOGOUT\r\n`);
      this.socket.end();
    }
    this.failed ??= new ImapError("network", "closed");
  }

  /** Tests: a command as an attacker-controlled caller would try it. */
  _try(name: string, args = ""): Promise<Line[]> {
    return this.command(name, args);
  }
}
