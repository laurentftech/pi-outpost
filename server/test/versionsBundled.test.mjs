/**
 * What a build says is answering prompts, once the source is behind it.
 *
 * `__PI_SDK_VERSION__` is substituted at bundle time, and a source run is exactly the
 * shape that define is absent from — so no test of a source run can observe it. These
 * bundle the real `server/src/index.ts` in the two shapes the project ships, start each
 * one, and read the version off the wire.
 *
 * The no-externals shape is also the only way to reach the failure the contract cares
 * about most: bundled with every dependency inlined and dropped somewhere with no
 * `node_modules` above it, the server runs perfectly well and cannot resolve the SDK to
 * read its version — which is a self-contained executable's situation exactly, and the
 * one where inventing a plausible number would do real harm.
 *
 * The executable itself is one wrapper further out and cannot be built here: it needs
 * Node >= 26 and several minutes. What the SEA adds over this bundle is postject and a
 * blob, not another chance to substitute a version.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import esbuild from "esbuild";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { UNKNOWN_VERSION } from "../src/piSdkVersion.ts";

const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
// A bundle that leaves fastify and the SDK external resolves them by walking up from
// the *file*, so it has to sit inside the repo. `node_modules/.cache` is git-ignored.
const CACHE = fileURLToPath(new URL("../../node_modules/.cache", import.meta.url));

/** Deliberately unlike any real version, so a fallback cannot pass for the define. */
const SDK_SENTINEL = "424.242.42-sdk-from-the-bundle";
const OUTPOST_SENTINEL = "424.242.42-outpost-from-the-bundle";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(inRepo) {
  if (inRepo) await mkdir(CACHE, { recursive: true });
  const dir = await mkdtemp(path.join(inRepo ? CACHE : tmpdir(), "pi-outpost-bundle-"));
  dirs.push(dir);
  return dir;
}

/**
 * Bundles the server. `externals` mirrors `cli/scripts/build.mjs`'s npm package; without
 * it this is the shape `build-sea.mjs` embeds. `defines` off leaves the version
 * placeholders as free identifiers, which is what an unsubstituted build would ship.
 */
async function bundleServer({ externals, defines = true }) {
  const outfile = path.join(await scratch(externals), "pi-outpost.mjs");
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: "node",
    format: "esm",
    target: externals ? "node22" : "node26",
    outfile,
    external: externals
      ? ["@earendil-works/pi-coding-agent", "@fastify/static", "@fastify/websocket", "fastify", "node-pty", "ws"]
      : [],
    ...(defines
      ? {
          define: {
            __PI_OUTPOST_VERSION__: JSON.stringify(OUTPOST_SENTINEL),
            __PI_SDK_VERSION__: JSON.stringify(SDK_SENTINEL),
          },
        }
      : {}),
    banner: {
      js: "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);",
    },
  });
  return outfile;
}

/** Starts a bundled server and returns the `versions` bag from its snapshot. */
async function versionsFromBundle(entry) {
  const server = await startServer(await makeWorkspace(), {}, { entry });
  try {
    const client = connect(server.wsUrl());
    await client.open();
    const hello = await client.waitFor("hello");
    client.close();
    return (hello.state ?? hello).versions;
  } finally {
    await server.stop();
  }
}

// openlore: scenario=ADistributedBuildNamesItsSdk spec=api
test("the npm bundle names the SDK built into it, not the one it could read from disk", async () => {
  const versions = await versionsFromBundle(await bundleServer({ externals: true }));
  assert.equal(
    versions.piSdk,
    SDK_SENTINEL,
    "the build-time define must win — a distributed build has no node_modules of ours to read instead",
  );
  assert.equal(versions.piOutpost, OUTPOST_SENTINEL, "and the two defines must not be crossed");
});

// openlore: scenario=ADistributedBuildNamesItsSdk spec=api
test("the bundle an executable embeds names it too, with every dependency inlined", async () => {
  // Not the same build as the one above: no externals, a later target, and it runs from
  // outside the repo — so nothing it reports can have come from resolving our tree.
  const versions = await versionsFromBundle(await bundleServer({ externals: false }));
  assert.equal(versions.piSdk, SDK_SENTINEL);
  assert.equal(versions.piOutpost, OUTPOST_SENTINEL);
});

// openlore: scenario=AnUnreadableVersionIsNotInvented spec=api
test("a build with no version substituted says so rather than naming one it did not establish", async () => {
  const versions = await versionsFromBundle(await bundleServer({ externals: false, defines: false }));
  assert.equal(
    versions.piSdk,
    UNKNOWN_VERSION,
    "a server that cannot resolve the SDK must not report a version it never read",
  );
  assert.equal(versions.piOutpost, UNKNOWN_VERSION);
});
