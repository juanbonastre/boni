/**
 * The device's side of Web Push (RFC 8291) for the tests: a key pair as the UnifiedPush connector makes one, and the
 * decryption it does (the server only ever encrypts).
 */
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import type { PushKeys } from "./webpush.ts";

const HKDF = (ikm: Buffer, salt: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync("sha256", ikm, salt, info, length));

/** A device's keys: what it gives the server, and its private key. */
export function deviceKeys(): { keys: PushKeys; privateKey: Buffer } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
    privateKey: ecdh.getPrivateKey(),
  };
}

/** What the device reads from `body` with its keys; throws when it was not sealed for them. */
export function decrypt(body: Buffer, keys: PushKeys, privateKey: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateKey);
  const uaPublic = Buffer.from(keys.p256dh, "base64url");
  const ikm = HKDF(
    ecdh.computeSecret(asPublic),
    Buffer.from(keys.auth, "base64url"),
    Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]),
    32,
  );
  const cek = HKDF(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = HKDF(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  let end = padded.length - 1;
  while (end > 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error("not the last record");
  return padded.subarray(0, end);
}
