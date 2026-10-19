/**
 * What the import finds in a text that must not, or should not, be treated as ordinary data
 * (docs/nucleo.md, 9.1; Juan, 2026-10-19):
 *  - access secrets (API keys, tokens, private keys, written passwords) are never imported: the line
 *    is left out and the report says where it was, so Juan can remove it from the vault;
 *  - identity and bank numbers (DNI/NIE, IBAN, card numbers) are imported as they are, but make the
 *    value sensitive.
 * The report only ever says the kind and the line, never the value.
 */

const SECRET_PATTERNS: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Anthropic or OpenAI-style key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  [
    "signed URL (credentials in the address)",
    /[?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|X-Goog-Signature|sig|signature)=[^&\s]{8,}/i,
  ],
  // A word like "password" or "token" followed by something that looks like a secret: 12+ characters
  // without spaces, with letters and digits ("edit token: everything except..." is prose, not a secret).
  [
    "written password or token",
    /\b(?:password|passwd|contraseña|contrasena|api[ _-]?key|token|secret|app password)\b\s*[:=]\s*["'`]?(?=[^\s"'`]*\d)(?=[^\s"'`]*[A-Za-z])[^\s"'`]{12,}/i,
  ],
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const validDni = (n: string, letter: string) =>
  DNI_LETTERS[Number(n) % 23] === letter.toUpperCase();

export function secretKind(line: string): string | null {
  for (const [kind, re] of SECRET_PATTERNS) if (re.test(line)) return kind;
  return null;
}

/** Whether a text holds identity or bank numbers (only real ones: DNI letters and card checksums are checked). */
export function hasIdentityNumbers(text: string): boolean {
  for (const m of text.matchAll(/\b(\d{8})-?([A-Za-z])\b/g))
    if (validDni(m[1] as string, m[2] as string)) return true;
  for (const m of text.matchAll(/\b([XYZxyz])-?(\d{7})-?([A-Za-z])\b/g)) {
    const n = `${"XYZ".indexOf((m[1] as string).toUpperCase())}${m[2]}`;
    if (validDni(n, m[3] as string)) return true;
  }
  if (/\bES\d{2}(?:[ ]?\d{4}){5}\b/.test(text)) return true;
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

/** The text without the lines that hold an access secret, and which lines (1-based) and kinds they were. */
export function withoutSecrets(text: string): {
  text: string;
  found: { line: number; kind: string }[];
} {
  const found: { line: number; kind: string }[] = [];
  const kept = text.split("\n").filter((l, i) => {
    const kind = secretKind(l);
    if (kind) found.push({ line: i + 1, kind });
    return !kind;
  });
  return { text: kept.join("\n"), found };
}
