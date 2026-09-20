/**
 * What lets an extension reach the agent's own packages inside an executable.
 *
 * There are no node_modules beside a single-file executable, so an extension that
 * imports `typebox` or `@earendil-works/pi-coding-agent` has nothing on disk to
 * resolve. jiti's `virtualModules` answers those specifiers with module objects that
 * are already in the bundle, and the SDK already builds that map — it originally
 * selected it on `isBunBinary` alone, which a Node SEA is not, so both build scripts
 * patched that one condition by hand.
 *
 * pi-coding-agent#8237 fixed the same gap upstream, landing in 0.84.3, and 0.86.0
 * moved the same condition into a named `usesEmbeddedModules`. Both build scripts
 * detect either shape and no-op rather than patch, through the one predicate in
 * scripts/sea-jiti-shape.mjs that this suite reads too. It asserts against the SDK
 * *as installed*, so an SDK upgrade that moves the anchors again fails here — in a
 * suite that runs on every push — rather than at release time, or worse, in an
 * executable where extension loading is quietly dead.
 *
 * The end-to-end proof cannot live here: it needs Node >= 26, a full SEA build of
 * several minutes, and a runtime whose single-executable support works. It was run
 * by hand, and what it printed is in the commit that introduced this.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { PRE_8237_BRANCH, upstreamHandlesSea } from "../../scripts/sea-jiti-shape.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const LOADER = path.join(REPO, "node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js");

/** The branch a Node SEA needed patched by hand, before pi-coding-agent#8237. */
const OLD_BRANCH = PRE_8237_BRANCH;

describe("the SDK's SEA handling, as installed", () => {
  test("the loader selects jiti's virtual modules for a Node SEA — by hand, or natively since #8237", () => {
    const loader = readFileSync(LOADER, "utf8");
    // The bundled form differs from the source only in whitespace; both scripts
    // patch the bundled one, so this checks what is actually there to match against.
    const hasEither = loader.includes(OLD_BRANCH) || upstreamHandlesSea(loader);
    assert.ok(hasEither, "neither the pre-#8237 branch nor its upstream fix is present — both build patches would miss");
  });

  test("pre-#8237: isBunBinary alone gates the branch", () => {
    const loader = readFileSync(LOADER, "utf8");
    if (upstreamHandlesSea(loader)) return; // upstream already handles it — covered by the next test instead
    assert.match(loader, /isBunBinary\s*\?\s*\{\s*virtualModules:\s*VIRTUAL_MODULES,\s*tryNative:\s*false\s*\}/);
  });

  test("since #8237: isNodeSeaBinary asks node:sea for real, not a name that happens to say so", () => {
    const loader = readFileSync(LOADER, "utf8");
    if (!upstreamHandlesSea(loader)) return; // older SDK — the hand-written patch covers it instead
    assert.match(loader, /isNodeSeaBinary\s*=[^;]*node:sea/);
  });

  test("virtual modules carry the packages an extension would import", () => {
    const loader = readFileSync(LOADER, "utf8");
    for (const specifier of ["typebox", "@earendil-works/pi-tui", "@earendil-works/pi-coding-agent"]) {
      assert.ok(loader.includes(`"${specifier}"`), `${specifier} is no longer offered to extensions`);
    }
  });

  test("getAliases still resolves through the filesystem, which is why it cannot answer inside an executable", () => {
    // If this ever stops being true, the patch is solving a problem that moved.
    const loader = readFileSync(LOADER, "utf8");
    assert.match(loader, /function getAliases\(\)/);
    assert.match(loader, /require\.resolve\("typebox"\)/);
  });
});

describe("both build scripts handle either SDK shape", () => {
  const scripts = [
    path.join(REPO, "server/scripts/build-sea.mjs"),
    // Two bundles produce an executable — the blob and the one `--build-sea` reads.
    // Patching one leaves extensions working on whichever path a machine took.
    path.join(REPO, "cli/scripts/build.mjs"),
  ];

  for (const script of scripts) {
    test(`${path.relative(REPO, script)} patches the pre-#8237 branch, recognises the fixed one, and refuses to run silently if neither is there`, () => {
      const source = readFileSync(script, "utf8");
      assert.match(source, /PRE_8237_BRANCH/, "no longer anchors on the pre-#8237 shape");
      assert.match(source, /sea-jiti-shape\.mjs/, "no longer shares the shape predicate, so the two scripts can drift apart");
      assert.match(source, /upstreamHandlesSea\(/, "no longer recognises an SDK that handles a Node SEA itself");
      assert.match(source, /__piOutpostIsSea\(\)/);
      assert.match(source, /node:sea/);
      // A patch that finds neither shape must stop the build, not produce an
      // executable whose extensions cannot import anything.
      assert.match(source, /throw new Error\(.*jiti branch moved/);
    });
  }
});

describe("what a built bundle carries", () => {
  const bundles = [path.join(REPO, "server/dist/bundle.mjs"), path.join(REPO, "cli/dist/pi-outpost.sea.mjs")];
  const upstreamFixed = upstreamHandlesSea(readFileSync(LOADER, "utf8"));

  for (const bundle of bundles) {
    test(`${path.relative(REPO, bundle)} takes the working branch for a Node SEA, patched or native`, (t) => {
      // Skipped rather than failed where nothing has been built: this suite runs
      // on a checkout with no dist/, and a red test there would say nothing true.
      if (!existsSync(bundle)) return t.skip("not built here");
      const built = readFileSync(bundle, "utf8");
      if (upstreamFixed) {
        // The build scripts detect this and no-op — the SDK's own fix should be
        // inlined verbatim, and the hand patch's helper should not appear at all.
        assert.ok(upstreamHandlesSea(built), "the bundle does not carry the SDK's own SEA detection");
        assert.doesNotMatch(built, /function __piOutpostIsSea\(\)/);
      } else {
        assert.match(built, /isBunBinary \|\| __piOutpostIsSea\(\)/);
        assert.match(built, /function __piOutpostIsSea\(\)/);
      }
    });
  }
});
