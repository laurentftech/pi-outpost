/**
 * The build's decisions, without running a build.
 *
 * Everything asserted here is a detail whose absence produced a failure nobody could
 * read: a BOM at byte zero, a missing module format, a Windows file the loader will
 * not execute, a path silently overwritten.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  BuildExeError,
  carriesSeaSentinel,
  SEA_SENTINEL_FUSE,
  producedExecutableRuns,
  buildExecutable,
  canBuildDirectly,
  executableName,
  majorOf,
  releaseArtifactName,
  seaConfigBytes,
  seaConfigFor,
  findBuildInputs,
  placeMxcExecutor,
  resignMacho,
} from "../src/buildExe.ts";

describe("the generated SEA config", () => {
  test("declares the module format the bundle needs", () => {
    // Without it Node loads an ESM bundle as CommonJS and it dies on its first import
    assert.equal(seaConfigFor("/x/bundle.mjs", "/x/out").mainFormat, "module");
  });

  test("is written as UTF-8 with no byte order mark", () => {
    // PowerShell's Out-File -Encoding utf8 adds one, and Node's JSON parser dies on
    // byte zero of a file that looks perfect in an editor. This is that bug's test.
    const bytes = seaConfigBytes(seaConfigFor("/x/bundle.mjs", "/x/out"));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(bytes[0], "{".charCodeAt(0));
    assert.deepEqual(JSON.parse(bytes.toString("utf8")).main, "/x/bundle.mjs");
  });

  test("silences the experimental warning, which is not news to anyone running this", () => {
    assert.equal(seaConfigFor("/x/bundle.mjs", "/x/out").disableExperimentalSEAWarning, true);
  });
});

describe("build inputs in a checkout", () => {
  test("prefers the freshly-built server bundle over a stale published CLI bundle", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pi-outpost-build-inputs-"));
    try {
      const source = path.join(dir, "server", "src");
      const serverDist = path.join(dir, "server", "dist");
      const cliDist = path.join(dir, "cli", "dist");
      mkdirSync(source, { recursive: true });
      mkdirSync(serverDist, { recursive: true });
      mkdirSync(cliDist, { recursive: true });
      writeFileSync(path.join(serverDist, "bundle.mjs"), "fresh");
      writeFileSync(path.join(serverDist, "sea-prep.blob"), "fresh blob");
      writeFileSync(path.join(cliDist, "pi-outpost.sea.mjs"), "stale");
      writeFileSync(path.join(cliDist, "sea-prep.blob"), "stale blob");

      assert.deepEqual(findBuildInputs(source), {
        bundle: path.join(serverDist, "bundle.mjs"),
        blob: path.join(serverDist, "sea-prep.blob"),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("what the platform will execute", () => {
  test("Windows gets the suffix its loader requires", () => {
    assert.equal(executableName("pi-outpost", "win32"), "pi-outpost.exe");
  });

  test("everywhere else does not", () => {
    assert.equal(executableName("pi-outpost", "darwin"), "pi-outpost");
    assert.equal(executableName("pi-outpost", "linux"), "pi-outpost");
  });

  test("a release artifact names the platform it is for", () => {
    // So that which file to download is legible without reading documentation
    assert.equal(releaseArtifactName("0.10.0", "darwin", "arm64"), "pi-outpost-0.10.0-macos-arm64");
    assert.equal(releaseArtifactName("0.10.0", "linux", "x64"), "pi-outpost-0.10.0-linux-x64");
    assert.equal(releaseArtifactName("0.10.0", "win32", "x64"), "pi-outpost-0.10.0-windows-x64.exe");
  });
});

describe("which build path is available", () => {
  test("--build-sea needs Node 26", () => {
    assert.equal(canBuildDirectly("v26.0.0"), true);
    assert.equal(canBuildDirectly("v28.3.1"), true);
    assert.equal(canBuildDirectly("v24.9.0"), false);
    assert.equal(majorOf("v24.9.0"), 24);
  });
});

describe("refusing rather than shipping something broken", () => {
  const withTempDir = (body: (dir: string) => void) => {
    const dir = mkdtempSync(path.join(tmpdir(), "pi-outpost-buildexe-"));
    try {
      body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("an existing file is left alone, and the option that would replace it is named", () => {
    withTempDir((dir) => {
      const target = path.join(dir, "pi-outpost");
      writeFileSync(target, "not an executable");
      assert.throws(
        () => buildExecutable({ out: target, cwd: dir }),
        (error: unknown) => error instanceof BuildExeError && /--force/.test((error as Error).message),
      );
      // and it really is untouched
      assert.equal(readFileSync(target, "utf8"), "not an executable");
    });
  });

  test("nothing to build from is said plainly, not left as an ENOENT", () => {
    withTempDir((dir) => {
      assert.throws(
        // Inputs looked for in an empty directory: what an already-built executable
        // looks like when someone asks it to build another one. Pointed there
        // explicitly, or this repo's own cli/dist would answer and the assertion
        // would pass for a reason that has nothing to do with the message.
        () =>
          buildExecutable({
            out: path.join(dir, "pi-outpost"),
            cwd: dir,
            inputsFrom: dir,
            nodeVersion: "v26.0.0",
          }),
        (error: unknown) => error instanceof BuildExeError && /not from an executable/.test((error as Error).message),
      );
    });
  });

  test("too old a Node with no blob to fall back on names the version it needs", () => {
    withTempDir((dir) => {
      writeFileSync(path.join(dir, "pi-outpost.sea.mjs"), "// a bundle, but no blob beside it");
      assert.throws(
        () =>
          buildExecutable({
            out: path.join(dir, "pi-outpost"),
            cwd: dir,
            inputsFrom: dir,
            nodeVersion: "v24.9.0",
          }),
        (error: unknown) => error instanceof BuildExeError && /26/.test((error as Error).message),
      );
    });
  });

  test("too old a Node refuses even with a blob, rather than injecting one it will reject", () => {
    withTempDir((dir) => {
      const target = path.join(dir, "pi-outpost");
      writeFileSync(path.join(dir, "pi-outpost.sea.mjs"), "// a bundle");
      // The blob is right there, and it is still the wrong answer: it declares a module
      // format a node this old asserts on, so injecting it produces a binary that dies
      // at startup. Naming the version is the only useful thing left to say.
      writeFileSync(path.join(dir, "sea-prep.blob"), "a blob that declares mainFormat");
      assert.throws(
        () =>
          buildExecutable({
            out: target,
            cwd: dir,
            inputsFrom: dir,
            nodeVersion: "v24.9.0",
          }),
        (error: unknown) => error instanceof BuildExeError && /26/.test((error as Error).message),
      );
      // and nothing broken is left behind for someone to find and try to run
      assert.equal(existsSync(target), false);
    });
  });
});

describe("proving the result before calling it produced", () => {
  test("a runnable binary passes and its output is kept", () => {
    // node --version is the same shape as the check the build runs on its own output
    const verdict = producedExecutableRuns(process.execPath);
    assert.equal(verdict.ok, true);
    assert.match(verdict.detail, /^v\d+\./);
  });

  test("something that is not an executable fails rather than throwing", () => {
    const verdict = producedExecutableRuns(path.join(tmpdir(), "definitely-not-here-pi-outpost"));
    assert.equal(verdict.ok, false);
    assert.ok(verdict.detail.length > 0);
  });
});

describe("whether a runtime can host an injected blob", () => {
  test("a node built without single-executable support is detected, not left to postject", () => {
    // Homebrew's node@24 carries no sentinel; postject's own message for that reads
    // like a corrupt download rather than an unsupported runtime.
    assert.equal(typeof carriesSeaSentinel(process.execPath), "boolean");
  });

  test("a file with no sentinel in it answers false", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pi-outpost-sentinel-"));
    try {
      const plain = path.join(dir, "plain.bin");
      writeFileSync(plain, Buffer.alloc(4 << 20, 7));
      assert.equal(carriesSeaSentinel(plain), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a sentinel straddling a chunk boundary is still found", () => {
    // The scan reads a megabyte at a time; a marker split across two reads is the
    // one case a naive chunked search misses.
    const dir = mkdtempSync(path.join(tmpdir(), "pi-outpost-sentinel-"));
    try {
      const straddling = path.join(dir, "straddling.bin");
      const fuse = Buffer.from("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");
      const buffer = Buffer.alloc((1 << 20) + fuse.length + 16, 7);
      fuse.copy(buffer, (1 << 20) - Math.floor(fuse.length / 2));
      writeFileSync(straddling, buffer);
      assert.equal(carriesSeaSentinel(straddling), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the module does not poison the binary it builds", () => {
  test("the sentinel never appears as a literal in the source", () => {
    // This module is inlined into the bundle that becomes the executable. A literal
    // here puts a second sentinel inside the binary Node is asked to inject into,
    // and Node refuses: "found more than one occurrence of sentinel". It broke three
    // CI runners at once, and nothing local reproduced it.
    const source = readFileSync(new URL("../src/buildExe.ts", import.meta.url), "utf8");
    const assembled = "NODE_SEA_FUSE_" + "fce680ab2cc467b6" + "e072b8b5df1996b2";
    assert.equal(source.includes(assembled), false, "buildExe.ts must assemble the sentinel, never spell it");
    // and what it assembles is still the right string
    assert.equal(SEA_SENTINEL_FUSE, assembled);
  });
});

describe("MXC's executor beside a Windows executable", () => {
  function withDirs(run: (dirs: { source: string; out: string; lines: string[] }) => void) {
    const base = mkdtempSync(path.join(tmpdir(), "build-exe-mxc-"));
    try {
      const source = path.join(base, "pkg", "bin", "x64", "wxc-exec.exe");
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(source, "the executor");
      const out = path.join(base, "out");
      mkdirSync(out);
      run({ source, out, lines: [] });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

  // openlore: scenario=AStandaloneExecutableFindsTheExecutorBesideIt spec=sandbox-runner-bash
  test("is copied where the executable will look for it", () => {
    withDirs(({ source, out, lines }) => {
      const placed = placeMxcExecutor(path.join(out, "pi-outpost.exe"), { platform: "win32", executor: source, log: (l) => lines.push(l) });
      assert.equal(placed, path.join(out, "wxc-exec.exe"));
      assert.equal(readFileSync(placed!, "utf8"), "the executor");
    });
  });

  test("an executor already there is kept unless --force, and nothing is placed off Windows", () => {
    withDirs(({ source, out, lines }) => {
      const beside = path.join(out, "wxc-exec.exe");
      writeFileSync(beside, "older");
      const log = (l: string) => lines.push(l);
      placeMxcExecutor(path.join(out, "pi-outpost.exe"), { platform: "win32", executor: source, log });
      assert.equal(readFileSync(beside, "utf8"), "older");
      assert.match(lines.join(" "), /--force/);
      placeMxcExecutor(path.join(out, "pi-outpost.exe"), { platform: "win32", executor: source, force: true, log });
      assert.equal(readFileSync(beside, "utf8"), "the executor");

      rmSync(beside);
      assert.equal(placeMxcExecutor(path.join(out, "pi-outpost"), { platform: "linux", executor: source, log }), undefined);
      assert.equal(existsSync(beside), false);
    });
  });

  test("without the optional install, the build says so and still succeeds", () => {
    withDirs(({ out, lines }) => {
      const placed = placeMxcExecutor(path.join(out, "pi-outpost.exe"), { platform: "win32", executor: undefined, log: (l) => lines.push(l) });
      assert.equal(placed, undefined);
      assert.match(lines.join(" "), /not installed/);
    });
  });

  test("without the optional install, an executor already beside it is still reported", () => {
    withDirs(({ out, lines }) => {
      const beside = path.join(out, "wxc-exec.exe");
      writeFileSync(beside, "from an earlier build");
      const placed = placeMxcExecutor(path.join(out, "pi-outpost.exe"), { platform: "win32", executor: undefined, log: (l) => lines.push(l) });
      assert.equal(placed, beside);
      assert.deepEqual(lines, [], "nothing is missing, so nothing is said");
    });
  });

  test("an executable built beside the executor itself leaves it as it is", () => {
    withDirs(({ source, lines }) => {
      // Built into the package's own bin folder: the source is the destination.
      const placed = placeMxcExecutor(path.join(path.dirname(source), "pi-outpost.exe"), { platform: "win32", executor: source, log: (l) => lines.push(l) });
      assert.equal(placed, source);
      assert.equal(readFileSync(source, "utf8"), "the executor");
      assert.deepEqual(lines, []);
    });
  });
});

describe("a result that runs but fails is not called produced", () => {
  const withScript = (body: string, check: (script: string) => void) => {
    const dir = mkdtempSync(path.join(tmpdir(), "build-exe-run-"));
    try {
      const script = path.join(dir, "fake-exe");
      writeFileSync(script, `#!/bin/sh\n${body}\n`);
      chmodSync(script, 0o755);
      check(script);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // A shell script stands for the executable; Windows runs none without a shell.
  const posix = { skip: process.platform === "win32" ? "a script is not an executable on Windows" : false };

  test("a non-zero exit is reported with what it printed", posix, () => {
    withScript('echo "segfault in disguise" >&2; exit 3', (script) => {
      assert.deepEqual(producedExecutableRuns(script), { ok: false, detail: "exited 3: segfault in disguise" });
    });
  });

  test("a death by signal is reported by its signal", posix, () => {
    withScript("kill -KILL $$", (script) => {
      assert.deepEqual(producedExecutableRuns(script), { ok: false, detail: "killed by SIGKILL" });
    });
  });
});

describe("signing on macOS", () => {
  test("a missing codesign names how to install it, and a refused signature says why", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "build-exe-sign-"));
    try {
      const target = path.join(dir, "not-a-macho");
      writeFileSync(target, "plain text, which codesign refuses");
      assert.throws(
        () => resignMacho(target),
        (error: unknown) =>
          error instanceof BuildExeError &&
          // macOS has codesign and refuses this file; nowhere else has codesign at all.
          (process.platform === "darwin"
            ? /could not sign the executable/.test(error.message)
            : /codesign is required on macOS.*xcode-select --install/.test(error.message)),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("building directly", () => {
  test("a failing node --build-sea is refused with its own words, and logged as the path taken", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pi-outpost-buildexe-"));
    try {
      writeFileSync(path.join(dir, "pi-outpost.sea.mjs"), "console.log('a bundle')");
      const lines: string[] = [];
      // A folder that does not exist: Node 26 cannot write there, and the Node 24 the
      // CI runs on does not know --build-sea at all. Both are this refusal.
      const target = path.join(dir, "missing", "pi-outpost");
      assert.throws(
        () => buildExecutable({ out: target, cwd: dir, inputsFrom: dir, nodeVersion: "v26.0.0", log: (l) => lines.push(l) }),
        (error: unknown) => error instanceof BuildExeError && /^node --build-sea failed: \S/.test(error.message),
      );
      assert.deepEqual(lines, ["[build-exe] building with node --build-sea (node v26.0.0)"]);
      assert.equal(existsSync(target), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
