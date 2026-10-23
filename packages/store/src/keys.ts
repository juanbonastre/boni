import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, openSync, readSync, renameSync, rmSync, writeSync } from "node:fs";

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

/**
 * `seal` for a file, a megabyte at a time, into `dest` (same format: iv, tag, body; the tag is written last
 * in its place). The server's container has 512 MB: a store with its attachments sealed in memory took three
 * times its size and the container was killed at every start, before the day's copy was done (2026-10-23).
 */
export function sealFile(key: Buffer, src: string, dest: string, aad = ""): void {
  if (key.length !== 32) throw new Error("A key is 32 bytes");
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const input = openSync(src, "r");
  const out = openSync(dest, "w", 0o600);
  try {
    writeSync(out, iv);
    writeSync(out, Buffer.alloc(TAG));
    const chunk = Buffer.alloc(1 << 20);
    for (;;) {
      const n = readSync(input, chunk, 0, chunk.length, null);
      if (n === 0) break;
      writeSync(out, c.update(chunk.subarray(0, n)));
    }
    writeSync(out, c.final());
    writeSync(out, c.getAuthTag(), 0, TAG, IV);
  } finally {
    closeSync(input);
    closeSync(out);
  }
}

/**
 * `open` for a file sealed by `sealFile` (or `seal`), a megabyte at a time, into `dest`: the plain text goes to
 * `dest.partial` and becomes `dest` only once the tag checks at the end; a wrong key or a changed byte removes it
 * and throws, leaving nothing behind (restoring a copy must not hold it whole in memory either: sealFile's lesson).
 */
export function openFile(key: Buffer, src: string, dest: string, aad = ""): void {
  if (key.length !== 32) throw new Error("A key is 32 bytes");
  const input = openSync(src, "r");
  const partial = `${dest}.partial`;
  let out: number | null = null;
  try {
    const head = Buffer.alloc(IV + TAG);
    // Read in sequence (no explicit position: it would not move the file's own position for the loop below).
    if (readSync(input, head, 0, head.length, null) < head.length)
      throw new Error("Not a sealed box");
    const d = createDecipheriv("aes-256-gcm", key, head.subarray(0, IV));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(head.subarray(IV, IV + TAG));
    out = openSync(partial, "w", 0o600);
    const chunk = Buffer.alloc(1 << 20);
    for (;;) {
      const n = readSync(input, chunk, 0, chunk.length, null);
      if (n === 0) break;
      writeSync(out, d.update(chunk.subarray(0, n)));
    }
    writeSync(out, d.final()); // throws when the tag does not match
    closeSync(out);
    out = null;
    renameSync(partial, dest);
  } catch (e) {
    if (out !== null) closeSync(out);
    rmSync(partial, { force: true });
    throw e;
  } finally {
    closeSync(input);
  }
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
