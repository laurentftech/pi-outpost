/**
 * GET /files/raw — the endpoint that puts workspace bytes on the wire for inline
 * images. Everything here is a confinement or content-safety property, so these
 * run without model auth.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, PNG_BYTES, startServer } from "./harness.mjs";

const TOKEN = "test-token-files-raw";

describe("GET /files/raw", () => {
  let open;
  let guarded;
  let tightPdf;
  let secretPath;

  before(async () => {
    const files = {
      "plot.png": PNG_BYTES,
      // A photo or a screenshot: above the 1 MB cap, which an SVG of the same
      // figure never reaches
      "big.png": Buffer.concat([PNG_BYTES, randomBytes(2_000_000)]),
      "photo.jpg": Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(2_000_000)]),
      "big.txt": Buffer.alloc(1_100_000, "a"),
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

  test("refuses a non-image file over the 1 MiB cap", async () => {
    const res = await fetch(`${open.base}/files/raw?path=big.txt`);
    assert.equal(res.status, 413);
    assert.equal((await res.json()).limit, 1_048_576);
  });

  test("ImageUnderThePdfLimit: serves a PNG and a JPEG above the 1 MB cap, under the PDF ceiling", async () => {
    for (const [name, type, length] of [
      ["big.png", "image/png", PNG_BYTES.length + 2_000_000],
      ["photo.jpg", "image/jpeg", 2_000_003],
    ]) {
      const res = await fetch(`${open.base}/files/raw?path=${name}`);
      assert.equal(res.status, 200, name);
      assert.equal(res.headers.get("content-type"), type);
      assert.equal(Buffer.from(await res.arrayBuffer()).length, length);
    }
  });

  test("ImageOverThePdfLimit: an image over the configured PDF ceiling is refused, naming that ceiling", async () => {
    const res = await fetch(`${tightPdf.base}/files/raw?path=big.png`);
    assert.equal(res.status, 413);
    assert.equal((await res.json()).limit, 1_048_576);
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

/**
 * A server holding several projects reads a file from the project the client names.
 *
 * Every path the interface holds — a tree entry, a reference in a reply — is relative
 * to the project its connection is bound to. The route used to read from the project
 * the server booted with whatever the client was looking at, so an image of any other
 * project answered 404 and was drawn as a broken image.
 */
describe("GET /files/raw with several projects open", () => {
  let server;
  let alpha;
  let beta;
  let elsewhere;
  // Distinct bytes under the same name, so a 200 from the wrong project cannot pass.
  const ALPHA_PNG = Buffer.concat([PNG_BYTES, Buffer.from("alpha")]);
  const BETA_PNG = Buffer.concat([PNG_BYTES, Buffer.from("beta-project")]);

  before(async () => {
    alpha = await realpath(await makeWorkspace({ "shared.png": ALPHA_PNG }));
    beta = await realpath(await makeWorkspace({ "shared.png": BETA_PNG, "figures/only-beta.png": BETA_PNG }));
    // A directory that exists, holds an image, and was never opened as a project.
    elsewhere = await realpath(await makeWorkspace({ "shared.png": PNG_BYTES }));
    server = await startServer(alpha, { openProjects: [beta] });
  });
  after(async () => {
    await server?.stop();
  });

  /** The id the server gives a project, read from the snapshot as the interface reads it. */
  async function projectIds() {
    const client = connect(server.wsUrl());
    try {
      const hello = await client.waitFor((m) => m.type === "hello");
      const idOf = (root) => {
        const info = hello.workspaces.find((w) => w.root === root && w.sideOf === undefined);
        assert.ok(info, `${root} is listed as open`);
        return info.id ?? info.root;
      };
      return { alpha: idOf(alpha), beta: idOf(beta) };
    } finally {
      client.close();
    }
  }

  const raw = (relPath, workspace) =>
    fetch(`${server.base}/files/raw?path=${encodeURIComponent(relPath)}${workspace === undefined ? "" : `&workspace=${encodeURIComponent(workspace)}`}`);

  // openlore: scenario=ServeFromTheNamedProject spec=api
  test("ServeFromTheNamedProject: a named project's image is read from that project's root", async () => {
    const ids = await projectIds();

    const fromBeta = await raw("figures/only-beta.png", ids.beta);
    assert.equal(fromBeta.status, 200, "a file only the other project holds is found there");
    assert.equal(fromBeta.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await fromBeta.arrayBuffer()), BETA_PNG);

    // Same name in both projects: each answers with its own bytes.
    assert.deepEqual(Buffer.from(await (await raw("shared.png", ids.beta)).arrayBuffer()), BETA_PNG);
    assert.deepEqual(Buffer.from(await (await raw("shared.png", ids.alpha)).arrayBuffer()), ALPHA_PNG);
  });

  // openlore: scenario=UnnamedReadsTheBootProject spec=api
  test("UnnamedReadsTheBootProject: a request naming no project keeps reading the boot project", async () => {
    const unnamed = await raw("shared.png");
    assert.equal(unnamed.status, 200);
    assert.deepEqual(Buffer.from(await unnamed.arrayBuffer()), ALPHA_PNG);
    assert.equal((await raw("figures/only-beta.png")).status, 404, "another project's file is not reached by accident");
  });

  // openlore: scenario=UnopenedProjectRefused spec=api
  test("UnopenedProjectRefused: a project that is not open is refused, never opened", async () => {
    for (const named of [elsewhere, path.join(beta, "figures"), "not-a-project"]) {
      const res = await raw("shared.png", named);
      assert.equal(res.status, 404, `${named} must not be served`);
      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(body.includes(PNG_BYTES), false, `${named} leaked image bytes`);
    }
    // Confinement still applies inside a named project.
    const ids = await projectIds();
    assert.equal((await raw(`../${path.basename(alpha)}/shared.png`, ids.beta)).status, 404);
  });
});
