import { describe, expect, it } from "vitest";
import { decrypt, deviceKeys } from "./webpush.test-util.ts";
import { encrypt, RECORD_SIZE, validKeys } from "./webpush.ts";

/** Web Push encryption (RFC 8291) for Boni's notices by UnifiedPush (task 62, A-17). */
const b = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "base64url");

// RFC 8291 §5 and Appendix A: the receiver's keys and secret, the sender's key and the salt of its example.
const RFC = {
  keys: {
    p256dh:
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
  },
  receiverPrivate: b("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"),
  fixed: {
    salt: b("DGv6ra1nlYgDCS1FRnbzlw"),
    privateKey: b("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
  },
};

/**
 * A notice as the server seals it, with the RFC's keys and salt: Boni Android's unit test (NoticesTest.kt) opens these
 * very bytes with the decryption its UnifiedPush connector uses on the phone (Tink's), so both sides agree.
 */
const NOTICE = `{"kind":"notice","id":"n-ejemplo","text":"Resumen de hoy: 3 tareas, la primera «Revisar el informe»","at":1793862000000}`;
const NOTICE_SEALED =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_e3dBcDLa4LAPSvPoQuUAdsSftsfkPSMfI9nIZjKr8RLaTHCwmGHqYDEPAywzajV4XT-EdoQ28k_E1pouMezvpuXT1n8pDE7jOZqcmRD0IXCcHw2kTobsFu9cQPgB0UdpzqUtj2ThrsnwfY5FqxlGiMX52mM1PG4CMxwG8831MaCK6sScffcsN_0zx";

describe("Web Push encryption (RFC 8291)", () => {
  it("seals the RFC's example to the very bytes it shows", () => {
    const body = encrypt(
      Buffer.from("When I grow up, I want to be a watermelon"),
      RFC.keys,
      RFC.fixed,
    );
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
    expect(decrypt(body, RFC.keys, RFC.receiverPrivate).toString()).toBe(
      "When I grow up, I want to be a watermelon",
    );
  });

  it("a notice: only the device it was sealed for reads it, and no two messages are alike", () => {
    const sealed = encrypt(Buffer.from(NOTICE), RFC.keys, RFC.fixed);
    expect(sealed.toString("base64url")).toBe(NOTICE_SEALED);
    expect(decrypt(sealed, RFC.keys, RFC.receiverPrivate).toString()).toBe(NOTICE);
    const phone = deviceKeys();
    const other = deviceKeys();
    const a = encrypt(Buffer.from(NOTICE), phone.keys);
    const c = encrypt(Buffer.from(NOTICE), phone.keys);
    expect(decrypt(a, phone.keys, phone.privateKey).toString()).toBe(NOTICE);
    expect(a.equals(c)).toBe(false);
    // Neither the text nor a word of it travels in the clear.
    expect(a.includes(Buffer.from("Resumen"))).toBe(false);
    expect(() => decrypt(a, other.keys, other.privateKey)).toThrow();
  });

  it("fits one record of the connector's size, or refuses", () => {
    const phone = deviceKeys();
    // 500 characters of three bytes each: the longest notice (tools.ts cuts at 500) fits.
    const longest = JSON.stringify({
      kind: "notice",
      id: "x".repeat(36),
      text: "€".repeat(500),
      at: 0,
    });
    expect(encrypt(Buffer.from(longest), phone.keys).length).toBeLessThanOrEqual(RECORD_SIZE);
    expect(() => encrypt(Buffer.alloc(RECORD_SIZE), phone.keys)).toThrow("push-too-long");
  });

  it("takes only keys a device could have made", () => {
    expect(validKeys(deviceKeys().keys)).toBe(true);
    expect(validKeys(RFC.keys)).toBe(true);
    expect(validKeys(null)).toBe(false);
    expect(validKeys({ p256dh: RFC.keys.p256dh })).toBe(false);
    // A compressed point, a short secret, padding or another alphabet.
    expect(validKeys({ ...RFC.keys, p256dh: Buffer.alloc(33, 2).toString("base64url") })).toBe(
      false,
    );
    expect(validKeys({ ...RFC.keys, auth: Buffer.alloc(8).toString("base64url") })).toBe(false);
    expect(validKeys({ ...RFC.keys, auth: `${RFC.keys.auth}==` })).toBe(false);
    expect(
      validKeys({ ...RFC.keys, p256dh: Buffer.from(b(RFC.keys.p256dh)).toString("base64") }),
    ).toBe(false);
    // Not a point of the curve: encrypting refuses.
    const bad = {
      ...RFC.keys,
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"),
    };
    expect(validKeys(bad)).toBe(true);
    expect(() => encrypt(Buffer.from("x"), bad)).toThrow();
  });
});
