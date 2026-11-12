const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { allowedPath } = require("./paths.cjs");
const { MAX_UPLOAD, uploadFile, uploadPath } = require("./uploads.cjs");

test("a dropped file's name goes in the query escaped strictly, as the shell allows it", () => {
  const p = uploadPath("Factura FAC-2026-0142 (taller) ñ.pdf");
  assert.equal(p, "api/data/files/upload?name=Factura%20FAC-2026-0142%20%28taller%29%20%C3%B1.pdf");
  assert.equal(allowedPath(p), true);
  for (const n of ["", "../x.pdf", "a/b.pdf", ".oculto", "x".repeat(201), 42])
    assert.equal(uploadPath(n), null, String(n));
});

test("a file is sent from disk a part at a time, with its size first and how much has gone", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boni-uploads-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "extracto.csv");
  const size = 3 * 1024 * 1024 + 17;
  const bytes = Buffer.alloc(size, 7);
  fs.writeFileSync(file, bytes);
  let seen = null;
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      seen = {
        url: req.url,
        auth: req.headers.authorization,
        length: req.headers["content-length"],
        body: Buffer.concat(parts),
      };
      res.end(JSON.stringify({ id: "e_01", state: "text" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const steps = [];
  const a = await uploadFile({
    file,
    name: "extracto noviembre.csv",
    serverUrl: `http://127.0.0.1:${server.address().port}`,
    bearer: "clave-de-ejemplo",
    progress: (sent, total) => steps.push([sent, total]),
  });
  assert.deepEqual(a, { status: 200, body: JSON.stringify({ id: "e_01", state: "text" }) });
  assert.equal(seen.url, "/api/data/files/upload?name=extracto%20noviembre.csv");
  assert.equal(seen.auth, "Bearer clave-de-ejemplo");
  assert.equal(seen.length, String(size));
  assert.ok(seen.body.equals(bytes));
  assert.ok(steps.length > 10);
  assert.deepEqual(steps.at(-1), [size, size]);
  assert.ok(steps.every(([s], i) => i === 0 || s > steps[i - 1][0]));
});

test("a file over 1 GB is refused before connecting; a folder or a missing file is unreadable", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boni-uploads-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const big = path.join(dir, "vídeo.mp4");
  // A sparse file: its size is past the cap without writing a gigabyte.
  fs.closeSync(fs.openSync(big, "w"));
  fs.truncateSync(big, MAX_UPLOAD + 1);
  const at = { serverUrl: "http://127.0.0.1:9", bearer: "x" };
  assert.deepEqual(await uploadFile({ ...at, file: big, name: "vídeo.mp4" }), {
    error: "too-big",
  });
  assert.deepEqual(await uploadFile({ ...at, file: dir, name: "x.pdf" }), { error: "unreadable" });
  assert.deepEqual(await uploadFile({ ...at, file: path.join(dir, "no"), name: "x.pdf" }), {
    error: "unreadable",
  });
});
