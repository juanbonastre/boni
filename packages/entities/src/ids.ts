/**
 * Ids for types, fields, entities and options: a prefix, then a ULID (time first, so ids sort by when
 * they were made, then randomness). They never depend on a name or a path, so nothing is renamed when
 * a title or a note changes.
 */

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

export type IdKind = "t" | "f" | "e" | "o";

export function newId(
  kind: IdKind,
  now: number = Date.now(),
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  let time = "";
  let t = Math.floor(now);
  for (let i = 0; i < 10; i++) {
    time = (CROCKFORD[t % 32] ?? "0") + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(16);
  let rand = "";
  for (const b of bytes) rand += CROCKFORD[b % 32];
  return `${kind}_${time}${rand}`;
}
