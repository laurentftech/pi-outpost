#!/usr/bin/env node
/**
 * Guard against a stylesheet that builds cleanly and styles nothing.
 *
 * v0.6.6 shipped an unstyled interface. Tailwind's only scan root was web/src,
 * which stopped holding components when they moved to the ui workspace, so it
 * emitted no utilities at all. Every gate we had stayed green: typecheck, lint,
 * 265 server tests, 203 UI tests — none of them look at the CSS that comes out
 * of the build, and the tests render components in jsdom, where an absent
 * stylesheet is invisible.
 *
 * So this checks the artifact itself: after a build, do utilities that can only
 * come from ui/src actually appear in the emitted CSS?
 *
 * Run after `npm run build --workspace web`.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(ROOT, "web/dist/assets");
/**
 * embed inlines its CSS into the JS bundle — there is no .css file to read — and
 * it is a published package too. It was equally unstyled in 0.6.6, so checking
 * only web/dist would have missed half the damage. Rules are matched as `.cls{`
 * here: the bundle also contains the JSX class strings, which would match a bare
 * substring whether or not Tailwind emitted anything.
 */
const EMBED_BUNDLE = path.join(ROOT, "embed/dist/pi-outpost-embed.js");

/**
 * Utilities used by ui/src components and by nothing in web/src. Any one of
 * them missing means the ui workspace was not scanned.
 *
 * If a legitimate refactor removes one of these classes from the codebase, the
 * fix is to swap it for another utility that ui/src still uses — not to delete
 * the check. Keep them boring and structural.
 */
const EXPECTED = [
  { cls: "rotate-90", where: "ui/src/components/ModelBar.tsx (context ring)" },
  { cls: "shrink-0", where: "ui/src/components/ModelBar.tsx (context ring)" },
  { cls: "max-w-64", where: "ui/src/components/ModelBar.tsx (model select)" },
];

const fail = (message) => {
  console.error(`[check-web-css] ${message}`);
  process.exit(1);
};

const entries = await readdir(ASSETS).catch(() => {
  fail(`no build output at ${ASSETS} — run "npm run build --workspace web" first`);
});

const sheets = entries.filter((name) => name.endsWith(".css"));
if (sheets.length === 0) fail(`no stylesheet in ${ASSETS} — the build emitted none`);

const css = (await Promise.all(sheets.map((name) => readFile(path.join(ASSETS, name), "utf8")))).join("\n");

const missing = EXPECTED.filter(({ cls }) => !css.includes(cls));
if (missing.length > 0) {
  console.error(`[check-web-css] the built stylesheet is missing utilities that ui/src uses:\n`);
  for (const { cls, where } of missing) console.error(`  .${cls}  — from ${where}`);
  console.error(
    `\nTailwind is not scanning the ui workspace. Check the @source directives in` +
      ` web/src/index.css; without them the app renders unstyled (see #38).` +
      `\nIf one of these classes was legitimately removed from the code, replace it` +
      ` in scripts/check-web-css.mjs with another utility ui/src still uses.`,
  );
  process.exit(1);
}

console.log(`[check-web-css] web: ${sheets.length} stylesheet(s), ${css.length} bytes, ${EXPECTED.length} utilities present`);

// embed is checked only when it has been built; `npm run build` builds both, but
// a web-only build should not fail here.
const bundle = await readFile(EMBED_BUNDLE, "utf8").catch(() => undefined);
if (bundle === undefined) {
  console.log(`[check-web-css] embed: no bundle at ${path.relative(ROOT, EMBED_BUNDLE)} — skipped`);
} else {
  const missingRules = EXPECTED.filter(({ cls }) => !bundle.includes(`.${cls}{`) && !bundle.includes(`.-${cls}{`));
  if (missingRules.length > 0) {
    console.error(`[check-web-css] the embed bundle carries no CSS rule for:\n`);
    for (const { cls, where } of missingRules) console.error(`  .${cls}  — from ${where}`);
    console.error(
      `\nembed inlines this stylesheet, so it is unstyled for every consumer of the` +
        ` widget. Same cause and same fix as the web check above.`,
    );
    process.exit(1);
  }
  console.log(`[check-web-css] embed: ${EXPECTED.length} utility rules present in the inlined CSS`);
}
