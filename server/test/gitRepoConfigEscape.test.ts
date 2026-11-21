/**
 * A repository's own configuration runs nothing in the server.
 *
 * The server runs git unconfined — `git status` on every refresh of the Files badges, `log` and
 * `show` for the history — in the project, whose `.git/config` the agent can write: a confined
 * command writes anywhere in its root. Git runs commands that configuration names
 * (`core.fsmonitor` on status, a diff driver's `textconv` on show, a filter's `clean` on status),
 * so one written there by a confined command would run outside the sandbox at the next refresh.
 *
 * The first part needs no runner: a repository set up that way, and every git call the server
 * makes. The second shows the whole path under MXC's real executor, where `MXC_EXEC` names it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { gitFileLog, gitHeadContent, gitLog, gitRevisionContent, gitShow, gitStatusFor, type GitRepo } from "../src/git.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
const slash = (p: string) => p.split(path.sep).join("/");

/** A script that leaves `marker` behind when something runs it, and fails so git carries on. */
async function trap(dir: string, name: string, marker: string): Promise<string> {
  const script = path.join(dir, `${name}.sh`);
  await writeFile(script, `#!/bin/sh\necho ran > "${slash(marker)}"\nexit 1\n`);
  return `sh "${slash(script)}"`;
}

async function repository(base: string): Promise<{ root: string; repo: GitRepo; sha: string }> {
  const root = path.join(base, "project");
  await mkdir(root, { recursive: true });
  git(root, "init", "-q");
  await writeFile(path.join(root, "a.txt"), "one\n");
  await writeFile(path.join(root, ".gitattributes"), "*.txt diff=trap filter=trap\n");
  git(root, "add", ".");
  git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "one");
  await writeFile(path.join(root, "a.txt"), "two\n");
  git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "two");
  // The same size, a later time: status cannot tell it from its index entry and hashes it,
  // which is when a filter's clean runs.
  await writeFile(path.join(root, "a.txt"), "tw0\n");
  const later = new Date(Date.now() + 5_000);
  await utimes(path.join(root, "a.txt"), later, later);
  const sha = git(root, "rev-parse", "HEAD").trim();
  return { root, repo: { toplevel: root, cwd: root, id: "" }, sha };
}

/** Every git call the server makes on a repository, the way it makes them. */
async function everyServerCall(repo: GitRepo, sha: string): Promise<void> {
  await gitStatusFor(repo).catch(() => {});
  await gitLog(repo, 5).catch(() => {});
  await gitFileLog(repo, "a.txt", 5).catch(() => {});
  await gitShow(repo, sha).catch(() => {});
  await gitHeadContent(repo, "a.txt").catch(() => {});
  await gitRevisionContent(repo, sha, "a.txt").catch(() => {});
}

describe("a repository's configuration runs nothing in the server", () => {
  let base: string;
  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "git-config-escape-"));
  });
  after(async () => {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  for (const [key, name] of [
    ["core.fsmonitor", "fsmonitor"],
    ["diff.trap.textconv", "textconv"],
    ["diff.trap.command", "diff-command"],
    ["diff.external", "diff-external"],
    ["filter.trap.clean", "filter-clean"],
    ["filter.trap.process", "filter-process"],
  ] as const) {
    // openlore: scenario=ARepositorysConfigurationRunsNothingInTheServer spec=git
    test(`${key} written in .git/config does not run`, async () => {
      const dir = path.join(base, name);
      await mkdir(dir, { recursive: true });
      const { root, repo, sha } = await repository(dir);
      const marker = path.join(dir, "MARKER");
      git(root, "config", key, await trap(dir, name, marker));
      await everyServerCall(repo, sha);
      assert.equal(existsSync(marker), false, `${key} ran in the server`);
    });
  }

  test("an included configuration file is held to the same", async () => {
    const dir = path.join(base, "include");
    await mkdir(dir, { recursive: true });
    const { root, repo, sha } = await repository(dir);
    const marker = path.join(dir, "MARKER");
    await writeFile(path.join(root, "more.gitconfig"), `[core]\n\tfsmonitor = ${await trap(dir, "include", marker)}\n`);
    git(root, "config", "include.path", "../more.gitconfig");
    await everyServerCall(repo, sha);
    assert.equal(existsSync(marker), false, "an included core.fsmonitor ran in the server");
  });
});

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const skip = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC (wxc-exec.exe) is not set" : false;

describe("the whole path under MXC's real executor", { skip }, () => {
  let base: string;
  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "git-config-escape-mxc-"));
  });
  after(async () => {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // openlore: scenario=ARepositorysConfigurationRunsNothingInTheServer spec=git
  test("a confined command writes core.fsmonitor; the server's status does not run it outside the root", async () => {
    const { root, repo, sha } = await repository(base);
    const agentDir = path.join(base, "agent");
    await mkdir(agentDir, { recursive: true });
    // Outside the root: a confined command cannot write there.
    const outside = path.join(base, "outside");
    await mkdir(outside, { recursive: true });
    const marker = path.join(outside, "ESCAPED");
    const script = path.join(root, "hook.sh");
    const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir });
    let output = "";
    const written = await ops.exec(
      [
        `Set-Content -LiteralPath '${script}' -Value "#!/bin/sh${"`n"}echo ran > '${slash(marker)}'${"`n"}exit 1" -NoNewline`,
        `Add-Content -LiteralPath '${path.join(root, ".git", "config")}' -Value "[core]${"`n"}${"`t"}fsmonitor = sh '${slash(script)}'"`,
        `Set-Content -LiteralPath '${marker}' -Value direct -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath '${marker}') { 'confined: wrote outside' } else { 'confined: could not write outside' }`,
      ].join("; "),
      root,
      { onData: (data) => (output += data.toString()), timeout: 120 },
    );
    assert.equal(written.exitCode, 0, output);
    assert.match(output, /confined: could not write outside/, "the command itself is confined");
    assert.match(git(root, "config", "--get", "core.fsmonitor"), /hook\.sh/, "the confined command did write the repository's configuration");

    await everyServerCall(repo, sha);
    assert.equal(existsSync(marker), false, "the repository's core.fsmonitor ran in the server, outside the sandbox");
  });
});
