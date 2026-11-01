/**
 * Persisting what the interface changed: `persistEditableSettings`.
 *
 * These tests read the file back with `loadConfig` rather than only inspecting
 * the JSON — the property that matters is not "a key was written" but "the next
 * boot loads what the user chose", and only the loader can say that.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { allSkillPaths, ConfigWriteError, loadConfig, persistEditableSettings } from "../src/config.ts";

async function workspace(config: Record<string, unknown>): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-outpost-persist-"));
  const file = path.join(dir, "pi-outpost.config.json");
  await writeFile(file, `${JSON.stringify({ cwd: dir, ...config }, null, 2)}\n`);
  return { dir, file };
}

const load = (dir: string, file: string, env: NodeJS.ProcessEnv = {}) =>
  loadConfig(dir, { config: file }, env, { quiet: true });

describe("persistEditableSettings", () => {
  test("writes a user skill path the next load returns", async () => {
    const { dir, file } = await workspace({ skillPaths: [] });
    try {
      await mkdir(path.join(dir, "shared-skills"), { recursive: true });
      const config = load(dir, file);
      persistEditableSettings(config, { userSkillPaths: [path.join(dir, "shared-skills")] }, {});
      assert.deepEqual(load(dir, file).userSkillPaths, [path.join(dir, "shared-skills")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("never rewrites the configuration file's own skillPaths", async () => {
    const { dir, file } = await workspace({ skillPaths: ["./deployment-skills"] });
    try {
      await mkdir(path.join(dir, "deployment-skills"), { recursive: true });
      await mkdir(path.join(dir, "mine"), { recursive: true });

      // An apply that carries an empty user list — the user removed their own
      // additions — must not take the deployment's skills with it.
      persistEditableSettings(load(dir, file), { userSkillPaths: [] }, {});
      const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      assert.deepEqual(raw.skillPaths, ["./deployment-skills"], "written as the operator wrote it");
      assert.deepEqual(load(dir, file).skillPaths, [path.join(dir, "deployment-skills")]);

      persistEditableSettings(load(dir, file), { userSkillPaths: [path.join(dir, "mine")] }, {});
      const after = load(dir, file);
      assert.deepEqual(after.skillPaths, [path.join(dir, "deployment-skills")]);
      assert.deepEqual(after.userSkillPaths, [path.join(dir, "mine")]);
      assert.deepEqual(allSkillPaths(after), [path.join(dir, "deployment-skills"), path.join(dir, "mine")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps unrelated configuration values", async () => {
    const { dir, file } = await workspace({
      branding: { title: "π test" },
      server: { port: 3999, host: "127.0.0.1" },
      noPromptTemplates: true,
      skillPaths: [],
    });
    try {
      await mkdir(path.join(dir, "skills"), { recursive: true });
      persistEditableSettings(load(dir, file), { userSkillPaths: [path.join(dir, "skills")] }, {});

      const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      assert.deepEqual(raw.branding, { title: "π test" });
      assert.deepEqual(raw.server, { port: 3999, host: "127.0.0.1" });
      assert.equal(raw.noPromptTemplates, true);
      const reloaded = load(dir, file);
      assert.equal(reloaded.port, 3999);
      assert.equal(reloaded.branding.title, "π test");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes sandbox fields and leaves the sandbox's other keys alone", async () => {
    const { dir, file } = await workspace({
      sandbox: { root: ".", allowWrite: false, allowBash: false },
      skillPaths: [],
    });
    try {
      await mkdir(path.join(dir, "work", "out"), { recursive: true });
      persistEditableSettings(
        load(dir, file),
        { sandbox: { root: path.join(dir, "work"), allowWrite: true, allowBash: false, writableRoot: path.join(dir, "work", "out") } },
        {},
      );

      const reloaded = load(dir, file);
      assert.equal(reloaded.sandbox?.root, path.join(dir, "work"));
      assert.equal(reloaded.sandbox?.allowWrite, true);
      assert.equal(reloaded.sandbox?.writableRoot, path.join(dir, "work", "out"));
      assert.equal(reloaded.sandbox?.allowBash, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // openlore: scenario=ApplyingSettingsKeepsTheRunner spec=sandbox-runner-bash
  test("a Settings change to the default sandbox keeps its shell confined: the section is written with \"auto\"", async () => {
    const { dir, file } = await workspace({ skillPaths: [] });
    try {
      const before = load(dir, file);
      assert.ok(before.sandbox?.autoRunner, "no section: the default, with a runner the server chooses");
      persistEditableSettings(before, { sandbox: { root: dir, allowWrite: false, allowBash: true } }, {});
      const raw = JSON.parse(await readFile(file, "utf8")) as { sandbox: Record<string, unknown> };
      assert.equal(raw.sandbox.bashRunner, "auto", "not the unconfined legacy spelling");
      const after = load(dir, file);
      assert.equal(after.sandbox?.allowWrite, false);
      assert.ok(after.sandbox?.autoRunner);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a Settings change to an explicit unconfined section leaves it unconfined", async () => {
    const { dir, file } = await workspace({ sandbox: { root: ".", allowBash: true } });
    try {
      persistEditableSettings(load(dir, file), { sandbox: { root: dir, allowWrite: true, allowBash: true } }, {});
      const raw = JSON.parse(await readFile(file, "utf8")) as { sandbox: Record<string, unknown> };
      assert.equal(raw.sandbox.bashRunner, undefined);
      assert.equal(load(dir, file).sandbox?.autoRunner, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("clears writableRoot when the update drops it", async () => {
    const { dir, file } = await workspace({
      sandbox: { root: ".", allowWrite: true, writableRoot: "./out" },
    });
    try {
      await mkdir(path.join(dir, "out"), { recursive: true });
      persistEditableSettings(load(dir, file), { sandbox: { root: dir, allowWrite: true, allowBash: false } }, {});

      const raw = JSON.parse(await readFile(file, "utf8")) as { sandbox: Record<string, unknown> };
      assert.equal("writableRoot" in raw.sandbox, false);
      assert.equal(load(dir, file).sandbox?.writableRoot, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a settings value outranks PI_OUTPOST_CWD on the next start", async () => {
    // Without an explicit root, the sandbox follows `cwd` — which the environment
    // can move. The point of writing it is that it stops being able to.
    const { dir, file } = await workspace({ sandbox: { allowWrite: false, allowBash: false } });
    try {
      const elsewhere = await mkdtemp(path.join(tmpdir(), "pi-outpost-elsewhere-"));
      await mkdir(path.join(dir, "chosen"), { recursive: true });
      try {
        const moved = load(dir, file, { PI_OUTPOST_CWD: elsewhere });
        assert.equal(moved.sandbox?.root, elsewhere, "precondition: the variable moves an implicit root");

        persistEditableSettings(load(dir, file), { sandbox: { root: path.join(dir, "chosen"), allowWrite: false, allowBash: false } }, {});

        const afterRestart = load(dir, file, { PI_OUTPOST_CWD: elsewhere });
        assert.equal(afterRestart.sandbox?.root, path.join(dir, "chosen"));
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses a merged configuration that would not load, leaving the file untouched", async () => {
    const { dir, file } = await workspace({ sandbox: { root: ".", allowWrite: false, allowBash: false } });
    try {
      const before = await readFile(file, "utf8");
      assert.throws(
        () => persistEditableSettings(load(dir, file), { sandbox: { root: path.join(dir, "nope"), allowWrite: false, allowBash: false } }, {}),
        (error: unknown) => error instanceof ConfigWriteError && /does not exist/.test((error as Error).message),
      );
      assert.equal(await readFile(file, "utf8"), before);
      assert.equal(load(dir, file).sandbox?.root, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("leaves no temporary file behind when validation refuses the update", async () => {
    const { dir, file } = await workspace({ sandbox: { root: ".", allowWrite: false, allowBash: false } });
    try {
      assert.throws(() =>
        persistEditableSettings(load(dir, file), { sandbox: { root: path.join(dir, "nope"), allowWrite: false, allowBash: false } }, {}),
      );
      assert.deepEqual(fs.readdirSync(dir), ["pi-outpost.config.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports a file it cannot write, and changes nothing", async (t) => {
    if (process.platform === "win32") return t.skip("a read-only directory still accepts writes here");
    const { dir, file } = await workspace({ skillPaths: [] });
    try {
      const before = await readFile(file, "utf8");
      const config = load(dir, file);
      // Read-only directory: the candidate cannot even be created.
      await chmod(dir, 0o500);
      try {
        assert.throws(
          () => persistEditableSettings(config, { userSkillPaths: [dir] }, {}),
          (error: unknown) => error instanceof ConfigWriteError && /cannot save/.test((error as Error).message),
        );
      } finally {
        await chmod(dir, 0o700);
      }
      assert.equal(await readFile(file, "utf8"), before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports a configuration file that is no longer valid JSON", async () => {
    const { dir, file } = await workspace({ skillPaths: [] });
    try {
      const config = load(dir, file);
      await writeFile(file, "{ not json");
      assert.throws(
        () => persistEditableSettings(config, { userSkillPaths: [dir] }, {}),
        (error: unknown) => error instanceof ConfigWriteError && /cannot read/.test((error as Error).message),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps the file's permissions", async (t) => {
    if (process.platform === "win32") return t.skip("POSIX permission bits are not meaningful here");
    const { dir, file } = await workspace({ skillPaths: [], server: { token: "s3cret" } });
    try {
      await chmod(file, 0o600);
      persistEditableSettings(load(dir, file), { userSkillPaths: [dir] }, {});
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
