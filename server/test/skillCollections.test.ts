/**
 * Skill collections in the configuration: what is persisted, what the next boot
 * loads, and which directories reach the runtime.
 *
 * Read back through `loadConfig` for the same reason as config-persist.test.ts:
 * the property is "the next boot loads what the user chose", not "a key exists".
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { AppConfig } from "../src/config.ts";
import { allSkillPaths, enabledCollectionSkillDirs, loadConfig, persistEditableSettings } from "../src/config.ts";
import { rpcResourceArgs } from "../src/rpcResourceArgs.ts";

async function workspace(config: Record<string, unknown> = {}): Promise<{ dir: string; file: string }> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "pi-outpost-collections-")));
  const file = path.join(dir, "pi-outpost.config.json");
  await writeFile(file, `${JSON.stringify({ cwd: dir, ...config }, null, 2)}\n`);
  return { dir, file };
}

const load = (dir: string, file: string) => loadConfig(dir, { config: file }, {}, { quiet: true });

async function skill(root: string, relative: string, name = path.basename(relative)): Promise<string> {
  const dir = path.join(root, ...relative.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} for tests.\n---\n`);
  return dir;
}

describe("skill collections in the configuration", () => {
  test("a persisted selection is what the next load returns", async () => {
    const { dir, file } = await workspace();
    try {
      const repo = path.join(dir, "collection");
      await skill(repo, "dev-skills/react");
      await skill(repo, "agent-skills/a2a");
      persistEditableSettings(load(dir, file), {
        userSkillCollections: [{ path: repo, managed: true, enabledSkills: ["dev-skills/react", "dev-skills/react"] }],
      }, {});
      const after = load(dir, file);
      assert.deepEqual(after.userSkillCollections, [{ path: repo, managed: true, enabledSkills: ["dev-skills/react"] }]);
      assert.deepEqual(allSkillPaths(after), [path.join(repo, "dev-skills", "react")], "only the skill that is on");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writing a collection leaves the configuration file's skill paths as written", async () => {
    const { dir, file } = await workspace({ skillPaths: ["./deployment-skills"] });
    try {
      await mkdir(path.join(dir, "deployment-skills"), { recursive: true });
      const repo = path.join(dir, "collection");
      await skill(repo, "a/one");
      persistEditableSettings(load(dir, file), { userSkillCollections: [{ path: repo, managed: false, enabledSkills: ["a/one"] }] }, {});
      const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      assert.deepEqual(raw.skillPaths, ["./deployment-skills"]);
      assert.equal(raw.userSkillPaths, undefined, "the user's root list is not invented");
      const after = load(dir, file);
      assert.deepEqual(after.skillPaths, [path.join(dir, "deployment-skills")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("collections come after the configured and user paths", async () => {
    const { dir, file } = await workspace({ skillPaths: ["./deployment"], userSkillPaths: ["./mine"] });
    try {
      await mkdir(path.join(dir, "deployment"), { recursive: true });
      await mkdir(path.join(dir, "mine"), { recursive: true });
      const repo = path.join(dir, "collection");
      await skill(repo, "x/on");
      persistEditableSettings(load(dir, file), { userSkillCollections: [{ path: repo, managed: false, enabledSkills: ["x/on"] }] }, {});
      assert.deepEqual(allSkillPaths(load(dir, file)), [
        path.join(dir, "deployment"),
        path.join(dir, "mine"),
        path.join(repo, "x", "on"),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an enabled skill that is gone, or has no SKILL.md, is not handed on", async () => {
    const { dir } = await workspace();
    try {
      const repo = path.join(dir, "collection");
      await skill(repo, "kept");
      await mkdir(path.join(repo, "empty"), { recursive: true });
      assert.deepEqual(
        enabledCollectionSkillDirs([{ path: repo, managed: false, enabledSkills: ["kept", "vanished", "empty"] }]),
        [path.join(repo, "kept")],
      );
      assert.deepEqual(enabledCollectionSkillDirs([{ path: path.join(dir, "no-repo"), managed: false, enabledSkills: ["kept"] }]), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a symlink cannot carry an outside skill into a collection", async () => {
    const { dir } = await workspace();
    try {
      const repo = path.join(dir, "collection");
      await mkdir(repo, { recursive: true });
      const outside = await skill(dir, "outside/secret");
      await symlink(outside, path.join(repo, "linked"), "dir");
      assert.deepEqual(enabledCollectionSkillDirs([{ path: repo, managed: false, enabledSkills: ["linked"] }]), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a hand-written entry that leaves the repository refuses to load", async () => {
    for (const bad of ["../escape", "/abs/path", "a/../../b", "a\\b", ""]) {
      const { dir, file } = await workspace({ userSkillCollections: [{ path: "./collection", enabledSkills: [bad] }] });
      try {
        assert.throws(() => load(dir, file), /must be a relative path inside the repository/, `rejects ${JSON.stringify(bad)}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  test("entries naming one repository merge", async () => {
    const { dir, file } = await workspace({
      userSkillCollections: [
        { path: "./collection", enabledSkills: ["a"] },
        { path: "./collection", managed: true, enabledSkills: ["b", "a"] },
      ],
    });
    try {
      assert.deepEqual(load(dir, file).userSkillCollections, [
        { path: path.join(dir, "collection"), managed: true, enabledSkills: ["a", "b"] },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the sandbox may read an enabled collection skill outside its root", async () => {
    const { dir, file } = await workspace();
    try {
      const project = path.join(dir, "project");
      await mkdir(project, { recursive: true });
      const repo = path.join(dir, "collection");
      await skill(repo, "on");
      await skill(repo, "off");
      await writeFile(file, `${JSON.stringify({
        cwd: project,
        sandbox: { root: project },
        userSkillCollections: [{ path: repo, enabledSkills: ["on"] }],
      })}\n`);
      const exceptions = load(dir, file).sandbox!.readExceptions;
      assert.ok(exceptions.includes(path.join(repo, "on")));
      assert.ok(!exceptions.includes(path.join(repo, "off")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the RPC child receives one --skill per enabled skill", async () => {
    const { dir } = await workspace();
    try {
      const repo = path.join(dir, "collection");
      await skill(repo, "g/one");
      await skill(repo, "g/two");
      await skill(repo, "g/off");
      const args = rpcResourceArgs(
        {
          noExtensions: false, extensionPaths: [], userExtensionPaths: [], extensionScripts: [],
          noSkills: false, skillPaths: [], userSkillPaths: [], noPromptTemplates: false, promptPaths: [], offline: false,
          userSkillCollections: [{ path: repo, managed: false, enabledSkills: ["g/one", "g/two"] }],
        } as unknown as AppConfig,
        { bundledSkills: [], appendSystemPrompt: [] },
      );
      assert.deepEqual(args, ["--skill", path.join(repo, "g", "one"), "--skill", path.join(repo, "g", "two")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
