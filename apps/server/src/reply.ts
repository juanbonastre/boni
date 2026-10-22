import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The desktop and Android apps are not served from here (another origin), so the API allows any
 * origin. That is safe because access is by a bearer token the app holds, never by cookies a browser
 * would send on its own.
 */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-max-age": "600",
};

/** On every answer: no guessing of types, no referrer, HTTPS from now on (Funnel and serve are HTTPS). */
export const SAFE = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000",
};

export function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    ...SAFE,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * An attachment's bytes: always a download (never shown by a browser on this origin, where an SVG or an
 * HTML file could run script), in a sandbox if it is shown anyway.
 */
export function sendFile(res: ServerResponse, mime: string, data: Uint8Array): void {
  res.writeHead(200, {
    ...CORS,
    ...SAFE,
    "content-type": mime,
    "content-disposition": "attachment",
    "content-security-policy": "sandbox; default-src 'none'",
    "cache-control": "private, no-store",
    "content-length": data.byteLength,
  });
  res.end(data);
}

export async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 8_000_000) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

export const tokenOf = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
};
