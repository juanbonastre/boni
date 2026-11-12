// A file dropped on Boni's window (docs/sistema.md §4.7, A-24): the main process sends it from where it is on disk to
// `POST api/data/files/upload`, a part at a time with the token (the page never sees it), saying how much has gone.
// Never whole in memory (a file may be 1 GB), and nothing past the cap is sent: it is refused before connecting.
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

/** The most a dropped file may weigh (the server's MAX_UPLOAD_BYTES). */
const MAX_UPLOAD = 1_000_000_000;
/** How long the server may say nothing while a file goes (it answers once all of it has arrived). */
const IDLE_MS = 120_000;

/** A file's name as the query of the upload: every character but letters, digits and `-_.` escaped (paths.cjs). */
const queryName = (name) =>
  encodeURIComponent(name).replace(
    /[!'()*~]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** The upload's path for a name, or null when the name is not one a file may have. */
function uploadPath(name) {
  if (typeof name !== "string") return null;
  const n = name.trim();
  if (!n || n.length > 200 || /[/\\\0]/.test(n) || n.startsWith(".")) return null;
  return `api/data/files/upload?name=${queryName(n)}`;
}

/**
 * Sends the file at `file` as `name`; `progress(sent, size)` after each 64 KB part read. Resolves with the server's
 * answer ({status, body}), or {error}: "too-big" (refused here), "unreadable" (not a file), "bad-name", "offline".
 */
function uploadFile({ file, name, serverUrl, bearer, progress = () => {}, signal }) {
  const p = uploadPath(name);
  if (!p) return Promise.resolve({ error: "bad-name" });
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return Promise.resolve({ error: "unreadable" });
  }
  if (!stat.isFile()) return Promise.resolve({ error: "unreadable" });
  if (stat.size > MAX_UPLOAD) return Promise.resolve({ error: "too-big" });
  const url = new URL(p, `${serverUrl}/`);
  const lib = url.protocol === "https:" ? https : url.protocol === "http:" ? http : null;
  if (!lib) return Promise.resolve({ error: "offline" });
  return new Promise((resolve) => {
    let done = false;
    const end = (a) => {
      if (done) return;
      done = true;
      resolve(a);
    };
    const req = lib.request(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "X-Boni-Client": "boni-desktop",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(stat.size),
      },
      signal,
    });
    req.setTimeout(IDLE_MS, () => req.destroy(new Error("timeout")));
    req.on("response", (res) => {
      const parts = [];
      let got = 0;
      res.on("data", (c) => {
        got += c.length;
        if (got <= 64 * 1024) parts.push(c);
      });
      res.on("end", () =>
        end({ status: res.statusCode, body: Buffer.concat(parts).toString("utf8") }),
      );
      res.on("error", () => end({ error: "offline" }));
    });
    req.on("error", () => end({ error: "offline" }));
    const from = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
    let sent = 0;
    from.on("data", (c) => {
      sent += c.length;
      progress(sent, stat.size);
      if (!req.write(c)) {
        from.pause();
        req.once("drain", () => from.resume());
      }
    });
    from.on("end", () => req.end());
    from.on("error", () => {
      req.destroy();
      end({ error: "unreadable" });
    });
  });
}

module.exports = { MAX_UPLOAD, queryName, uploadFile, uploadPath };
