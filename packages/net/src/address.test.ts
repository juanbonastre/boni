import { describe, expect, it } from "vitest";
import { embeddedIpv4, ipv6Bytes, isBlockedAddress } from "./address.ts";

describe("isBlockedAddress", () => {
  it("blocks everything that is not the public internet", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.5",
      "100.64.0.1",
      "100.101.102.103", // a tailnet address
      "100.100.100.200", // a cloud's metadata service
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.0.2.1",
      "192.168.1.10",
      "198.18.0.1",
      "203.0.113.9",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "[::1]",
      "fe80::1",
      "fe80::1%eth0",
      "fd7a:115c:a1e0::1", // Tailscale's IPv6
      "fc00::1",
      "ff02::1",
      "2001:db8::1",
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("judges an IPv4 hidden inside an IPv6 address as that IPv4", () => {
    for (const ip of [
      "::ffff:127.0.0.1", // mapped
      "::ffff:7f00:1", // mapped, written in hex
      "::ffff:192.168.1.1",
      "::ffff:0:10.0.0.1", // translated
      "::127.0.0.1", // compatible
      "64:ff9b::a00:1", // NAT64 of 10.0.0.1
      "2002:c0a8:101::1", // 6to4 of 192.168.1.1
      "2001:0:4136:e378::1", // Teredo: blocked as a whole
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("lets public addresses through and fails closed on anything else", () => {
    for (const ip of ["8.8.8.8", "142.250.200.14", "1.1.1.1", "2a00:1450:4003:80e::200e"])
      expect(isBlockedAddress(ip), ip).toBe(false);
    for (const bad of ["", "localhost", "example.com", "1.2.3", "::gggg", "300.1.1.1"])
      expect(isBlockedAddress(bad), bad).toBe(true);
  });

  it("reads IPv6 addresses into their 16 bytes", () => {
    expect(ipv6Bytes("::1")).toEqual([...new Array(15).fill(0), 1]);
    expect(ipv6Bytes("::ffff:1.2.3.4")?.slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
    expect(ipv6Bytes("2001:db8::8:800:200c:417a")?.slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8]);
    expect(ipv6Bytes("1.2.3.4")).toBeNull();
    const mapped = ipv6Bytes("::ffff:c0a8:101");
    expect(mapped && embeddedIpv4(mapped)).toBe("192.168.1.1");
  });
});
