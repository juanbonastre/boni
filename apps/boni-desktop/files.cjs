// Attachments opened from the page (a row's `file` value): the main process downloads them with the token into
// a private temporary folder (0700, removed when Boni quits) and opens them with the system's app. Only kinds
// that a viewer opens are opened that way; anything else (a script, a .desktop file, an unknown type) is only
// shown in its folder, so opening an attachment never runs it.
const path = require("node:path");

const SHA = /^[0-9a-f]{64}$/;

/** Documents, pictures, audio and video: what a viewer opens without running anything. */
const VIEWABLE = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
  ".txt",
  ".csv",
  ".md",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".odt",
  ".ods",
  ".mp3",
  ".m4a",
  ".mp4",
]);

/** A file name that stays inside the folder: no separators, no control characters, no leading dot. */
function safeFileName(name) {
  const base = String(name ?? "")
    .split(/[\\/]/)
    .pop()
    .split("")
    .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127)
    .join("")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 120);
  return base || "archivo";
}

const isSha = (s) => typeof s === "string" && SHA.test(s);
const opensDirectly = (name) => VIEWABLE.has(path.extname(name).toLowerCase());

module.exports = { isSha, opensDirectly, safeFileName };
