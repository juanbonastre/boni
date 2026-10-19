import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Per-user keys (docs/nucleo.md, 5.2). Every user has a random 32-byte data key; it is stored only
 * wrapped (sealed) with a key above it. On the NAS that is the server's master key, as `secret.key`
 * today; in the hosted product it would be released by attestation or by the user's device. The
 * store and the backups are the same code whichever provider gives the key.
 */

export interface KeyProvider {
  dataKey(userId: string): Buffer;
}

/** Where wrapped data keys live (system.db in the server; a map in tests). */
export interface WrappedKeys {
  get(userId: string): Buffer | null;
  put(userId: string, wrapped: Buffer): void;
}

const IV = 12;
const TAG = 16;

/** AES-256-GCM: iv (12) + tag (16) + ciphertext. Tampering makes `open` throw. */
export function seal(key: Buffer, plain: Buffer, aad = ""): Buffer {
  if (key.length !== 32) throw new Error("A key is 32 bytes");
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function open(key: Buffer, sealed: Buffer, aad = ""): Buffer {
  if (key.length !== 32) throw new Error("A key is 32 bytes");
  if (sealed.length < IV + TAG) throw new Error("Not a sealed box");
  const d = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, IV));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(sealed.subarray(IV, IV + TAG));
  return Buffer.concat([d.update(sealed.subarray(IV + TAG)), d.final()]);
}

/** The NAS's provider: data keys wrapped with the server's master key, made the first time. */
export function wrappedKeyProvider(master: Buffer, wrapped: WrappedKeys): KeyProvider {
  return {
    dataKey(userId) {
      const aad = `boni-data-key:${userId}`; // a wrapped key only opens as the key of its own user
      const stored = wrapped.get(userId);
      if (stored) return open(master, stored, aad);
      const key = randomBytes(32);
      wrapped.put(userId, seal(master, key, aad));
      return key;
    },
  };
}
