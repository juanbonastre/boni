import type { LookupAddress } from "node:dns";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { credentialParam, fetchText } from "./fetch.ts";

/**
 * Two local servers stand in for the internet and the inside: "public" on 127.0.0.1 and "internal"
 * on 127.0.0.2 (both loopback on Linux). The tests block 127.0.0.2 only, and a fake resolver says
 * where invented names point, so nothing leaves this machine. What each test checks in the end is
 * that the internal server never got a request.
 */
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function serve(host: string, handler: Parameters<typeof createServer>[1]) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.headers.host} ${req.url}`);
    handler?.(req, res);
  });
  await new Promise<void>((r) => server.listen(0, host, () => r()));
  servers.push(server);
  return { hits, port: (server.address() as AddressInfo).port };
}

const ok = (_req: unknown, res: import("node:http").ServerResponse) => res.end("BEGIN:VCALENDAR");
const internalOnly = (ip: string) => ip === "127.0.0.2";
const names =
  (table: Record<string, string | string[]>, calls: string[] = []) =>
  async (host: string): Promise<LookupAddress[]> => {
    calls.push(host);
    const v = table[host];
    if (!v) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return (Array.isArray(v) ? v : [v]).map((address) => ({ address, family: 4 }));
  };

describe("fetchText", () => {
  it("refuses private addresses, written or behind a name, without touching them", async () => {
    const inside = await serve("127.0.0.1", ok);
    await expect(fetchText(`http://127.0.0.1:${inside.port}/x.ics`)).rejects.toThrow("not public");
    await expect(fetchText(`http://localhost:${inside.port}/x.ics`)).rejects.toThrow("not public");
    await expect(fetchText(`http://[::1]:${inside.port}/x.ics`)).rejects.toThrow("not public");
    const resolve = names({ "feed.test": "127.0.0.1" });
    await expect(fetchText(`http://feed.test:${inside.port}/x.ics`, { resolve })).rejects.toThrow(
      "not public",
    );
    expect(inside.hits).toEqual([]);
  });

  it("connects to the very address it checked: one lookup, and its answer is used", async () => {
    const pub = await serve("127.0.0.1", ok);
    const calls: string[] = [];
    const resolve = names({ "feed.test": "127.0.0.1" }, calls);
    const r = await fetchText(`http://feed.test:${pub.port}/a.ics`, {
      resolve,
      isBlocked: internalOnly,
    });
    expect(r.text).toBe("BEGIN:VCALENDAR");
    expect(calls).toEqual(["feed.test"]); // no separate check before connecting
    expect(pub.hits).toEqual([`feed.test:${pub.port} /a.ics`]);
  });

  it("DNS rebinding gets nowhere: a name that turns internal is refused at connect time", async () => {
    // The name answers "public" first and "internal" afterwards, as a rebinding attacker's DNS does.
    const pub = await serve("127.0.0.1", ok);
    const internal = await serve("127.0.0.2", ok);
    let n = 0;
    const answers = ["127.0.0.1", "127.0.0.2"];
    const resolve = async (): Promise<LookupAddress[]> => [
      { address: answers[n++ % 2] as string, family: 4 },
    ];
    const opts = { resolve, isBlocked: internalOnly };
    expect((await fetchText(`http://evil.test:${pub.port}/`, opts)).text).toBe("BEGIN:VCALENDAR");
    await expect(fetchText(`http://evil.test:${internal.port}/`, opts)).rejects.toThrow(
      "not public",
    );
    expect(internal.hits).toEqual([]);
  });

  it("refuses a name with any internal address among its answers", async () => {
    const internal = await serve("127.0.0.2", ok);
    const resolve = names({ "mixed.test": ["127.0.0.1", "127.0.0.2"] });
    await expect(
      fetchText(`http://mixed.test:${internal.port}/`, { resolve, isBlocked: internalOnly }),
    ).rejects.toThrow("not public");
    expect(internal.hits).toEqual([]);
  });

  it("checks every redirect again", async () => {
    const internal = await serve("127.0.0.2", ok);
    const pub = await serve("127.0.0.1", (req, res) => {
      const to: Record<string, string> = {
        "/to-internal": `http://inside.test:${internal.port}/secret`,
        "/to-ip": `http://127.0.0.2:${internal.port}/secret`,
        "/to-file": "file:///etc/passwd",
        "/to-public": "/final.ics",
        "/loop": "/loop",
      };
      const target = to[req.url ?? ""];
      if (target) {
        res.writeHead(302, { location: target });
        return void res.end();
      }
      res.end("BEGIN:VCALENDAR");
    });
    const resolve = names({ "feed.test": "127.0.0.1", "inside.test": "127.0.0.2" });
    const opts = { resolve, isBlocked: internalOnly };
    const base = `http://feed.test:${pub.port}`;
    expect((await fetchText(`${base}/to-public`, opts)).url).toBe(`${base}/final.ics`);
    await expect(fetchText(`${base}/to-internal`, opts)).rejects.toThrow("not public");
    await expect(fetchText(`${base}/to-ip`, opts)).rejects.toThrow("not public");
    await expect(fetchText(`${base}/to-file`, opts)).rejects.toThrow("http(s)");
    await expect(fetchText(`${base}/loop`, opts)).rejects.toThrow("Too many redirects");
    expect(internal.hits).toEqual([]);
  });

  it("limits size and time, and says HTTP errors", async () => {
    const pub = await serve("127.0.0.1", (req, res) => {
      if (req.url === "/big") return void res.end("x".repeat(5000));
      if (req.url === "/slow") return; // never answers
      res.writeHead(404);
      res.end();
    });
    const opts = { resolve: names({ "feed.test": "127.0.0.1" }), isBlocked: internalOnly };
    const base = `http://feed.test:${pub.port}`;
    await expect(fetchText(`${base}/big`, { ...opts, maxBytes: 1000 })).rejects.toThrow(
      "too large",
    );
    await expect(fetchText(`${base}/slow`, { ...opts, timeoutMs: 300 })).rejects.toThrow(
      "too long",
    );
    await expect(fetchText(`${base}/missing`, opts)).rejects.toThrow("HTTP 404");
  });

  it("can refuse addresses that carry a credential in their query", async () => {
    expect(credentialParam("https://x.example/a?token=abc")).toBe("token");
    expect(credentialParam("https://x.example/a?X-Amz-Signature=abc")).toBe("X-Amz-Signature");
    expect(credentialParam("https://x.example/a?key=abc&code=1&token=")).toBeNull();
    expect(
      credentialParam("https://calendar.google.com/calendar/ical/x/private-abc/basic.ics"),
    ).toBeNull();
    await expect(
      fetchText("https://x.example/a?api_key=abc", { refuseCredentialParams: true }),
    ).rejects.toThrow("credential");
  });
});
