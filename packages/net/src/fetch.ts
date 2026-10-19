import { promises as dns, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isBlockedAddress } from "./address.ts";

/**
 * Downloads a text resource for Boni (an iCal feed today, the agent's web reads later) without
 * becoming a way into the NAS, the home network or the tailnet.
 *
 * The address is checked **when connecting**: Node resolves the name through the `lookup` we give it
 * and connects to the very address that lookup accepted, so a name cannot pass a check and then
 * resolve somewhere else (DNS rebinding). A name with any non-public address is refused, every
 * redirect is checked again, and size and time are limited. No connection is reused between requests.
 */

export interface SafeFetchOptions {
  /** Most bytes read from the body (default 10 MB). */
  maxBytes?: number;
  /** For the whole download, redirects included (default 20 s). */
  timeoutMs?: number;
  /** Redirects followed (default 4). */
  maxRedirects?: number;
  /** Refuse addresses whose query carries a credential (`token=`, `signature=`…). Off for addresses the user typed. */
  refuseCredentialParams?: boolean;
  /** Tests only: private addresses are allowed. */
  allowPrivate?: boolean;
  /** Tests only: which addresses are refused (default `isBlockedAddress`). */
  isBlocked?: (ip: string) => boolean;
  /** Tests only: how names are resolved (default the system's). */
  resolve?: (host: string) => Promise<LookupAddress[]>;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  text: string;
  /** The address it ended at, after redirects. */
  url: string;
  status: number;
}

/** Why a download was refused: `code` is stable, `message` is what the server already said before. */
export class NetSafetyError extends Error {
  code: "not-public" | "scheme" | "credentials" | "too-large" | "redirects" | "http" | "timeout";
  constructor(code: NetSafetyError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const notPublic = () => new NetSafetyError("not-public", "That address is not public");

// Credential-bearing query names (the narrow list of Hermes' url_safety.py: words such as "key" or
// "code" are left out on purpose, ordinary pages use them).
const CREDENTIAL_PARAMS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth_token",
  "authorization",
  "awsaccesskeyid",
  "client_secret",
  "credential",
  "credentials",
  "jwt",
  "password",
  "passwd",
  "secret",
  "session_id",
  "signature",
  "token",
  "x-amz-security-token",
  "x-amz-signature",
  "x_amz_security_token",
  "x_amz_signature",
]);

/** The first query parameter of `address` that carries a credential (with a value), if any. */
export function credentialParam(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  for (const [name, value] of url.searchParams)
    if (value && CREDENTIAL_PARAMS.has(name.toLowerCase())) return name;
  return null;
}

/** A `lookup` for `net.connect` that only ever hands back addresses that passed `blocked`. */
export function safeLookup(
  resolve: (host: string) => Promise<LookupAddress[]>,
  blocked: (ip: string) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((a) => blocked(a.address)))
          return callback(notPublic(), "", 0);
        if (options.all)
          return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses);
        const [first] = addresses as [LookupAddress];
        callback(null, first.address, first.family);
      },
      (e: NodeJS.ErrnoException) => callback(e, "", 0),
    );
  };
}

const systemResolve = (host: string) => dns.lookup(host, { all: true, verbatim: true });

function getOnce(
  url: URL,
  opts: SafeFetchOptions,
  lookup: LookupFunction,
  signal: AbortSignal,
): Promise<{ status: number; location: string | null; text: string }> {
  const client = url.protocol === "https:" ? https : http;
  const maxBytes = opts.maxBytes ?? 10_000_000;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup,
        signal,
        headers: { "accept-encoding": "identity", "user-agent": "Boni", ...opts.headers },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = status >= 300 && status < 400 ? (res.headers.location ?? null) : null;
        if (location !== null || status < 200 || status >= 300) {
          res.resume();
          return resolve({ status, location, text: "" });
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            // Settle first: once cut, the response may still end as if nothing happened.
            reject(new NetSafetyError("too-large", "The response is too large"));
            res.destroy();
            return;
          }
          parts.push(chunk);
        });
        res.on("end", () =>
          resolve({ status, location: null, text: Buffer.concat(parts).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", (e) => {
      if (signal.aborted) reject(new NetSafetyError("timeout", "The download took too long"));
      else reject(e);
    });
    req.end();
  });
}

/** Downloads `address` as text, public addresses only (see above). */
export async function fetchText(
  address: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const blocked = opts.allowPrivate ? () => false : (opts.isBlocked ?? isBlockedAddress);
  const lookup = safeLookup(opts.resolve ?? systemResolve, blocked);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  let url = new URL(address);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new NetSafetyError("scheme", "Only http(s) addresses");
    if (opts.refuseCredentialParams && credentialParam(url.href))
      throw new NetSafetyError("credentials", "The address carries a credential");
    // An IP written in the address never goes through `lookup`: check it here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && blocked(host)) throw notPublic();
    const r = await getOnce(url, opts, lookup, signal);
    if (r.location !== null) {
      url = new URL(r.location, url);
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new NetSafetyError("http", `HTTP ${r.status}`);
    return { text: r.text, url: url.href, status: r.status };
  }
  throw new NetSafetyError("redirects", "Too many redirects");
}
