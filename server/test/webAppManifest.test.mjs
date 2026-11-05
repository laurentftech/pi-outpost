/**
 * What a browser has to fetch before it will offer to install the interface.
 *
 * Over a real server and the real static route: the manifest, the page that links
 * it, and every icon the manifest names. A manifest that 404s, or arrives as
 * something the browser will not read, leaves the interface looking installable in
 * its markup and not being installable in fact — and nothing reports that.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeWorkspace, startServer } from "./harness.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_DIST = path.join(REPO, "web/dist");

/**
 * The built manifest, or null when the UI has not been built here.
 *
 * Only a missing file skips. A manifest that exists and does not parse is the
 * regression these tests are for, and swallowing it would turn the failure into
 * a green run that reports nothing.
 */
async function builtManifest() {
  let source;
  try {
    source = await readFile(path.join(WEB_DIST, "manifest.webmanifest"), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(source);
}

async function serve(t) {
  const root = await makeWorkspace({ "readme.md": "# workspace\n" });
  const server = await startServer(root, {});
  t.after(() => server.stop());
  return server;
}

test("the page links a manifest, and the manifest is served as one", async (t) => {
  const manifest = await builtManifest();
  if (!manifest) return t.skip("web/dist not built here");
  const server = await serve(t);

  const page = await fetch(server.base + "/");
  const html = await page.text();
  assert.match(html, /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);

  const served = await fetch(server.base + "/manifest.webmanifest");
  assert.equal(served.status, 200);
  // Not `application/octet-stream`: a browser ignores a manifest it is handed as
  // an opaque stream, and the install offer simply never appears.
  assert.match(served.headers.get("content-type") ?? "", /manifest\+json|application\/json/);
  const body = await served.json();
  assert.equal(body.display, "standalone");
  assert.equal(body.start_url, "/");
  assert.ok(body.name && body.short_name, "an installed app needs a name to be shown under");
});

test("every icon the manifest names is actually served", async (t) => {
  const manifest = await builtManifest();
  if (!manifest) return t.skip("web/dist not built here");
  const server = await serve(t);

  // Driven off the manifest itself rather than a list kept here: an icon added to
  // the manifest and not to the build is exactly the failure this catches.
  assert.ok(manifest.icons.length > 0, "a manifest with no icons is not installable");
  for (const icon of manifest.icons) {
    assert.equal(typeof icon.src, "string");
    assert.match(icon.src, /^\/(?!\/)/, "an icon must be served by this app, not another host");
    const target = new URL(icon.src, server.base);
    assert.equal(target.origin, new URL(server.base).origin, "an icon must stay on this app's origin");
    const response = await fetch(target);
    assert.equal(response.status, 200, `${icon.src} is declared and not served`);
    assert.match(response.headers.get("content-type") ?? "", /^image\//, `${icon.src} is not served as an image`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0, `${icon.src} is empty`);
  }
});

test("the icon set covers what an installed app is presented at", async (t) => {
  const manifest = await builtManifest();
  if (!manifest) return t.skip("web/dist not built here");

  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192"), "192 is the size a launcher asks for");
  assert.ok(sizes.includes("512x512"), "512 is the size a splash and a store listing ask for");
  // Without one declared maskable, a platform that crops to its own shape cuts
  // into artwork drawn for a square.
  assert.ok(
    manifest.icons.some((icon) => (icon.purpose ?? "").split(/\s+/).includes("maskable")),
    "no maskable icon is declared",
  );
});
