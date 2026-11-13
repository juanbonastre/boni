// What Juan types or picks on a question's card (docs/conversacion.md §3.4) read as its answer, before it goes to the server.

/**
 * A number as Juan writes it in his language: «12,5» and «1.250» in Spanish (a comma decimal, dots in thousands),
 * «12.5» and «1,250» in English. Spaces are allowed between groups. Null when it is not a number.
 */
export function parseNumber(text: string, lang: string): number | null {
  const x = text.replace(/[\s  ]/g, "");
  const sign = /^[+-]/.test(x) ? x[0] : "";
  const body = sign ? x.slice(1) : x;
  if (!body || !/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null;
  const decimal = lang === "en" ? "." : ",";
  const group = lang === "en" ? "," : ".";
  const hasDecimal = body.includes(decimal);
  const hasGroup = body.includes(group);
  let whole = body;
  let frac = "";
  if (hasDecimal) {
    const parts = body.split(decimal);
    if (parts.length !== 2) return null;
    whole = parts[0] ?? "";
    frac = parts[1] ?? "";
    if (!/^\d+$/.test(frac)) return null;
  } else if (hasGroup && !/^\d{1,3}(\.\d{3})+$|^\d{1,3}(,\d{3})+$/.test(body)) {
    // «12.5» in Spanish, «12,5» in English: the other way of writing a decimal, as people do.
    const parts = body.split(group);
    if (parts.length !== 2 || !parts[0] || !/^\d+$/.test(parts[1] ?? "")) return null;
    whole = parts[0];
    frac = parts[1] ?? "";
  }
  if (whole.includes(group)) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(whole)) return null;
    whole = whole.split(group).join("");
  }
  if (whole && !/^\d+$/.test(whole)) return null;
  const n = Number(`${sign}${whole || "0"}${frac ? `.${frac}` : ""}`);
  return Number.isFinite(n) && Math.abs(n) <= 1e15 ? n : null;
}
