// The copy of everything kept on this computer (Juan, 2026-10-23: a copy that does not depend on the NAS, its key or
// Syncthing): once a day the main process downloads the account's export (GET api/export, the same zip as "Descargar
// .zip") into a folder, as boni-YYYY-MM-DD.zip, and keeps the last ones. Pure rules here (unit-tested); the download
// itself is in main.cjs.
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DIR = "/SamsungSSD/Copias/Boni";
const KEEP = 7;
/** Below this, no copy is started (an export is about the size of the attachments). */
const MIN_FREE = 2 * 1024 ** 3;
const NAME = /^boni-(\d{4}-\d{2}-\d{2})\.zip$/;

/** The day of `ms` on this computer (copies are named by it). */
function dayOf(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const nameFor = (ms) => `boni-${dayOf(ms)}.zip`;

/** Whether a copy is due: on, and none made today (a failed one is tried again after an hour). */
function due(state, now) {
  if (!state.on) return false;
  if (state.last && dayOf(state.last) === dayOf(now)) return false;
  if (state.failedAt && now - state.failedAt < 60 * 60 * 1000) return false;
  return true;
}

/** Copies to remove so that `keep` remain: the oldest of this folder's own `boni-YYYY-MM-DD.zip` files. */
function toRemove(names, keep = KEEP) {
  return names
    .filter((n) => NAME.test(n))
    .sort()
    .slice(0, Math.max(0, names.filter((n) => NAME.test(n)).length - keep));
}

/** A folder Juan may choose: an absolute path, nothing odd in it. Null otherwise. */
function cleanDir(raw) {
  if (typeof raw !== "string") return null;
  const d = raw.trim().replace(/\/+$/, "");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
  if (!d || !path.isAbsolute(d) || d.length > 400 || /[\u0000-\u001f]/.test(d)) return null;
  const n = path.normalize(d);
  return n === "/" ? null : n;
}

/**
 * Makes sure the folder can hold a copy. A missing folder is created only when the nearest folder that exists has
 * something in it: an external disk that is not mounted leaves its mount point empty, and a copy made there would
 * fill the system disk. Returns an error code, or null when it is ready.
 */
function prepareDir(dir, minFree = MIN_FREE) {
  let existing = dir;
  while (!fs.existsSync(existing)) {
    const up = path.dirname(existing);
    if (up === existing) return "no-folder";
    existing = up;
  }
  if (!fs.statSync(existing).isDirectory()) return "no-folder";
  if (existing !== dir) {
    if (fs.readdirSync(existing).length === 0) return "not-mounted";
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return "not-writable";
  }
  const s = fs.statfsSync(dir);
  if (s.bavail * s.bsize < minFree) return "no-space";
  return null;
}

module.exports = {
  DEFAULT_DIR,
  KEEP,
  MIN_FREE,
  dayOf,
  nameFor,
  due,
  toRemove,
  cleanDir,
  prepareDir,
};
