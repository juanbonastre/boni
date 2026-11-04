/**
 * Titles compared as people read them (tasks 46 and 50): without accents, case or punctuation, and two titles name
 * the same thing when they are equal that way or when most of their words agree, empty words aside. Used by the
 * server to fold a thread of mail and by the calendar to suggest that an external event and a record are one.
 */

/** A title without accents, case or punctuation, for comparing. */
export const normalizeTitle = (t: string): string =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words that say nothing of what a title is about (articles, prepositions): left out when comparing. */
const EMPTY_WORDS = new Set(
  "el la los las de del a al en con por para y e o u un una unos unas su sus mi mis tu tus lo le les se que".split(
    " ",
  ),
);

/**
 * Whether two titles name the same thing: equal once normalised; one's words (two at least) all in the other's
 * («Clase IPM 8» and «Clase IPM 8, mi nota»); or most of their words in common.
 */
export function likeTitle(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // A number counts however short («Clase IPM 8» is not «Clase IPM 9»); a single letter does not.
  const words = (s: string) =>
    new Set(s.split(" ").filter((w) => (w.length > 1 || /\d/.test(w)) && !EMPTY_WORDS.has(w)));
  const wx = words(x);
  const wy = words(y);
  let common = 0;
  for (const w of wx) if (wy.has(w)) common++;
  const smaller = Math.min(wx.size, wy.size);
  if (smaller >= 2 && common === smaller) return true;
  if (wx.size < 3 || wy.size < 3) return false;
  return common / (wx.size + wy.size - common) >= 0.7;
}
