import { BlockList, isIP } from "node:net";

/**
 * Which IP addresses Boni never connects to on someone's behalf: everything that is not the public
 * internet. That covers loopback, private ranges, the tailnet (100.64/10 and Tailscale's IPv6 ULA),
 * link-local (cloud metadata lives there) and reserved or documentation ranges. An IPv4 address hidden
 * inside an IPv6 one (mapped, translated, compatible, NAT64, 6to4) is judged as the IPv4 it carries.
 * Anything that does not parse is blocked: the check fails closed.
 */

const V4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT: the tailnet
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relays
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const)
  V4.addSubnet(net, bits, "ipv4");

const V6 = new BlockList();
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo (carries an obfuscated IPv4)
  ["2001:db8::", 32], // documentation
  ["64:ff9b:1::", 48], // local NAT64
  ["fc00::", 7], // unique local (Tailscale's fd7a:115c:a1e0::/48 is here)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // old site-local
  ["ff00::", 8], // multicast
] as const)
  V6.addSubnet(net, bits, "ipv6");

/** The 16 bytes of an IPv6 address ("::ffff:1.2.3.4" and "fe80::1%eth0" included), or null. */
export function ipv6Bytes(input: string): number[] | null {
  const s = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (isIP(s) !== 6) return null;
  // A trailing dotted IPv4 stands for the last two words: parse it apart and put zeros in its place.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)?.[1];
  const tail = dotted ? dotted.split(".").map(Number) : null;
  const text = dotted ? `${s.slice(0, -dotted.length)}0:0` : s;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parts = (p: string | undefined) => (p ? p.split(":") : []);
  const head = parts(halves[0]);
  const rest = halves.length === 2 ? parts(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const words = [...head, ...new Array<string>(fill).fill("0"), ...rest].map((h) =>
    Number.parseInt(h, 16),
  );
  if (words.length !== 8 || words.some((w) => !(w >= 0 && w <= 0xffff))) return null;
  const bytes = words.flatMap((w) => [w >> 8, w & 0xff]);
  if (tail) bytes.splice(12, 4, ...tail);
  return bytes;
}

const v4At = (b: number[], i: number) => b.slice(i, i + 4).join(".");
const startsWith = (b: number[], prefix: number[]) => prefix.every((x, i) => b[i] === x);

/** The IPv4 address an IPv6 one carries (mapped, translated, compatible, NAT64, 6to4), if any. */
export function embeddedIpv4(bytes: number[]): string | null {
  const zeros = (n: number) => new Array<number>(n).fill(0);
  if (startsWith(bytes, [...zeros(10), 0xff, 0xff])) return v4At(bytes, 12); // ::ffff:a.b.c.d
  if (startsWith(bytes, [...zeros(8), 0xff, 0xff, 0, 0])) return v4At(bytes, 12); // ::ffff:0:a.b.c.d
  if (startsWith(bytes, [0, 0x64, 0xff, 0x9b, ...zeros(8)])) return v4At(bytes, 12); // 64:ff9b::/96
  if (startsWith(bytes, [0x20, 0x02])) return v4At(bytes, 2); // 2002:AABB:CCDD::/48 (6to4)
  if (startsWith(bytes, zeros(12)) && bytes.slice(12).some((x) => x !== 0)) {
    // ::a.b.c.d (deprecated "compatible"); ::1 and :: are handled as IPv6 below.
    const v4 = v4At(bytes, 12);
    return v4 === "0.0.0.1" ? null : v4;
  }
  return null;
}

/** True for every address Boni must not connect to (see above); also for anything that is not an IP. */
export function isBlockedAddress(input: string): boolean {
  const ip = input.trim().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) return V4.check(ip, "ipv4");
  const bytes = ipv6Bytes(ip);
  if (!bytes) return true;
  const inner = embeddedIpv4(bytes);
  if (inner !== null && V4.check(inner, "ipv4")) return true;
  const words: string[] = [];
  for (let i = 0; i < 16; i += 2)
    words.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  return V6.check(words.join(":"), "ipv6");
}
