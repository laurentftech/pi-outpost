/**
 * GET /files/raw — the endpoint that puts workspace bytes on the wire for inline
 * images. Everything here is a confinement or content-safety property, so these
 * run without model auth.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { makeWorkspace, PNG_BYTES, startServer } from "./harness.mjs";

const TOKEN = "test-token-files-raw";

describe("GET /files/raw", () => {
  let open;
  let guarded;
  let tightPdf;
  let secretPath;

  before(async () => {
    const files = {
      "plot.png": PNG_BYTES,
      "big.png": Buffer.concat([PNG_BYTES, randomBytes(1_100_000)]),
      "report.html": "<h1>hi</h1><script>alert(1)</script>",
      "img.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "notes.md": "# hello\n",
      // Bigger than the 1 MB cap that governs every other file: the PDF ceiling
      // is the only reason this one may be served at all
      "big.pdf": Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(2_000_000)]),
    };
    const openRoot = await makeWorkspace(files);
    // Outside the workspace: nothing must ever reach it
    secretPath = path.join(path.dirname(openRoot), `secret-${Date.now()}.txt`);
    await writeFile(secretPath, "SECRET");
    open = await startServer(openRoot);

    const guardedRoot = await makeWorkspace(files);
    guarded = await startServer(guardedRoot, { server: { token: TOKEN } });

    const tightRoot = await makeWorkspace(files);
    tightPdf = await startServer(tightRoot, { pdf: { maxBytes: 1_048_576 } });
  });
  after(async () => {
    await open?.stop();
    await guarded?.stop();
    await tightPdf?.stop();
  });

  test("serves an image with its content type", async () => {
    const res = await fetch(`${open.base}/files/raw?path=plot.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(Buffer.from(await res.arrayBuffer()).length, PNG_BYTES.length);
  });

  test("refuses to escape the workspace", async () => {
    for (const target of ["../secret.txt", "..%2F..%2Fetc%2Fhosts", "/etc/hosts", secretPath]) {
      const res = await fetch(`${open.base}/files/raw?path=${encodeURIComponent(target)}`);
      assert.equal(res.status, 404, `${target} must not resolve`);
      const body = await res.text();
      assert.ok(!body.includes("SECRET"), `${target} leaked content`);
    }
  });

  test("refuses a file over the 1 MiB cap", async () => {
    const res = await fetch(`${open.base}/files/raw?path=big.png`);
    assert.equal(res.status, 413);
  });

  test("serves a PDF above the 1 MB cap, under the PDF ceiling", async () => {
    const res = await fetch(`${open.base}/files/raw?path=big.pdf`);
    assert.equal(res.status, 200);
    assert.equal(Buffer.from(await res.arrayBuffer()).length, 2_000_009);
  });

  test("a PDF over the configured PDF ceiling is still refused", async () => {
    const res = await fetch(`${tightPdf.base}/files/raw?path=big.pdf`);
    assert.equal(res.status, 413);
  });

  test("a PDF is a download too — the browser's own viewer never runs it here", async () => {
    const res = await fetch(`${open.base}/files/raw?path=big.pdf`);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(res.headers.get("content-disposition"), "attachment");
  });

  test("non-image files are downloads, never renderable on our origin", async () => {
    const res = await fetch(`${open.base}/files/raw?path=report.html`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(res.headers.get("content-disposition"), "attachment");
  });

  test("SVG is served with scripts disabled", async () => {
    const res = await fetch(`${open.base}/files/raw?path=img.svg`);
    assert.equal(res.headers.get("content-type"), "image/svg+xml");
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  });

  test("missing path is a 400, missing file a 404", async () => {
    assert.equal((await fetch(`${open.base}/files/raw`)).status, 400);
    assert.equal((await fetch(`${open.base}/files/raw?path=nope.png`)).status, 404);
  });

  test("a token-less server refuses a foreign Host (DNS rebinding)", async () => {
    // fetch() forbids overriding Host, so speak HTTP directly — a rebound
    // attacker page reaches 127.0.0.1 but the browser still sends *its* Host
    const status = (host) =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port: open.port,
            path: "/files/raw?path=plot.png",
            headers: { host },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      });

    assert.equal(await status("evil.com"), 403);
    assert.equal(await status("evil.com:1234"), 403);
    assert.equal(await status(`localhost:${open.port}`), 200);
    assert.equal(await status(`127.0.0.1:${open.port}`), 200);
  });

  test("with a token configured, bytes need the token", async () => {
    assert.equal((await fetch(`${guarded.base}/files/raw?path=plot.png`)).status, 401);
    assert.equal((await fetch(`${guarded.base}/files/raw?path=plot.png&token=wrong`)).status, 401);
    assert.equal((await fetch(`${guarded.base}/files/raw?path=plot.png&token=${TOKEN}`)).status, 200);
    const bearer = await fetch(`${guarded.base}/files/raw?path=plot.png`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(bearer.status, 200);
  });
});
