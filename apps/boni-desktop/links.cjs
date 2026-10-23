// Links into Boni from other apps (`boni://`, registered by the .deb and at start): Boni Calendar's "Abrir en Boni"
// opens the row a vault note became (`boni://note?path=agenda/docencia/2026-10-22 Clase.md[&peek=1]`), and
// `boni://peek?hide=1` puts the peek away (Boni Calendar sends it on a click in the calendar), and
// `boni://proposal?id=<id>[&peek=1]` opens a proposal of the inbox (one drawn in Boni Calendar, to accept or reject).
// Only those shapes are taken, the path must be a vault-relative note and the id a plain one: nothing else in a link
// reaches the page.
function screenOfUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  if (u.protocol === "boni:" && u.hostname === "peek" && u.searchParams.get("hide") === "1")
    return { hidePeek: true };
  if (u.protocol === "boni:" && u.hostname === "proposal") {
    const id = u.searchParams.get("id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
    return { screen: `proposal:${id}`, peek: u.searchParams.get("peek") === "1" };
  }
  if (u.protocol !== "boni:" || u.hostname !== "note") return null;
  const path = u.searchParams.get("path") ?? "";
  if (
    !path ||
    path.length > 500 ||
    !path.toLowerCase().endsWith(".md") ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((p) => p === "" || p === "." || p === "..") ||
    [...path].some((c) => c.charCodeAt(0) < 32)
  )
    return null;
  // peek=1: in the small window that stays until Esc, its close button or a click in Boni Calendar.
  return { screen: `note:${path}`, peek: u.searchParams.get("peek") === "1" };
}

/** The first `boni://` link among a process's arguments (a start or a second start). */
const linkIn = (argv) => (argv ?? []).find((a) => typeof a === "string" && a.startsWith("boni://"));

module.exports = { linkIn, screenOfUrl };
