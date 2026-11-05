/**
 * Web Push encryption (RFC 8291, over RFC 8188's aes128gcm) for a notice of Boni's (task 62): what the server posts
 * to a device's UnifiedPush address can only be read with the keys that device made, so the distributor (the ntfy
 * server and the phone's ntfy app) passes bytes it cannot read. One record of at most 4096 bytes, as the UnifiedPush
 * connector of Boni's Android app reads it (Tink's web push decryption).
 */
import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

/** The keys a device gives with its address, base64url as the browser's and the connector's: its P-256 public key
 *  (uncompressed, 65 bytes) and its 16-byte auth secret. */
export interface PushKeys {
  p256dh: string;
  auth: string;
}

/** The record size written in the header: the connector refuses a message longer than this, header included. */
export const RECORD_SIZE = 4096;

const b64 = (s: string) => Buffer.from(s, "base64url");
const B64URL = /^[A-Za-z0-9_-]+$/;

/** Keys a device could have made: a point of P-256 in its uncompressed form and a 16-byte secret. */
export function validKeys(k: unknown): k is PushKeys {
  const { p256dh, auth } = (k ?? {}) as Record<string, unknown>;
  if (typeof p256dh !== "string" || typeof auth !== "string") return false;
  if (!B64URL.test(p256dh) || !B64URL.test(auth)) return false;
  const point = b64(p256dh);
  return point.length === 65 && point[0] === 4 && b64(auth).length === 16;
}

const HKDF = (ikm: Buffer, salt: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync("sha256", ikm, salt, info, length));

/**
 * `plain` sealed for the device with `keys`: salt, record size, the server's ephemeral public key, then the one record
 * (the text, the delimiter 0x02, the tag). A fresh key and salt each time; `fixed` only gives the RFC's example. Throws
 * when the keys are not a point of the curve or the message would not fit in a record.
 */
export function encrypt(
  plain: Uint8Array,
  keys: PushKeys,
  fixed?: { salt: Buffer; privateKey: Buffer },
): Buffer {
  const uaPublic = b64(keys.p256dh);
  const auth = b64(keys.auth);
  const ecdh = createECDH("prime256v1");
  if (fixed) ecdh.setPrivateKey(fixed.privateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  // RFC 8291 3.4: the auth secret and both public keys go into the key the content is encrypted with.
  const ikm = HKDF(
    secret,
    auth,
    Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]),
    32,
  );
  const salt = fixed?.salt ?? randomBytes(16);
  const cek = HKDF(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = HKDF(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([
    cipher.update(Buffer.concat([plain, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  const out = Buffer.concat([header, asPublic, record]);
  if (out.length > RECORD_SIZE) throw new Error("push-too-long");
  return out;
}
