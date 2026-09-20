/**
 * How the SDK's extension loader decides to serve jiti's virtual modules — the one
 * condition an executable's extensions depend on.
 *
 * There are no node_modules beside a single-file executable, so an extension that
 * imports `typebox` or the SDK itself has nothing on disk to resolve. jiti's
 * `virtualModules` answers those specifiers from objects already inside the bundle.
 * The SDK originally selected that on `isBunBinary` alone, which a Node SEA is not,
 * so both build scripts patched the condition by hand.
 *
 * pi-coding-agent 0.84.3 fixed it upstream (earendil-works/pi#8237) and 0.86.0 moved
 * the same condition out of the ternary into a named `usesEmbeddedModules`. Either
 * way the build scripts have nothing to patch — but "nothing to patch" and "the
 * anchor moved" must never be confused, so the shapes are recognised here, once, and
 * both build scripts and the suite that guards them read the same answer.
 */

/** The branch a Node SEA needed patched by hand, before pi#8237. */
export const PRE_8237_BRANCH = "...isBunBinary ? { virtualModules: VIRTUAL_MODULES, tryNative: false }";

/** pi#8237's shape: the ternary itself asks whether this is a Node SEA. */
const FIXED_TERNARY =
  /isBunBinary\s*\|\|\s*isNodeSeaBinary\s*\|\|\s*isBundledNode\s*\?\s*\{\s*virtualModules:\s*VIRTUAL_MODULES,\s*tryNative:\s*false\s*\}/;

/** 0.86.0's shape: a named flag raised for a SEA, and the branch that reads it. */
const EMBEDDED_MODULES_FLAG = /usesEmbeddedModules\s*=\s*isBunBinary\s*\|\|\s*isNodeSeaBinary\s*\|\|\s*isBundledNode/;
const EMBEDDED_MODULES_BRANCH =
  /usesEmbeddedModules\s*\?\s*\{\s*virtualModules:\s*await\s+getVirtualModules\(\),\s*tryNative:\s*false\s*\}/;

/**
 * Whether the SDK selects virtual modules for a Node SEA on its own. Both halves of
 * the 0.86.0 shape are required: a flag nothing reads, or a branch nothing raises,
 * is drift — and drift must throw rather than produce an executable whose extensions
 * cannot import anything.
 */
export function upstreamHandlesSea(source) {
  if (FIXED_TERNARY.test(source)) return true;
  return EMBEDDED_MODULES_FLAG.test(source) && EMBEDDED_MODULES_BRANCH.test(source);
}
