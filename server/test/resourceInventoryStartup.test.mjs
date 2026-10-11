/**
 * A slow resource inventory does not hold the server's start.
 *
 * The inventory feeds the Agent resources panel and asks git about the repositories
 * skills and extensions come from. Startup used to wait for all of it. Here git is made
 * slow — ten seconds — for one skill's repository only, and logs when that question starts
 * and ends: the client must be greeted while it is still pending, and the inventory arrive
 * afterwards, as a message. Read from the log rather than a clock, so a loaded machine
 * that starts slowly cannot pass or fail it on timing alone.
 *
 * POSIX only: the slow git is a shell script, and a script is not something Windows can
 * run as an executable. The rule it checks is not platform code.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const SLOW_SECONDS = 10;

test(
  "ASlowInventoryDoesNotHoldStartup: the server greets its client first, the inventory follows",
  { skip: process.platform === "win32" ? "the slow git is a shell script" : false },
  async () => {
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), "pi-inventory-startup-")));
    try {
      // A repository holding one skill, outside the workspace so nothing else asks git about it.
      const repo = path.join(outside, "slow-skills");
      await mkdir(path.join(repo, "skills", "slow"), { recursive: true });
      await writeFile(path.join(repo, "skills", "slow", "SKILL.md"), "---\nname: slow\ndescription: slow.\n---\n");
      execFileSync(realGit, ["init", "-q"], { cwd: repo });
      // Git, slow only when asked where that repository is — and saying when.
      const log = path.join(outside, "slow-git.log");
      const slowGit = path.join(outside, "slow-git");
      await writeFile(
        slowGit,
        `#!/bin/sh\ncase "$PWD" in *slow-skills*) case "$*" in *show-toplevel*) echo started >> "${log}"; sleep ${SLOW_SECONDS}; echo ended >> "${log}";; esac;; esac\nexec "${realGit}" "$@"\n`,
      );
      await chmod(slowGit, 0o755);

      const server = await startServer(await makeWorkspace(), { gitPath: slowGit, skillPaths: [path.join(repo, "skills")] });
      try {
        const client = connect(server.wsUrl());
        await client.open();
        const hello = await client.waitFor("hello", 60_000);
        const asked = (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean);
        // Started, not ended: the greeting did not wait for it. (A second inventory, the one
        // taken when extensions bind, may have started its own question too.)
        assert.ok(asked.includes("started") && !asked.includes("ended"), `greeted while the slow question was still pending: ${asked.join(",")}`);
        assert.ok(
          !hello.agentResources?.repositories.some((repository) => repository.path === repo),
          "the greeting does not wait for the slow repository",
        );

        const later = await client.waitFor(
          (message) => message.type === "agent_resource_inventory" && message.inventory.repositories.some((repository) => repository.path === repo),
          60_000,
        );
        assert.ok(later.inventory.resources.some((resource) => resource.name === "slow"), "the skill is in the inventory that follows");
        client.close();
      } finally {
        await server.stop();
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  },
);
