/**
 * The TypeScript test suites `npm run typecheck` covers, and the two questions asked of
 * each: which test files does git track for it, and which does its configuration really
 * type-check. A file in the first set and not the second is a test CI runs unchecked.
 *
 * Shared by scripts/test-typecheck.test.mjs. The compiler is run through `node` and
 * `require.resolve("typescript/bin/tsc")`, never `npx`, so it spawns the same way on
 * Windows, where `npx` is a batch file `spawnSync` cannot run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");

/**
 * Each suite: the configuration that checks it, the git pathspecs of its test sources,
 * the directory a probe test file is written to, and the script that runs it in
 * `npm run typecheck` (the workspace or root `package.json`, and the text it must hold).
 */
export const SUITES = [
  {
    name: "ui",
    config: "ui/tsconfig.json",
    tracked: [":(glob)ui/src/**/*.test.ts", ":(glob)ui/src/**/*.test.tsx"],
    probeDir: "ui/src",
    probeSuffix: ".test.ts",
    script: { packageJson: "ui/package.json", typecheck: "tsc --noEmit" },
  },
  {
    name: "server",
    config: "server/tsconfig.test.json",
    tracked: [":(glob)server/test/**/*.ts"],
    probeDir: "server/test",
    probeSuffix: ".test.ts",
    script: { packageJson: "server/package.json", typecheck: "tsc --noEmit -p tsconfig.test.json" },
  },
  {
    name: "e2e",
    config: "e2e/tsconfig.json",
    tracked: [":(glob)e2e/**/*.ts", ":(glob)e2e/**/*.tsx"],
    probeDir: "e2e",
    probeSuffix: ".spec.ts",
    script: { packageJson: "package.json", typecheck: "tsc -p e2e" },
  },
];

/** A repository-relative path with forward slashes, whatever the platform printed. */
export function repoPath(file) {
  return path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join("/");
}

/** Run the TypeScript compiler from the repository root. */
export function tsc(args) {
  const result = spawnSync(process.execPath, [TSC, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Every file a configuration type-checks, repository-relative. */
export function checkedFiles(config) {
  const { status, output } = tsc(["-p", config, "--listFilesOnly"]);
  if (status !== 0) throw new Error(`tsc --listFilesOnly -p ${config} failed:\n${output}`);
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(repoPath),
  );
}

/** The test sources git tracks for a suite. */
export function trackedFiles(suite) {
  const output = execFileSync("git", ["ls-files", "--", ...suite.tracked], { cwd: ROOT, encoding: "utf8" });
  return output.split(/\r?\n/).filter(Boolean).map(repoPath);
}

/** Tracked test sources the configuration leaves unchecked. */
export function uncheckedFiles(suite, config = suite.config) {
  const checked = checkedFiles(config);
  return trackedFiles(suite).filter((file) => !checked.has(file));
}
