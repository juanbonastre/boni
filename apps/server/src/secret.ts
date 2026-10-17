import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Secrets of an account (the private addresses of external calendars) are stored encrypted, so a copy
 * of the database alone (a backup) does not give them away. The key is `BONI_SECRET_KEY` (32 bytes,
 * base64) or, without it, `secret.key` next to the database, made on the first start (mode 600). Keep a
 * copy of the key apart from the database's backups: without it the secrets cannot be read.
 */
export type SecretKey = Buffer;

export function loadKey(dbPath: string, env = process.env.BONI_SECRET_KEY): SecretKey {
  if (env) {
    const key = Buffer.from(env, "base64");
    if (key.length !== 32) throw new Error("BONI_SECRET_KEY must be 32 bytes in base64");
    return key;
  }
  if (dbPath === ":memory:") return randomBytes(32);
  const file = join(dirname(dbPath), "secret.key");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error(`${file} is not a 32-byte key in base64`);
  return key;
}

/** AES-256-GCM: "v1." + base64(iv | tag | ciphertext). */
export function encrypt(key: SecretKey, text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
}

export function decrypt(key: SecretKey, sealed: string): string {
  if (!sealed.startsWith("v1.")) throw new Error("Unknown secret format");
  const raw = Buffer.from(sealed.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
