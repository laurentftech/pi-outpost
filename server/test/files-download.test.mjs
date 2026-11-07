/**
 * GET /files/download — a workspace file as itself, a folder or a selection as one
 * zip. Confinement and authentication are the properties that matter, then that the
 * bytes and the names arrive exactly; the archive is read back with JSZip, which
 * checks every CRC.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import JSZip from "jszip";
import { makeWorkspace, startServer } from "./harness.mjs";

const TOKEN = "test-token-files-download";

describe("GET /files/download", () => {
  const big = randomBytes(20 * 1024 * 1024);
  let open;
  let guarded;
  let sandboxed;
  let secretPath;
  let symlinksAvailable = false;

  const url = (server, paths, extra = "") =>
    `${server.base}/files/download?${[].concat(paths).map((p) => `path=${encodeURIComponent(p)}`).join("&")}${extra}`;

  before(async () => {
    const files = {
      "reports/q3 résumé.pdf": big,
      "reports/notes.md": "# notes\n",
      "reports/deep/memo.txt": "memo",
      "a.txt": "a",
      "img/logo.png": "logo",
      "other/notes.md": "other notes",
      "workspace/inside.txt": "inside",
      "reference.txt": "read-only",
    };
    const openRoot = await makeWorkspace(files);
    await mkdir(path.join(openRoot, "reports", "empty"), { recursive: true });
    secretPath = path.join(path.dirname(openRoot), `secret-${Date.now()}.txt`);
    await writeFile(secretPath, "SECRET");
    try {
      await symlink(secretPath, path.join(openRoot, "reports", "escape.txt"));
      symlinksAvailable = true;
    } catch {
      symlinksAvailable = false;
    }
    open = await startServer(openRoot);
    guarded = await startServer(await makeWorkspace(files), { server: { token: TOKEN } });
    const sandboxRoot = await makeWorkspace(files);
    sandboxed = await startServer(sandboxRoot, {
      sandbox: { root: sandboxRoot, allowWrite: true, writableRoot: path.join(sandboxRoot, "workspace"), allowBash: false },
    });
  });
  after(async () => {
    await open?.stop();
    await guarded?.stop();
    await sandboxed?.stop();
  });

  test("DownloadAWorkspaceFile: the exact bytes, as an attachment under its own name", async () => {
    const res = await fetch(url(open, "reports/q3 résumé.pdf"));

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const disposition = res.headers.get("content-disposition");
    assert.match(disposition, /^attachment; /);
    assert.match(disposition, /filename\*=UTF-8''q3%20r%C3%A9sum%C3%A9\.pdf/);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(big));
  });

  test("DownloadAFolderAsAZip: entries under the folder's name, bytes intact, empty folders kept", async () => {
    const res = await fetch(url(open, "reports"));

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.match(res.headers.get("content-disposition"), /filename="reports\.zip"/);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()), { checkCRC32: true });
    assert.ok(zip.files["reports/"].dir);
    assert.ok(zip.files["reports/empty/"].dir);
    assert.equal(await zip.file("reports/deep/memo.txt").async("string"), "memo");
    assert.ok(Buffer.from(await zip.file("reports/q3 résumé.pdf").async("uint8array")).equals(big));
  });

  test("DownloadSeveralEntriesAsOneZip: one archive with each entry at its top level, clashing names told apart", async () => {
    const res = await fetch(url(open, ["a.txt", "reports/deep", "img/logo.png", "reports/notes.md", "other/notes.md"]));

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /filename="files\.zip"/);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()), { checkCRC32: true });
    assert.deepEqual(
      Object.keys(zip.files).sort(),
      ["a.txt", "deep/", "deep/memo.txt", "logo.png", "notes (2).md", "notes.md"],
    );
    assert.equal(await zip.file("notes.md").async("string"), "# notes\n");
    assert.equal(await zip.file("notes (2).md").async("string"), "other notes");
  });

  test("AnEscapingLinkIsLeftOut: the archive holds no outside byte and says how many were left out", async (t) => {
    if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
    const res = await fetch(url(open, "reports"));
    const bytes = Buffer.from(await res.arrayBuffer());

    assert.equal(res.headers.get("x-pi-outpost-skipped"), "1");
    assert.ok(!bytes.includes(Buffer.from("SECRET")));
    const zip = await JSZip.loadAsync(bytes);
    assert.equal(zip.files["reports/escape.txt"], undefined);
    assert.match(zip.comment, /^1 entry was left out/);
  });

  test("DownloadIsAuthenticated: no token, or a wrong one, gets no byte", async () => {
    for (const extra of ["", "&token=wrong"]) {
      const res = await fetch(url(guarded, "a.txt", extra));
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "unauthorized" }, "a refusal carries nothing of the file");
    }
    const ok = await fetch(url(guarded, "a.txt", `&token=${TOKEN}`));
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "a");
  });

  test("DownloadIsAuthenticated: a token-less server refuses a foreign Host", async () => {
    const status = (host) =>
      new Promise((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port: open.port, path: "/files/download?path=a.txt", headers: { host } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on("error", reject);
        req.end();
      });
    assert.equal(await status("evil.example:80"), 403);
    assert.equal(await status(`127.0.0.1:${open.port}`), 200);
  });

  test("DownloadIsConfined: traversal, absolute, escaping link and missing paths are refused", async () => {
    const targets = ["../secret.txt", secretPath, "missing.txt", ...(symlinksAvailable ? ["reports/escape.txt"] : [])];
    for (const target of targets) {
      const res = await fetch(url(open, target));
      assert.ok(res.status === 403 || res.status === 404, `${target} answered ${res.status}`);
      assert.ok(!(await res.text()).includes("SECRET"), `${target} leaked content`);
    }
    const mixed = await fetch(url(open, ["a.txt", "../secret.txt"]));
    assert.equal(mixed.status, 403, "one escaping path refuses the whole archive");
  });

  test("DownloadAReadOnlyFile: a file outside the writable zone is served", async () => {
    const res = await fetch(url(sandboxed, "reference.txt"));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "read-only");
  });

  test("a request without a path is refused", async () => {
    const res = await fetch(`${open.base}/files/download`);
    assert.equal(res.status, 400);
  });
});
