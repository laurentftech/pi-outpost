/**
 * What a failed git command says (git: GitFailuresSayWhy).
 *
 * The report behind this: a red `git: git log failed` with nothing after it. git had
 * written nothing — the server's time limit had stopped it — and the bare fallback was
 * all the person saw. The errors here come from real child processes, so the shapes
 * the message is read from are Node's, not a guess at them.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { promisify } from "node:util";
import { GitError, gitFailureMessage, gitLog, resetGitExecutable, useGitExecutable } from "../src/git.ts";

const run = promisify(execFile);

/** The error a real child process fails with. */
async function failureOf(command: string, args: string[], options: { timeout?: number; maxBuffer?: number } = {}): Promise<unknown> {
  try {
    await run(command, args, { encoding: "utf8", windowsHide: true, ...options });
  } catch (error) {
    return error;
  }
  throw new Error("the command was expected to fail");
}

describe("GitFailuresSayWhy", () => {
  // openlore: scenario=ATimedOutCommandNamesItsLimit spec=git
  test("ATimedOutCommandNamesItsLimit: a command stopped by the time limit names the command and the limit", async () => {
    const error = await failureOf(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { timeout: 200 });
    assert.equal(gitFailureMessage("log", error, 10_000, 10 * 1024 * 1024), "git log took longer than 10 s and was stopped");
  });

  // openlore: scenario=AMissingGitIsNamed spec=git
  test("AMissingGitIsNamed: an executable that cannot be started says git was not found", async () => {
    const error = await failureOf(path.join(tmpdir(), "pi-outpost-no-such-git"), ["log"]);
    assert.equal(gitFailureMessage("log", error, 10_000, 10 * 1024 * 1024), "git was not found");
  });

  test("more output than the server reads is named as such, not as a timeout", async () => {
    const error = await failureOf(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], { maxBuffer: 1024 });
    assert.equal(gitFailureMessage("log", error, 10_000, 2 * 1024 * 1024), "git log wrote more than 2 MB");
  });

  // openlore: scenario=GitsOwnWordsAreKept spec=git
  test("GitsOwnWordsAreKept: git's reason line is the error, whatever the line endings", async () => {
    const error = await failureOf(process.execPath, ["-e", "process.stderr.write('fatal: bad revision\\r\\nhint: more\\r\\n'); process.exit(128)"]);
    assert.equal(gitFailureMessage("log", error, 10_000, 10 * 1024 * 1024), "fatal: bad revision");
  });

  // openlore: scenario=AProgressLineIsNotTheReason spec=git
  test("AProgressLineIsNotTheReason: a clone's progress line is skipped for the fatal line after it (LF and CRLF)", async () => {
    for (const eol of ["\\n", "\\r\\n"]) {
      const error = await failureOf(process.execPath, [
        "-e",
        `process.stderr.write("Cloning into 'demo-skills'...${eol}fatal: could not read Username for 'https://git.example.com': terminal prompts disabled${eol}"); process.exit(128)`,
      ]);
      assert.equal(
        gitFailureMessage("clone", error, 10_000, 10 * 1024 * 1024),
        "fatal: could not read Username for 'https://git.example.com': terminal prompts disabled",
      );
    }
  });

  test("an error: line is a reason too, and wins over the lines around it", async () => {
    const error = await failureOf(process.execPath, ["-e", "process.stderr.write('remote: Counting objects\\nerror: RPC failed; HTTP 500\\nfatal: expected flush after ref listing\\n'); process.exit(128)"]);
    assert.equal(gitFailureMessage("fetch", error, 10_000, 10 * 1024 * 1024), "error: RPC failed; HTTP 500");
  });

  test("without fatal: or error:, the last line that is not a hint is the reason", async () => {
    const error = await failureOf(process.execPath, ["-e", "process.stderr.write('Updating 1..2\\nyour local changes would be overwritten\\nhint: commit them first\\n'); process.exit(1)"]);
    assert.equal(gitFailureMessage("pull", error, 10_000, 10 * 1024 * 1024), "your local changes would be overwritten");
  });

  test("a single line is kept as it is", async () => {
    const error = await failureOf(process.execPath, ["-e", "process.stderr.write('Permission denied (publickey).\\n'); process.exit(128)"]);
    assert.equal(gitFailureMessage("fetch", error, 10_000, 10 * 1024 * 1024), "Permission denied (publickey).");
  });

  test("a failure with no reason at all keeps the bare fallback", async () => {
    const error = await failureOf(process.execPath, ["-e", "process.exit(1)"]);
    assert.equal(gitFailureMessage("log", error, 10_000, 10 * 1024 * 1024), "git log failed");
  });

  describe("through the server's own git runner", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pi-outpost-git-failure-"));
    after(() => {
      resetGitExecutable();
      rmSync(dir, { recursive: true, force: true });
    });

    test("a git that cannot be started reaches the log's caller as 'git was not found'", async () => {
      useGitExecutable(path.join(dir, "no-such-git"));
      await assert.rejects(gitLog({ id: "", cwd: dir, toplevel: dir }, 20), (error: unknown) => {
        assert.ok(error instanceof GitError);
        assert.equal(error.message, "git was not found");
        return true;
      });
    });
  });
});
