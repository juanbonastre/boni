// Links into Boni from other apps (`boni://`, registered by the .deb and at start): Boni Calendar's "Abrir en Boni"
// opens a record by its id (`boni://note?id=<id>[&peek=1]`; notes have no paths), `boni://peek?hide=1` puts the peek
// away (Boni Calendar sends it on a click in the calendar), and `boni://proposal?id=<id>[&peek=1]` opens a proposal of
// the inbox (one drawn in Boni Calendar, to accept or reject). Only those shapes are taken, each id a plain one:
// nothing else in a link reaches the page.
function screenOfUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  if (u.protocol === "boni:" && u.hostname === "peek" && u.searchParams.get("hide") === "1")
    return { hidePeek: true };
  if (u.protocol !== "boni:" || (u.hostname !== "proposal" && u.hostname !== "note")) return null;
  const id = u.searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  // peek=1: in the small window that stays until Esc, its close button or a click in Boni Calendar.
  return { screen: `${u.hostname}:${id}`, peek: u.searchParams.get("peek") === "1" };
}

/** The first `boni://` link among a process's arguments (a start or a second start). */
const linkIn = (argv) => (argv ?? []).find((a) => typeof a === "string" && a.startsWith("boni://"));

module.exports = { linkIn, screenOfUrl };
