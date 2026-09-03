import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import type { AgentResourceInfo } from "@pi-outpost/shared";
import { useGitExecutable } from "../src/git.ts";
import { ResourceRepositoryService, useResourceGitObserver } from "../src/resourceRepositories.ts";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();
const roots: string[] = [];

function run(cwd: string, args: string[]): string {
  return execFileSync(git, args, { cwd, encoding: "utf8" }).trim();
}

async function temp(name: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `pi-resource-${name}-`));
  const canonical = await realpath(root);
  roots.push(canonical);
  return canonical;
}

async function initRepo(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  run(root, ["init", "-q", "--initial-branch=main"]);
  run(root, ["config", "user.email", "test@example.com"]);
  run(root, ["config", "user.name", "Resource Test"]);
  run(root, ["config", "commit.gpgsign", "false"]);
}

async function commitAll(root: string, message: string): Promise<string> {
  run(root, ["add", "."]);
  run(root, ["commit", "-q", "-m", message]);
  return run(root, ["rev-parse", "HEAD"]);
}

async function remotePair(): Promise<{ root: string; seed: string; consumer: string }> {
  const root = await temp("remote");
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const consumer = path.join(root, "consumer");
  await mkdir(remote);
  run(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  await initRepo(seed);
  await mkdir(path.join(seed, "skills", "review"), { recursive: true });
  await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "# Review\n");
  await mkdir(path.join(seed, "extensions"), { recursive: true });
  await writeFile(path.join(seed, "extensions", "review.ts"), "export default () => {};\n");
  await commitAll(seed, "initial");
  run(seed, ["remote", "add", "origin", remote]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  run(root, ["clone", "-q", remote, consumer]);
  run(consumer, ["config", "user.email", "test@example.com"]);
  run(consumer, ["config", "user.name", "Resource Test"]);
  run(consumer, ["config", "commit.gpgsign", "false"]);
  return { root, seed, consumer };
}

function resource(kind: "skill" | "extension", value: string): AgentResourceInfo {
  return { id: `${kind}:${value}`, kind, name: path.basename(value), origin: "runtime", path: value };
}

function input(resources: AgentResourceInfo[], extensionLock = false) {
  return {
    resources,
    capabilities: { skills: "available" as const, extensions: "available" as const },
    configuredSkillPaths: [],
    userSkillPaths: [],
    configuredExtensionPaths: [],
    userExtensionPaths: [],
    extensionLock,
  };
}

before(() => useGitExecutable(git));
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
after(() => useResourceGitObserver());

describe("resource repository enrollment", () => {
  test("clones a validated address into the explicit local folder and previews resources", async () => {
    const { root } = await remotePair();
    const remote = path.join(root, "remote.git");
    const managed = path.join(root, "managed");
    const destination = path.join(root, "chosen", "team-resources");
    await mkdir(path.dirname(destination));
    const service = new ResourceRepositoryService(managed);
    const address = pathToFileURL(remote).toString();

    const suggested = service.suggestedClonePath(address);
    assert.equal(path.dirname(suggested), managed);
    assert.match(path.basename(suggested), /^remote-[a-f0-9]{10}$/);
    const preview = await service.cloneAndPreview(address, destination, false);
    assert.equal(await realpath(preview.repositoryPath), await realpath(destination));
    assert.deepEqual(new Set(preview.roots.map((entry) => entry.kind)), new Set(["skill", "extension"]));
    assert.equal(run(destination, ["submodule", "status"]), "");
  });

  test("reuses the same-origin clone and refuses occupied or unsafe destinations before cloning", async () => {
    const { root } = await remotePair();
    const address = pathToFileURL(path.join(root, "remote.git")).toString();
    const destination = path.join(root, "checkout");
    run(root, ["clone", "-q", path.join(root, "remote.git"), destination]);
    const service = new ResourceRepositoryService(path.join(root, "managed"));
    const first = await service.cloneAndPreview(address, destination, false);
    const second = await service.cloneAndPreview(address, destination, false);
    assert.notEqual(first.token, second.token);
    assert.equal(first.repositoryPath, second.repositoryPath);
    await mkdir(path.join(destination, "nested"));
    await assert.rejects(
      () => service.cloneAndPreview(address, path.join(destination, "nested"), false),
      /top-level folder/,
    );

    const occupied = path.join(root, "occupied");
    await writeFile(occupied, "keep me");
    await assert.rejects(() => service.cloneAndPreview(address, occupied, false), /occupied/);
    assert.equal(await readFile(occupied, "utf8"), "keep me");
    const other = path.join(root, "other");
    await initRepo(other);
    await writeFile(path.join(other, "README.md"), "other\n");
    await commitAll(other, "other");
    await assert.rejects(() => service.cloneAndPreview(address, other, false), /different repository/);
    const linked = path.join(root, "linked");
    await symlink(destination, linked, "dir");
    await assert.rejects(() => service.cloneAndPreview(address, linked, false), /symbolic link/);
    await assert.rejects(() => service.cloneAndPreview(address, "/", false), /below an existing parent/);
    await assert.rejects(() => service.cloneAndPreview(address, path.join(root, "missing", "child"), false), /parent directory does not exist/);
    await assert.rejects(() => service.cloneAndPreview("--upload-pack=evil", path.join(root, "bad"), false), /valid Git repository address/);
    await assert.rejects(() => service.cloneAndPreview("https://example.test/repo.git;touch-pwned", path.join(root, "bad"), false), /HTTPS, SSH, Git/);
  });

  test("reports a resource-empty clone without registering paths and redacts address credentials", async () => {
    const emptyRoot = await temp("empty-remote");
    const emptyRemote = path.join(emptyRoot, "remote.git");
    const seed = path.join(emptyRoot, "seed");
    await mkdir(emptyRemote);
    run(emptyRemote, ["init", "-q", "--bare", "--initial-branch=main"]);
    await initRepo(seed);
    await writeFile(path.join(seed, "README.md"), "empty resources\n");
    await commitAll(seed, "empty");
    run(seed, ["remote", "add", "origin", emptyRemote]);
    run(seed, ["push", "-q", "-u", "origin", "main"]);
    const service = new ResourceRepositoryService(path.join(emptyRoot, "managed"));
    await assert.rejects(
      () => service.cloneAndPreview(pathToFileURL(emptyRemote).toString(), path.join(emptyRoot, "checkout"), false),
      /No recognizable skill or extension roots/,
    );

    const started = Date.now();
    await assert.rejects(
      () => service.cloneAndPreview("https://user:super-secret@127.0.0.1:1/no.git", path.join(emptyRoot, "private"), false),
      (error: Error) => !error.message.includes("super-secret") && /Could not clone/.test(error.message),
    );
    assert.ok(Date.now() - started < 10_000, "non-interactive authentication failure should not wait for the git timeout");
  });

  test("does not initialize submodules while cloning", { skip: process.platform === "win32" }, async () => {
    const root = await temp("clone-submodule");
    const subRemote = path.join(root, "sub.git");
    const subSeed = path.join(root, "sub-seed");
    await mkdir(subRemote);
    run(subRemote, ["init", "-q", "--bare", "--initial-branch=main"]);
    await initRepo(subSeed);
    await writeFile(path.join(subSeed, "extension.ts"), "export default () => {};\n");
    await commitAll(subSeed, "submodule");
    run(subSeed, ["remote", "add", "origin", subRemote]);
    run(subSeed, ["push", "-q", "-u", "origin", "main"]);

    const superRemote = path.join(root, "super.git");
    const superSeed = path.join(root, "super-seed");
    await mkdir(superRemote);
    run(superRemote, ["init", "-q", "--bare", "--initial-branch=main"]);
    await initRepo(superSeed);
    await mkdir(path.join(superSeed, "skills", "safe"), { recursive: true });
    await writeFile(path.join(superSeed, "skills", "safe", "SKILL.md"), "# Safe\n");
    run(superSeed, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", subRemote, "extensions/vendor"]);
    await commitAll(superSeed, "superproject");
    run(superSeed, ["remote", "add", "origin", superRemote]);
    run(superSeed, ["push", "-q", "-u", "origin", "main"]);

    const destination = path.join(root, "checkout");
    const preview = await new ResourceRepositoryService(path.join(root, "managed")).cloneAndPreview(
      pathToFileURL(superRemote).toString(),
      destination,
      false,
    );
    assert.ok(preview.roots.some((entry) => entry.kind === "skill"));
    await assert.rejects(access(path.join(destination, "extensions", "vendor", "extension.ts")));
  });

  test("previews recognized roots without executing extension modules", async () => {
    const root = await temp("preview");
    await initRepo(root);
    await mkdir(path.join(root, "skills", "ship"), { recursive: true });
    await writeFile(path.join(root, "skills", "ship", "SKILL.md"), "# Ship\n");
    await mkdir(path.join(root, "extensions"));
    const marker = path.join(root, "executed");
    await writeFile(
      path.join(root, "extensions", "danger.mjs"),
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "executed"); export default () => {};\n`,
    );
    await commitAll(root, "resources");

    const service = new ResourceRepositoryService();
    const preview = await service.preview(root, false);
    assert.deepEqual(preview.roots.map((entry) => [entry.kind, path.relative(root, entry.path)]), [
      ["extension", "extensions"],
      ["skill", "skills"],
    ]);
    await assert.rejects(access(marker));
  });

  test("does not discover skill or extension roots through symlinks outside the repository", async () => {
    const root = await temp("preview-symlink");
    const outside = await temp("preview-symlink-outside");
    await initRepo(root);
    await mkdir(path.join(outside, "skills", "escaped"), { recursive: true });
    await writeFile(path.join(outside, "skills", "escaped", "SKILL.md"), "# Escaped\n");
    await mkdir(path.join(outside, "extensions"));
    await writeFile(path.join(outside, "extensions", "escaped.ts"), "export default () => {};\n");
    await symlink(path.join(outside, "skills"), path.join(root, "skills"), "dir");
    await symlink(path.join(outside, "extensions"), path.join(root, "extensions"), "dir");
    await writeFile(path.join(root, "README.md"), "no in-repository resources\n");
    await commitAll(root, "symlink candidates");

    await assert.rejects(
      () => new ResourceRepositoryService().preview(root, false),
      /No recognizable skill or extension roots/,
    );
  });

  test("revalidates previews and leaves extension candidates locked", async () => {
    const root = await temp("preview-lock");
    await initRepo(root);
    await mkdir(path.join(root, "skills", "one"), { recursive: true });
    await writeFile(path.join(root, "skills", "one", "SKILL.md"), "# One\n");
    await mkdir(path.join(root, "extensions"));
    await writeFile(path.join(root, "extensions", "one.ts"), "export default () => {};\n");
    await commitAll(root, "resources");
    const service = new ResourceRepositoryService();
    const preview = await service.preview(root, true);
    assert.equal(preview.roots.find((entry) => entry.kind === "extension")?.locked, true);
    const skillPath = preview.roots.find((entry) => entry.kind === "skill")!.path;
    const selected = await service.confirmPreview(preview.token, [skillPath], [], true);
    assert.deepEqual(selected.skillRoots, [skillPath]);
    assert.deepEqual(selected.extensionRoots, []);
  });

  test("expires previews and consumes them after the first confirmation attempt", async () => {
    const root = await temp("preview-expiry");
    await initRepo(root);
    await mkdir(path.join(root, "skills", "one"), { recursive: true });
    await writeFile(path.join(root, "skills", "one", "SKILL.md"), "# One\n");
    await commitAll(root, "resources");
    let now = 1_000;
    const service = new ResourceRepositoryService(path.join(root, "managed"), () => now);
    const expired = await service.preview(root, false);
    now += 11 * 60_000;
    await assert.rejects(() => service.confirmPreview(expired.token, [expired.roots[0].path], [], false), /expired/);
    await assert.rejects(() => service.confirmPreview(expired.token, [expired.roots[0].path], [], false), /no longer valid/);
  });

  test("refuses non-repositories and stale candidate sets", async () => {
    const plain = await temp("plain");
    await assert.rejects(() => new ResourceRepositoryService().preview(plain, false), /not inside a Git worktree/);

    const root = await temp("stale");
    await initRepo(root);
    await mkdir(path.join(root, "skills", "one"), { recursive: true });
    await writeFile(path.join(root, "skills", "one", "SKILL.md"), "# One\n");
    await commitAll(root, "one");
    const service = new ResourceRepositoryService();
    const preview = await service.preview(root, false);
    await mkdir(path.join(root, "extensions"));
    await writeFile(path.join(root, "extensions", "later.ts"), "export default () => {};\n");
    await assert.rejects(() => service.confirmPreview(preview.token, [preview.roots[0].path], [], false), /changed after preview/);
    await assert.rejects(() => service.confirmPreview(preview.token, [preview.roots[0].path], [], false), /no longer valid/);
  });
});

describe("resource provenance grouping", () => {
  test("canonicalizes symlinked duplicate roots and keeps repository ids stable for the process", async () => {
    const root = await temp("canonical-roots");
    await initRepo(root);
    const skillRoot = path.join(root, "skills");
    const skillFile = path.join(skillRoot, "one", "SKILL.md");
    await mkdir(path.dirname(skillFile), { recursive: true });
    await writeFile(skillFile, "# One\n");
    await commitAll(root, "skill");
    const linkedRoot = path.join(path.dirname(root), `${path.basename(root)}-link`);
    roots.push(linkedRoot);
    await symlink(skillRoot, linkedRoot, "dir");
    const canonicalInput = {
      ...input([resource("skill", skillFile), resource("skill", path.join(linkedRoot, "one", "SKILL.md"))]),
      configuredSkillPaths: [skillRoot],
      userSkillPaths: [linkedRoot],
    };
    const first = await new ResourceRepositoryService().buildInventory(canonicalInput);
    const second = await new ResourceRepositoryService().buildInventory(canonicalInput);
    assert.equal(first.resources.length, 1);
    assert.equal(first.resources[0].path, skillFile);
    assert.equal(first.repositories.length, 1);
    assert.equal(first.repositories[0].resourceIds.length, 1);
    assert.equal(second.repositories[0].id, first.repositories[0].id);
  });

  test("deduplicates mixed roots and assigns a nested repository to itself", async () => {
    const parent = await temp("nested");
    await initRepo(parent);
    const nested = path.join(parent, "vendor", "resources");
    await initRepo(nested);
    const parentSkill = path.join(parent, "skills", "parent", "SKILL.md");
    const nestedSkill = path.join(nested, "skills", "nested", "SKILL.md");
    const nestedExtension = path.join(nested, "extensions", "nested.ts");
    await mkdir(path.dirname(parentSkill), { recursive: true });
    await mkdir(path.dirname(nestedSkill), { recursive: true });
    await mkdir(path.dirname(nestedExtension), { recursive: true });
    await writeFile(parentSkill, "# Parent\n");
    await writeFile(nestedSkill, "# Nested\n");
    await writeFile(nestedExtension, "export default () => {};\n");
    await commitAll(nested, "nested");
    await commitAll(parent, "parent");

    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([
      resource("skill", parentSkill),
      resource("skill", nestedSkill),
      resource("extension", nestedExtension),
    ]));
    assert.equal(inventory.repositories.length, 2);
    const nestedGroup = inventory.repositories.find((repo) => repo.path === nested)!;
    assert.equal(nestedGroup.containsExtensions, true);
    assert.equal(nestedGroup.resourceIds.length, 2);
  });

  test("keeps pathless runtime resources visible and unavailable", async () => {
    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([
      { id: "skill:remote", kind: "skill", name: "remote", origin: "runtime", unavailableReason: "RPC omitted sourceInfo" },
    ]));
    assert.equal(inventory.repositories.length, 0);
    assert.equal(inventory.resources[0].unavailableReason, "RPC omitted sourceInfo");
  });

  test("issues a new opaque id when a repository is replaced at the same path", async () => {
    const parent = await temp("identity-replacement");
    const repository = path.join(parent, "resources");
    const skill = path.join(repository, "skills", "review", "SKILL.md");
    await initRepo(repository);
    await mkdir(path.dirname(skill), { recursive: true });
    await writeFile(skill, "# First\n");
    await commitAll(repository, "first repository");
    const service = new ResourceRepositoryService();
    const first = await service.buildInventory(input([resource("skill", skill)]));

    await rm(repository, { recursive: true, force: true });
    await initRepo(repository);
    await mkdir(path.dirname(skill), { recursive: true });
    await writeFile(skill, "# Replacement\n");
    await commitAll(repository, "replacement repository");
    const second = await service.buildInventory(input([resource("skill", skill)]));
    assert.notEqual(second.repositories[0].id, first.repositories[0].id);
    assert.equal(second.repositories[0].assessment.status, "unchecked");
  });
});

describe("guarded repository updates", () => {
  test("does not assess a resource repository that is itself a Git submodule as updateable", async () => {
    const { root, consumer } = await remotePair();
    const superproject = path.join(root, "superproject");
    await initRepo(superproject);
    run(superproject, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", consumer, "vendor/resources"]);
    await commitAll(superproject, "resource submodule");
    const skill = path.join(superproject, "vendor", "resources", "skills", "review", "SKILL.md");
    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([resource("skill", skill)]));
    const [assessment] = await service.refresh(inventory.repositories[0].id);
    assert.equal(assessment.status, "unavailable");
    assert.match(assessment.reason ?? "", /itself a Git submodule/);
  });

  test("bounds multi-repository refresh concurrency and keeps results correlated", async () => {
    const { root, consumer } = await remotePair();
    const remote = path.join(root, "remote.git");
    const consumers = [consumer];
    for (let index = 1; index < 8; index += 1) {
      const clone = path.join(root, `consumer-${index}`);
      run(root, ["clone", "-q", remote, clone]);
      consumers.push(clone);
    }
    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input(consumers.map((clone) =>
      resource("skill", path.join(clone, "skills", "review", "SKILL.md")),
    )));
    let active = 0;
    let maximum = 0;
    const commands: string[][] = [];
    useResourceGitObserver((event) => {
      if (event.phase === "start") {
        active += 1;
        maximum = Math.max(maximum, active);
        commands.push([...event.args]);
        assert.equal(event.env.GIT_TERMINAL_PROMPT, "0");
        assert.equal(event.env.GIT_ASKPASS, "");
        assert.equal(event.env.SSH_ASKPASS, "");
        assert.equal(event.env.SSH_ASKPASS_REQUIRE, "never");
      } else {
        active -= 1;
      }
    });
    try {
      const assessments = await service.refresh();
      assert.equal(assessments.length, 8);
      assert.deepEqual(new Set(assessments.map((entry) => entry.repositoryId)), new Set(inventory.repositories.map((repo) => repo.id)));
      assert.ok(maximum > 1, `expected parallel refreshes, observed ${maximum}`);
      assert.ok(maximum <= 4, `refresh concurrency exceeded four: ${maximum}`);
      const fetches = commands.filter((args) => args.includes("fetch"));
      assert.equal(fetches.length, 8);
      assert.ok(fetches.every((args) => args.some((arg) => arg.startsWith("core.hooksPath="))));
    } finally {
      useResourceGitObserver();
    }
  });

  test("classifies current, detached, no-upstream, ahead, and diverged branches", async () => {
    const currentPair = await remotePair();
    const currentSkill = path.join(currentPair.consumer, "skills", "review", "SKILL.md");
    const currentService = new ResourceRepositoryService();
    const currentInventory = await currentService.buildInventory(input([resource("skill", currentSkill)]));
    assert.equal((await currentService.refresh(currentInventory.repositories[0].id))[0].status, "current");

    run(currentPair.consumer, ["checkout", "--detach", "-q"]);
    assert.equal((await currentService.refresh(currentInventory.repositories[0].id))[0].status, "detached");

    const standalone = await temp("no-upstream");
    await initRepo(standalone);
    const standaloneSkill = path.join(standalone, "skills", "one", "SKILL.md");
    await mkdir(path.dirname(standaloneSkill), { recursive: true });
    await writeFile(standaloneSkill, "# One\n");
    await commitAll(standalone, "initial");
    const standaloneService = new ResourceRepositoryService();
    const standaloneInventory = await standaloneService.buildInventory(input([resource("skill", standaloneSkill)]));
    assert.equal((await standaloneService.refresh(standaloneInventory.repositories[0].id))[0].status, "no-upstream");

    const aheadPair = await remotePair();
    const aheadSkill = path.join(aheadPair.consumer, "skills", "review", "SKILL.md");
    await writeFile(path.join(aheadPair.consumer, "local.txt"), "local\n");
    await commitAll(aheadPair.consumer, "local");
    const aheadService = new ResourceRepositoryService();
    const aheadInventory = await aheadService.buildInventory(input([resource("skill", aheadSkill)]));
    assert.equal((await aheadService.refresh(aheadInventory.repositories[0].id))[0].status, "ahead");

    await writeFile(path.join(aheadPair.seed, "remote.txt"), "remote\n");
    await commitAll(aheadPair.seed, "remote");
    run(aheadPair.seed, ["push", "-q"]);
    assert.equal((await aheadService.refresh(aheadInventory.repositories[0].id))[0].status, "diverged");
  });

  test("isolates a failed remote and detects repositories removed or replaced after inventory", async () => {
    const healthy = await remotePair();
    const failing = await remotePair();
    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([
      resource("skill", path.join(healthy.consumer, "skills", "review", "SKILL.md")),
      resource("skill", path.join(failing.consumer, "skills", "review", "SKILL.md")),
    ]));
    run(failing.consumer, ["remote", "set-url", "origin", "https://127.0.0.1:1/unavailable.git"]);
    const assessments = await service.refresh();
    assert.equal(assessments.find((entry) => entry.repositoryId === inventory.repositories.find((repo) => repo.path === healthy.consumer)!.id)?.status, "current");
    assert.equal(assessments.find((entry) => entry.repositoryId === inventory.repositories.find((repo) => repo.path === failing.consumer)!.id)?.status, "failed");

    const replaced = await remotePair();
    const replacedService = new ResourceRepositoryService();
    const replacedInventory = await replacedService.buildInventory(input([
      resource("skill", path.join(replaced.consumer, "skills", "review", "SKILL.md")),
    ]));
    await rm(replaced.consumer, { recursive: true, force: true });
    await initRepo(replaced.consumer);
    await mkdir(path.join(replaced.consumer, "skills", "review"), { recursive: true });
    await writeFile(path.join(replaced.consumer, "skills", "review", "SKILL.md"), "# Replacement\n");
    await commitAll(replaced.consumer, "replacement");
    assert.equal((await replacedService.refresh(replacedInventory.repositories[0].id))[0].status, "unavailable");
  });

  test("classifies dirty worktrees without changing them", async () => {
    const { consumer } = await remotePair();
    const skill = path.join(consumer, "skills", "review", "SKILL.md");
    await writeFile(skill, "# Local change\n");
    const before = run(consumer, ["rev-parse", "HEAD"]);
    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([resource("skill", skill)]));
    const [assessment] = await service.refresh(inventory.repositories[0].id);
    assert.equal(assessment.status, "dirty");
    assert.equal(run(consumer, ["rev-parse", "HEAD"]), before);
  });

  test("fast-forwards the assessed commit and disables repository hooks", { skip: process.platform === "win32" }, async () => {
    const { seed, consumer } = await remotePair();
    const skill = path.join(consumer, "skills", "review", "SKILL.md");
    await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "# Remote update\n");
    const expected = await commitAll(seed, "update");
    run(seed, ["push", "-q"]);
    const hookMarker = path.join(consumer, "hook-ran");
    const hook = path.join(consumer, ".git", "hooks", "post-merge");
    await writeFile(hook, `#!/bin/sh\nprintf ran > ${JSON.stringify(hookMarker)}\n`);
    await chmod(hook, 0o755);

    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([resource("skill", skill)]));
    const repositoryId = inventory.repositories[0].id;
    const [assessment] = await service.refresh(repositoryId);
    assert.equal(assessment.status, "updateable");
    const commands: string[][] = [];
    useResourceGitObserver((event) => { if (event.phase === "start") commands.push([...event.args]); });
    let result;
    try {
      result = await service.update(repositoryId, assessment.token!, {
        extensionLock: false,
        localRevision: assessment.localRevision!,
        upstreamRevision: assessment.upstreamRevision!,
      });
    } finally {
      useResourceGitObserver();
    }
    assert.equal(result.status, "updated");
    assert.equal(run(consumer, ["rev-parse", "HEAD"]), expected);
    assert.deepEqual(
      commands.filter((args) => ["commit", "stash", "reset", "rebase", "push", "checkout", "switch", "submodule"].includes(args[0])),
      [],
    );
    const merge = commands.find((args) => args.includes("merge"));
    assert.ok(merge?.includes("--ff-only"));
    assert.equal(merge?.at(-1), assessment.upstreamRevision, "only the assessed upstream revision is integrated");
    await assert.rejects(access(hookMarker));
  });

  test("advances a superproject without updating or initializing submodule content", { skip: process.platform === "win32" }, async () => {
    const { root, seed, consumer } = await remotePair();
    const subRemote = path.join(root, "submodule.git");
    const subSeed = path.join(root, "submodule-seed");
    await mkdir(subRemote);
    run(subRemote, ["init", "-q", "--bare", "--initial-branch=main"]);
    await initRepo(subSeed);
    await writeFile(path.join(subSeed, "version.txt"), "one\n");
    const firstSubmoduleRevision = await commitAll(subSeed, "submodule one");
    run(subSeed, ["remote", "add", "origin", subRemote]);
    run(subSeed, ["push", "-q", "-u", "origin", "main"]);

    run(seed, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", subRemote, "vendor/submodule"]);
    await commitAll(seed, "add submodule");
    run(seed, ["push", "-q"]);
    run(consumer, ["pull", "-q", "--ff-only"]);
    run(consumer, ["-c", "protocol.file.allow=always", "submodule", "update", "--init"]);
    assert.equal(run(path.join(consumer, "vendor", "submodule"), ["rev-parse", "HEAD"]), firstSubmoduleRevision);

    await writeFile(path.join(subSeed, "version.txt"), "two\n");
    const secondSubmoduleRevision = await commitAll(subSeed, "submodule two");
    run(subSeed, ["push", "-q"]);
    run(path.join(seed, "vendor", "submodule"), ["fetch", "-q"]);
    run(path.join(seed, "vendor", "submodule"), ["checkout", "-q", secondSubmoduleRevision]);
    run(seed, ["add", "vendor/submodule"]);
    const expectedSuperRevision = await commitAll(seed, "advance submodule pointer");
    run(seed, ["push", "-q"]);

    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([
      resource("skill", path.join(consumer, "skills", "review", "SKILL.md")),
    ]));
    const repositoryId = inventory.repositories[0].id;
    const [assessment] = await service.refresh(repositoryId);
    assert.equal(assessment.status, "updateable");
    assert.equal(assessment.hasSubmodules, true);
    const result = await service.update(repositoryId, assessment.token!, {
      extensionLock: false,
      localRevision: assessment.localRevision!,
      upstreamRevision: assessment.upstreamRevision!,
    });
    assert.equal(result.status, "updated");
    assert.equal(result.submodulesUpdated, false);
    assert.equal(run(consumer, ["rev-parse", "HEAD"]), expectedSuperRevision);
    assert.equal(run(path.join(consumer, "vendor", "submodule"), ["rev-parse", "HEAD"]), firstSubmoduleRevision);
  });

  test("serializes concurrent requests and refuses the stale second token", async () => {
    const { seed, consumer } = await remotePair();
    const skill = path.join(consumer, "skills", "review", "SKILL.md");
    await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "# Remote update\n");
    await commitAll(seed, "update");
    run(seed, ["push", "-q"]);
    const service = new ResourceRepositoryService();
    const otherProcessService = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([resource("skill", skill)]));
    await otherProcessService.buildInventory(input([resource("skill", skill)]));
    const repositoryId = inventory.repositories[0].id;
    const [first] = await service.refresh(repositoryId);
    const [second] = await otherProcessService.refresh(repositoryId);
    const results = await Promise.all([
      service.update(repositoryId, first.token!, {
        extensionLock: false,
        localRevision: first.localRevision!,
        upstreamRevision: first.upstreamRevision!,
      }),
      otherProcessService.update(repositoryId, second.token!, {
        extensionLock: false,
        localRevision: second.localRevision!,
        upstreamRevision: second.upstreamRevision!,
      }),
    ]);
    assert.equal(results.filter((entry) => entry.status === "updated").length, 1);
    assert.equal(results.filter((entry) => entry.status === "refused").length, 1);
  });

  test("binds update consent to the assessed revisions and expiry, then rechecks the worktree", async () => {
    const { seed, consumer } = await remotePair();
    const skill = path.join(consumer, "skills", "review", "SKILL.md");
    await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "# Remote update\n");
    await commitAll(seed, "update");
    run(seed, ["push", "-q"]);
    let now = 1_000;
    const service = new ResourceRepositoryService(path.join(path.dirname(consumer), "managed"), () => now);
    const inventory = await service.buildInventory(input([resource("skill", skill)]));
    const repositoryId = inventory.repositories[0].id;

    const [wrongRevision] = await service.refresh(repositoryId);
    let commands = 0;
    useResourceGitObserver((event) => { if (event.phase === "start") commands += 1; });
    const refusedRevision = await service.update(repositoryId, wrongRevision.token!, {
      extensionLock: false,
      localRevision: "client-selected-revision",
      upstreamRevision: wrongRevision.upstreamRevision!,
    });
    useResourceGitObserver();
    assert.equal(refusedRevision.status, "refused");
    assert.equal(commands, 0, "revision mismatch is refused before Git starts");

    const [expired] = await service.refresh(repositoryId);
    now += 6 * 60_000;
    const refusedExpiry = await service.update(repositoryId, expired.token!, {
      extensionLock: false,
      localRevision: expired.localRevision!,
      upstreamRevision: expired.upstreamRevision!,
    });
    assert.match(refusedExpiry.reason ?? "", /stale/);

    now += 1;
    const [changed] = await service.refresh(repositoryId);
    await writeFile(skill, "# Local change after assessment\n");
    const refusedChange = await service.update(repositoryId, changed.token!, {
      extensionLock: false,
      localRevision: changed.localRevision!,
      upstreamRevision: changed.upstreamRevision!,
    });
    assert.equal(refusedChange.status, "refused");
    assert.equal(refusedChange.assessment?.status, "dirty");
    assert.match(refusedChange.reason ?? "", /changed after assessment/);
  });

  test("requires extension acknowledgement and enforces the lock server-side", async () => {
    const { seed, consumer } = await remotePair();
    const extension = path.join(consumer, "extensions", "review.ts");
    await writeFile(path.join(seed, "extensions", "review.ts"), "export default () => { /* update */ };\n");
    await commitAll(seed, "update extension");
    run(seed, ["push", "-q"]);
    const service = new ResourceRepositoryService();
    const inventory = await service.buildInventory(input([
      resource("skill", path.join(consumer, "skills", "review", "SKILL.md")),
      resource("extension", extension),
    ]));
    assert.equal(inventory.repositories[0].resourceIds.length, 2, "the repository is mixed");
    const repositoryId = inventory.repositories[0].id;
    const [assessment] = await service.refresh(repositoryId);
    assert.equal(assessment.status, "updateable");
    const missingConsent = await service.update(repositoryId, assessment.token!, {
      extensionLock: false,
      localRevision: assessment.localRevision!,
      upstreamRevision: assessment.upstreamRevision!,
    });
    assert.match(missingConsent.reason ?? "", /executable-code confirmation/);
    const [fresh] = await service.refresh(repositoryId);
    const locked = await service.update(repositoryId, fresh.token!, {
      extensionLock: true,
      allowExecutableChanges: true,
      localRevision: fresh.localRevision!,
      upstreamRevision: fresh.upstreamRevision!,
    });
    assert.equal(locked.assessment?.status, "locked");
  });

  test("refuses unknown ids and tokens without starting Git", async () => {
    const service = new ResourceRepositoryService();
    let commands = 0;
    useResourceGitObserver((event) => { if (event.phase === "start") commands += 1; });
    const result = await service.update("resource-repo:unknown", "token", {
      extensionLock: false,
      localRevision: "local",
      upstreamRevision: "upstream",
    });
    assert.deepEqual(result, { status: "refused", repositoryId: "resource-repo:unknown", reason: "Unknown resource repository" });
    assert.equal(commands, 0);
    useResourceGitObserver();

    const { consumer } = await remotePair();
    const knownService = new ResourceRepositoryService();
    const inventory = await knownService.buildInventory(input([
      resource("skill", path.join(consumer, "skills", "review", "SKILL.md")),
    ]));
    commands = 0;
    useResourceGitObserver((event) => { if (event.phase === "start") commands += 1; });
    await assert.rejects(() => knownService.update(inventory.repositories[0].id, "never-issued", {
      extensionLock: false,
      localRevision: "local",
      upstreamRevision: "upstream",
    }), /Unknown update assessment/);
    assert.equal(commands, 0);
    useResourceGitObserver();
  });
});
