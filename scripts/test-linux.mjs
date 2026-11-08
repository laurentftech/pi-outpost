#!/usr/bin/env node
/**
 * Run the server suite on Linux, as a non-root user, the way CI does.
 *
 * There is one class of bug this repository cannot see from a developer's machine,
 * and it does not fail loudly — it fails *silently green*. A test that asserts
 * "this path cannot be written" by naming `/proc/...` passes on macOS and Windows
 * because there is no `/proc` to reach, and on Linux the write never returns. The
 * suite then prints every test as passing and produces no summary at all, because a
 * test file that never exits never reports. That cost four CI rounds and three
 * commits that fixed the wrong thing; a container named the file on its first run.
 *
 * Two details are what make this worth running rather than decorative:
 *
 * - **Non-root.** GitHub's runners are not root, and root is not a stricter test —
 *   it is a weaker one. As root, every "refuses an unwritable path" assertion in
 *   this repository passes for the wrong reason, including the one that was broken.
 * - **Cached dependencies.** `npm ci` is most of the wall time, so it runs only when
 *   `package-lock.json` has actually changed. Without that this takes six minutes and
 *   nobody runs it.
 *
 * What this is not: `ubuntu-latest`. It is `node:24-bookworm` — the same major Node
 * and the same kernel interfaces, which is what the failing class depends on, but not
 * a byte-for-byte runner image.
 *
 * What runs by default is the ubuntu leg's server step — every suite, instrumented, then
 * the coverage report and its thresholds — with CI=true, as the runner sets it. It is not
 * `npm test` with a report on top: the servers the integration suites start write their
 * own coverage, wait longer to stop and have their files cut down, and `main` once went
 * red on a coverage run with every test passing. That step is ubuntu-only on CI, so it is
 * only reachable from here.
 *
 * Usage:
 *   npm run test:linux                    # the server step, as the ubuntu leg runs it
 *   npm run test:linux -- --shell         # a shell in the same container, to poke about
 *   npm run test:linux -- npm test --workspace server   # one step, when iterating
 *   npm run test:linux -- --fresh         # ignore the dependency cache
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const IMAGE = "node:24-bookworm";
const VOLUME = "pi-outpost-linux-deps";

const argv = process.argv.slice(2);
const fresh = argv.includes("--fresh");
const shell = argv.includes("--shell");
const rest = argv.filter((arg) => arg !== "--fresh" && arg !== "--shell");
// The ubuntu leg of CI: every server suite, instrumented, reported over the inventory.
const DEFAULT_COMMAND = "npm run test:coverage --workspace server";
const command = rest.length > 0 ? rest.join(" ") : DEFAULT_COMMAND;

const die = (message, detail) => {
  console.error(`[test-linux] ${message}`);
  if (detail) console.error(`\n${detail}`);
  process.exit(1);
};

if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  die(
    "docker is not available (or its daemon is not running).",
    "This is the one check that cannot be done from macOS: it needs a Linux kernel.\n" +
      "Start Docker Desktop, or run the suite on CI and read the job log instead.",
  );
}

// The lock file decides whether the cached dependencies are still the right ones.
// Anything else — a source edit, a new test — costs nothing and reuses them.
const lockHash = createHash("sha256").update(readFileSync(path.join(ROOT, "package-lock.json"))).digest("hex");

/**
 * Everything below runs inside the container.
 *
 * The source tree is copied in rather than mounted read-write, so a run cannot write
 * back into the working tree — a Linux `node_modules` landing in a macOS checkout is
 * a mess to notice and a worse one to undo. `node_modules` is the exception: it is a
 * named volume, which is what makes a second run fast.
 */
const script = `
set -euo pipefail

echo "[test-linux] copying the working tree (node_modules excluded) …"
mkdir -p /w
cd /src
tar cf - --exclude=./node_modules --exclude=./.git --exclude='*/node_modules' . | (cd /w && tar xf -)
cd /w
# the pinned npm, verified against its lockfile hash (docs/development.md#the-pinned-npm)
npm ci --prefix /w/tools/npm --no-audit --no-fund
export PATH=/w/tools/npm/node_modules/.bin:$PATH

STAMP=/w/node_modules/.pi-outpost-lock-hash
if [ "${fresh ? "1" : "0"}" = "1" ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "${lockHash}" ]; then
  echo "[test-linux] package-lock.json changed (or --fresh) — installing dependencies …"
  npm ci --no-audit --no-fund
  echo "${lockHash}" > "$STAMP"
else
  echo "[test-linux] dependencies are current for this lock file — reusing them"
fi

# Not root. As root the "refuses an unwritable path" tests pass for the wrong reason,
# which is exactly how the bug this exists for stayed invisible.
id -u runner >/dev/null 2>&1 || useradd -m runner
chown -R runner /w

echo "[test-linux] running as: ${shell ? "an interactive shell" : command}"
# CI=true is set the way the runner sets it: some code declines to open a browser
# under it, and some tests assert exactly that.
${
  shell
    ? `exec su runner -s /bin/bash -c ${JSON.stringify("export CI=true; cd /w; exec bash")}`
    : `su runner -s /bin/bash -c ${JSON.stringify(`cd /w && export CI=true && ${command}`)}`
}
`;

const args = [
  "run",
  "--rm",
  ...(shell ? ["-it"] : []),
  "-v",
  `${ROOT}:/src:ro`,
  "-v",
  `${VOLUME}:/w/node_modules`,
  "-w",
  "/w",
  IMAGE,
  "bash",
  "-c",
  script,
];

const started = Date.now();
const run = spawnSync("docker", args, { stdio: "inherit" });
const seconds = Math.round((Date.now() - started) / 1000);

if (run.status === 0) {
  console.log(`\n[test-linux] passed on Linux, as a non-root user (${seconds}s)`);
  process.exit(0);
}

// 124 is `timeout`'s; a suite that hangs is the failure mode this exists for, so it
// gets its own sentence rather than an exit code nobody recognises.
if (run.status === 124) {
  die(
    `the suite hung on Linux and was killed (${seconds}s).`,
    "A test file that never exits never reports, so the runner will have printed every\n" +
      "test as passing and no summary. The culprit is NOT the last file listed — that is\n" +
      "merely the last one that finished. Narrow it by running one step at a time:\n" +
      "  npm run test:linux -- npm test --workspace server",
  );
}

die(`failed on Linux (exit ${run.status}, ${seconds}s).`, "The output above is the container's, verbatim.");
