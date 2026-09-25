import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  fail,
  optionalString,
  optionalBoolean,
  optionalStringArray,
  optionalModelList,
  asObject,
  applyDirectories,
  applyRuntime,
  requireTokenOffLoopback,
  userConfigDir,
  loadConfig,
} from "../src/config.ts";
import type { AppConfig, CliOptions } from "../src/config.ts";
import { parseCli } from "../src/cli.ts";
import { STRUCTURED_EXCHANGE_BYTES_CEILING_ANY } from "@pi-outpost/shared/structured-exchange/bounds";

// ---------------------------------------------------------------------------
// fail
// ---------------------------------------------------------------------------
describe("fail", () => {
  test("throws an Error with [config] prefix", () => {
    assert.throws(() => fail("something went wrong"), { message: "[config] something went wrong" });
  });

  test("throws on empty message", () => {
    assert.throws(() => fail(""), { message: "[config] " });
  });
});

// ---------------------------------------------------------------------------
// optionalString
// ---------------------------------------------------------------------------
describe("optionalString", () => {
  test("returns undefined when key is missing", () => {
    assert.equal(optionalString({}, "name"), undefined);
  });

  test("returns the value when present", () => {
    assert.equal(optionalString({ name: "hello" }, "name"), "hello");
  });

  test("fails on empty string", () => {
    assert.throws(() => optionalString({ name: "" }, "name"), { message: /must be a non-empty string/ });
  });

  test("fails on non-string type", () => {
    assert.throws(() => optionalString({ name: 42 }, "name"), { message: /must be a non-empty string/ });
    assert.throws(() => optionalString({ name: true }, "name"), { message: /must be a non-empty string/ });
    assert.throws(() => optionalString({ name: null }, "name"), { message: /must be a non-empty string/ });
    assert.throws(() => optionalString({ name: [] }, "name"), { message: /must be a non-empty string/ });
  });

  test("includes the key name in the error", () => {
    assert.throws(() => optionalString({ port: "" }, "port"), { message: /"port" must be/ });
  });
});

// ---------------------------------------------------------------------------
// optionalBoolean
// ---------------------------------------------------------------------------
describe("optionalBoolean", () => {
  test("returns fallback when key is missing", () => {
    assert.equal(optionalBoolean({}, "enabled", true), true);
    assert.equal(optionalBoolean({}, "enabled", false), false);
  });

  test("returns the value when present", () => {
    assert.equal(optionalBoolean({ verbose: true }, "verbose", false), true);
    assert.equal(optionalBoolean({ verbose: false }, "verbose", true), false);
  });

  test("fails on non-boolean type", () => {
    assert.throws(() => optionalBoolean({ flag: "yes" }, "flag", false), { message: /must be a boolean/ });
    assert.throws(() => optionalBoolean({ flag: 1 }, "flag", false), { message: /must be a boolean/ });
    assert.throws(() => optionalBoolean({ flag: null }, "flag", false), { message: /must be a boolean/ });
  });
});

// ---------------------------------------------------------------------------
// optionalStringArray
// ---------------------------------------------------------------------------
describe("optionalStringArray", () => {
  test("returns undefined when key is missing", () => {
    assert.equal(optionalStringArray({}, "items"), undefined);
  });

  test("returns the array when valid", () => {
    assert.deepEqual(optionalStringArray({ tools: ["read", "grep"] }, "tools"), ["read", "grep"]);
  });

  test("returns empty array", () => {
    assert.deepEqual(optionalStringArray({ tools: [] }, "tools"), []);
  });

  test("fails on non-array", () => {
    assert.throws(() => optionalStringArray({ tools: "read" }, "tools"), { message: /must be an array of strings/ });
    assert.throws(() => optionalStringArray({ tools: 42 }, "tools"), { message: /must be an array of strings/ });
  });

  test("fails on array with non-string elements", () => {
    assert.throws(() => optionalStringArray({ tools: ["read", 42] }, "tools"), {
      message: /must be an array of strings/,
    });
    assert.throws(() => optionalStringArray({ tools: [null] }, "tools"), {
      message: /must be an array of strings/,
    });
  });
});

// ---------------------------------------------------------------------------
// asObject
// ---------------------------------------------------------------------------
describe("asObject", () => {
  test("returns the value when it is a non-null object", () => {
    assert.deepEqual(asObject({ a: 1 }, "test"), { a: 1 });
  });

  test("fails on null", () => {
    assert.throws(() => asObject(null, "x"), { message: /"x" must be an object/ });
  });

  test("fails on array", () => {
    assert.throws(() => asObject([], "x"), { message: /"x" must be an object/ });
  });

  test("fails on primitive types", () => {
    assert.throws(() => asObject("str", "x"), { message: /"x" must be an object/ });
    assert.throws(() => asObject(42, "x"), { message: /"x" must be an object/ });
    assert.throws(() => asObject(true, "x"), { message: /"x" must be an object/ });
  });
});

// ---------------------------------------------------------------------------
// optionalModelList
// ---------------------------------------------------------------------------
describe("optionalModelList", () => {
  test("returns undefined when key is missing", () => {
    assert.equal(optionalModelList({}, "models"), undefined);
  });

  test("validates and returns model objects", () => {
    const result = optionalModelList(
      { models: [{ provider: "anthropic", id: "claude-3" }] },
      "models",
    );
    assert.deepEqual(result, [{ provider: "anthropic", id: "claude-3" }]);
  });

  test("fails on non-array", () => {
    assert.throws(() => optionalModelList({ models: "not-array" }, "models"), {
      message: /must be an array/,
    });
  });

  test("fails on array with non-object entries", () => {
    assert.throws(() => optionalModelList({ models: ["string"] }, "models"), {
      message: /must be an object/,
    });
  });

  test("fails on missing provider or id", () => {
    assert.throws(
      () => optionalModelList({ models: [{ id: "claude-3" }] }, "models"),
      { message: /must have "provider" and "id"/ },
    );
    assert.throws(
      () => optionalModelList({ models: [{ provider: "anthropic" }] }, "models"),
      { message: /must have "provider" and "id"/ },
    );
  });
});

// ---------------------------------------------------------------------------
// applyDirectories
// ---------------------------------------------------------------------------
describe("applyDirectories", () => {
  const baseConfig = (): AppConfig =>
    ({
      configFile: "/tmp/test.json",
      cwd: "/default",
      noExtensions: false,
      extensionPaths: [],
      extensionScripts: [],
      noSkills: false,
      skillPaths: [],
      noPromptTemplates: false,
      promptPaths: [],
      appendSystemPrompt: [],
      webContext: true,
      offline: false,
      port: 3141,
      host: "127.0.0.1",
      allowedOrigins: [],
      branding: {},
    }) as AppConfig;

  test("keeps defaults when nothing is overridden", () => {
    const config = baseConfig();
    const flags: CliOptions = {};
    applyDirectories(config, flags, {});
    assert.equal(config.cwd, "/default");
    assert.equal(config.agentDir, undefined);
  });

  test("env var overrides cwd", () => {
    const config = baseConfig();
    applyDirectories(config, {}, { PI_OUTPOST_CWD: "/env/cwd" });
    assert.equal(config.cwd, path.resolve("/env/cwd"));
  });

  test("env var overrides agentDir", () => {
    const config = baseConfig();
    applyDirectories(config, {}, { PI_OUTPOST_AGENT_DIR: "/env/agent" });
    assert.equal(config.agentDir, path.resolve("/env/agent"));
  });

  test("flag overrides env var for cwd", () => {
    const config = baseConfig();
    applyDirectories(config, { cwd: "/flag/cwd" }, { PI_OUTPOST_CWD: "/env/cwd" });
    assert.equal(config.cwd, path.resolve("/flag/cwd"));
  });

  test("flag overrides env var for agentDir", () => {
    const config = baseConfig();
    applyDirectories(config, { agentDir: "/flag/agent" }, { PI_OUTPOST_AGENT_DIR: "/env/agent" });
    assert.equal(config.agentDir, path.resolve("/flag/agent"));
  });
});

// ---------------------------------------------------------------------------
// applyRuntime
// ---------------------------------------------------------------------------
describe("applyRuntime", () => {
  const baseConfig = (): AppConfig =>
    ({
      configFile: "/tmp/test.json",
      cwd: "/tmp",
      noExtensions: false,
      extensionPaths: [],
      extensionScripts: [],
      noSkills: false,
      skillPaths: [],
      noPromptTemplates: false,
      promptPaths: [],
      appendSystemPrompt: [],
      webContext: true,
      offline: false,
      port: 3141,
      host: "127.0.0.1",
      allowedOrigins: [],
      branding: {},
    }) as AppConfig;

  test("keeps defaults when nothing is set", () => {
    const config = baseConfig();
    applyRuntime(config, {}, {});
    assert.equal(config.port, 3141);
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.token, undefined);
  });

  test("PI_OUTPOST_PORT sets the port", () => {
    const config = baseConfig();
    applyRuntime(config, {}, { PI_OUTPOST_PORT: "4001" });
    assert.equal(config.port, 4001);
  });

  test("bare PORT is honoured", () => {
    const config = baseConfig();
    applyRuntime(config, {}, { PORT: "4002" });
    assert.equal(config.port, 4002);
  });

  test("PI_OUTPOST_PORT beats bare PORT", () => {
    const config = baseConfig();
    applyRuntime(config, {}, { PI_OUTPOST_PORT: "4003", PORT: "4002" });
    assert.equal(config.port, 4003);
  });

  test("offline defaults to off", () => {
    const config = baseConfig();
    applyRuntime(config, {}, {});
    assert.equal(config.offline, false);
  });

  test("PI_OFFLINE turns offline on", () => {
    const config = baseConfig();
    applyRuntime(config, {}, { PI_OFFLINE: "1" });
    assert.equal(config.offline, true);
  });

  test("an empty PI_OFFLINE is not a value", () => {
    const config = baseConfig();
    applyRuntime(config, {}, { PI_OFFLINE: "" });
    assert.equal(config.offline, false);
  });

  test("--offline turns offline on", () => {
    const config = baseConfig();
    applyRuntime(config, { offline: true }, {});
    assert.equal(config.offline, true);
  });

  test("no flag leaves an offline config file alone", () => {
    // The flag defaults to false in the parser; it must not undo `"offline": true`.
    const config = { ...baseConfig(), offline: true };
    applyRuntime(config, {}, {});
    assert.equal(config.offline, true);
  });

  test("PI_OUTPOST_PORT must be a valid port number", () => {
    const config = baseConfig();
    assert.throws(() => applyRuntime(config, {}, { PI_OUTPOST_PORT: "not-a-number" }), {
      message: /PI_OUTPOST_PORT must be a port number/,
    });
    assert.throws(() => applyRuntime(config, {}, { PI_OUTPOST_PORT: "0" }), {
      message: /PI_OUTPOST_PORT must be a port number/,
    });
    assert.throws(() => applyRuntime(config, {}, { PI_OUTPOST_PORT: "70000" }), {
      message: /PI_OUTPOST_PORT must be a port number/,
    });
  });

  test("empty PI_OUTPOST_PORT is ignored", () => {
    const config = baseConfig();
    applyRuntime(config, {}, { PI_OUTPOST_PORT: "" });
    assert.equal(config.port, 3141);
  });

  test("PI_OUTPOST_HOST overrides host", () => {
    const config = baseConfig();
    applyRuntime(config, {}, { PI_OUTPOST_HOST: "0.0.0.0" });
    assert.equal(config.host, "0.0.0.0");
  });

  test("PI_OUTPOST_TOKEN sets the token", () => {
    const config = baseConfig();
    applyRuntime(config, {}, { PI_OUTPOST_TOKEN: "secret" });
    assert.equal(config.token, "secret");
  });

  test("PI_OUTPOST_TOKEN must not be empty", () => {
    const config = baseConfig();
    assert.throws(() => applyRuntime(config, {}, { PI_OUTPOST_TOKEN: "" }), {
      message: /PI_OUTPOST_TOKEN must not be empty/,
    });
  });

  test("flag port beats env port", () => {
    const config = baseConfig();
    applyRuntime(config, { port: 4005 }, { PI_OUTPOST_PORT: "4001" });
    assert.equal(config.port, 4005);
  });

  test("flag host beats env host", () => {
    const config = baseConfig();
    applyRuntime(config, { host: "::1" }, { PI_OUTPOST_HOST: "0.0.0.0" });
    assert.equal(config.host, "::1");
  });
});

// ---------------------------------------------------------------------------
// requireTokenOffLoopback
// ---------------------------------------------------------------------------
describe("requireTokenOffLoopback", () => {
  const loopbackConfig = (host: string, token?: string): AppConfig =>
    ({
      configFile: "/tmp/test.json",
      cwd: "/tmp",
      host,
      token,
      noExtensions: false,
      extensionPaths: [],
      extensionScripts: [],
      noSkills: false,
      skillPaths: [],
      noPromptTemplates: false,
      promptPaths: [],
      appendSystemPrompt: [],
      webContext: true,
      offline: false,
      port: 3141,
      allowedOrigins: [],
      branding: {},
    }) as AppConfig;

  test("allows loopback hosts without token", () => {
    for (const host of ["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]) {
      assert.doesNotThrow(() => requireTokenOffLoopback(loopbackConfig(host)));
    }
  });

  test("allows any host with a token", () => {
    assert.doesNotThrow(() => requireTokenOffLoopback(loopbackConfig("0.0.0.0", "secret")));
    assert.doesNotThrow(() => requireTokenOffLoopback(loopbackConfig("192.168.1.1", "secret")));
  });

  test("refuses off-loopback host without token", () => {
    assert.throws(() => requireTokenOffLoopback(loopbackConfig("0.0.0.0")), {
      message: /refusing to listen on 0.0.0.0/,
    });
    assert.throws(() => requireTokenOffLoopback(loopbackConfig("192.168.1.1")), {
      message: /refusing to listen on 192.168.1.1/,
    });
  });
});

// ---------------------------------------------------------------------------
// userConfigDir
// ---------------------------------------------------------------------------
describe("userConfigDir", () => {
  test("uses XDG_CONFIG_HOME when set", () => {
    const result = userConfigDir({ XDG_CONFIG_HOME: "/custom/xdg" });
    assert.equal(result, path.join("/custom/xdg", "pi-outpost"));
  });

  test("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
    // We can't mock homedir easily, so just check it contains the suffix
    const result = userConfigDir({});
    const suffix = path.sep + "pi-outpost";
    assert.ok(result.endsWith(suffix), `expected ...${suffix}, got ${result}`);
    assert.ok(!result.includes("xdg") || result.includes("XDG_CONFIG_HOME") === false);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — relative path resolution
// ---------------------------------------------------------------------------
describe("loadConfig — resource path resolution", () => {
  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-outpost-config-test-"));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("an existing configuration that never opened a project is served as before", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      // Backward compatibility is the whole of this: nothing opened means one
      // workspace at cwd, not an empty server and not a migration step.
      await writeFile(configPath, JSON.stringify({}, null, 2));
      const config = loadConfig(dir, { config: configPath });
      assert.deepEqual(config.openProjects, []);
      assert.equal(config.workspaceLock, false);
    });
  });

  test("open projects are resolved against the config file, like every other path", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      // Absolute means absolute on THIS platform. A bare "/srv/gamma" is not
      // absolute on Windows — it is rooted on whichever drive the process is on,
      // so resolving it there legitimately yields "C:\\srv\\gamma" and an
      // assertion written against the POSIX spelling fails for no real reason.
      const absolute = path.resolve(path.sep, "srv", "gamma");
      await writeFile(configPath, JSON.stringify({ openProjects: ["./beta", absolute] }, null, 2));
      // A relative entry has to mean the same thing here as it does for every
      // other configured path, or the set moves with the process's cwd; an
      // absolute one has to come back untouched.
      assert.deepEqual(loadConfig(dir, { config: configPath }).openProjects, [path.join(dir, "beta"), absolute]);
    });
  });

  // openlore: scenario=SettingsModeIsTheDefault spec=config
  test("an embed policy is absent until one is configured, and absence means settings", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      // The interface every embed had before the setting existed. Nothing else may
      // become the default without changing what deployed widgets show.
      assert.equal(loadConfig(dir, { config: configPath }).embed.workspaceControls, "settings");
    });
  });

  // openlore: scenario=ProjectsModeIsConfigured spec=config
  // openlore: scenario=RootModeIsConfigured spec=config
  test("every accepted embed workspace-control value is loaded as written", async () => {
    for (const mode of ["settings", "root", "projects"] as const) {
      await withTempDir(async (dir) => {
        const configPath = path.join(dir, "config.json");
        await writeFile(configPath, JSON.stringify({ embed: { workspaceControls: mode } }, null, 2));
        assert.equal(loadConfig(dir, { config: configPath }).embed.workspaceControls, mode);
      });
    }
  });

  // openlore: scenario=InvalidEmbedWorkspaceControls spec=config
  test("an unknown embed workspace-control value fails startup, naming the setting", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ embed: { workspaceControls: "everything" } }, null, 2));
      // Naming the setting is the point: a typo that silently fell back to the
      // default would leave an operator looking for a control they configured.
      assert.throws(() => loadConfig(dir, { config: configPath }), /embed\.workspaceControls/);
    });
  });

  test("workspaceIdleTimeoutMs takes 0 as \"never retire\", and refuses nonsense", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).workspaceIdleTimeoutMs, 30 * 60_000);

      // 0 is a value, not an absence: it turns retirement off, which is why the
      // positive-integer helper cannot be used here.
      await writeFile(configPath, JSON.stringify({ workspaceIdleTimeoutMs: 0 }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).workspaceIdleTimeoutMs, 0);

      await writeFile(configPath, JSON.stringify({ workspaceIdleTimeoutMs: 90_000 }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).workspaceIdleTimeoutMs, 90_000);

      for (const bad of [-1, 1.5, "60000", true, null]) {
        await writeFile(configPath, JSON.stringify({ workspaceIdleTimeoutMs: bad }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"workspaceIdleTimeoutMs"/);
      }
    });
  });

  test("updateCheck stays a tri-state, so offline can still decide", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      // Unset must stay *unset*, not become false: the whole point is that `offline`
      // gets to decide when nobody has said otherwise, and a stored default would
      // make "not mentioned" indistinguishable from "explicitly off".
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).updateCheck, undefined);

      await writeFile(configPath, JSON.stringify({ updateCheck: true }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).updateCheck, true);

      await writeFile(configPath, JSON.stringify({ updateCheck: false }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).updateCheck, false);
    });
  });

  test("updateCheck refuses a value that is not a boolean", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      for (const updateCheck of ["yes", 1, null, {}]) {
        await writeFile(configPath, JSON.stringify({ updateCheck }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"updateCheck" must be a boolean/);
      }
    });
  });

  test("updateRegistry is optional and taken as given", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).updateRegistry, undefined);

      await writeFile(configPath, JSON.stringify({ updateRegistry: "https://nexus.internal/repository/npm" }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).updateRegistry, "https://nexus.internal/repository/npm");
    });
  });

  test("updateRegistry refuses anything that is not an http(s) URL", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      // Caught at load rather than at the first check: that check runs in the
      // background and says nothing when it fails, so a bad address there would
      // simply never be discovered.
      for (const updateRegistry of ["nexus.internal", "not a url", 42, true]) {
        await writeFile(configPath, JSON.stringify({ updateRegistry }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"updateRegistry"/);
      }
      // A URL, but not one that can be fetched.
      await writeFile(configPath, JSON.stringify({ updateRegistry: "ftp://nexus.internal" }, null, 2));
      assert.throws(() => loadConfig(dir, { config: configPath }), /"updateRegistry" must be an http or https URL/);
    });
  });

  // openlore: scenario=UnsetResolvesFromTheEnvironment spec=config
  test("gitPath is optional and taken as given", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).gitPath, undefined);

      await writeFile(configPath, JSON.stringify({ gitPath: "C:\\Program Files\\Git\\cmd\\git.exe" }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).gitPath, "C:\\Program Files\\Git\\cmd\\git.exe");
    });
  });

  // openlore: scenario=InvalidExecutableValue spec=config
  test("gitPath refuses a value that names nothing", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      // Only the shape is checked here — whether it RUNS is a question for startup,
      // which is the one moment an operator is watching
      for (const gitPath of ["", "   ", 42, true]) {
        await writeFile(configPath, JSON.stringify({ gitPath }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"gitPath"/);
      }
    });
  });

  // openlore: scenario=DeclaringOneModel spec=config
  test("thinkingLevels declares what a model accepts, provider-wide or per model", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).thinkingLevels, undefined);

      await writeFile(
        configPath,
        JSON.stringify(
          {
            thinkingLevels: [
              { provider: "maison", levels: ["off"] },
              { provider: "maison", id: "big", levels: ["medium", "low"] },
            ],
          },
          null,
          2,
        ),
      );
      const declared = loadConfig(dir, { config: configPath }).thinkingLevels;
      assert.deepEqual(declared?.[0], { provider: "maison", levels: ["off"] });
      // Normalised the way a runtime-reported list is: canonical order, `off` ensured
      assert.deepEqual(declared?.[1], { provider: "maison", id: "big", levels: ["off", "low", "medium"] });
    });
  });

  // openlore: scenario=AnEntryThatAcceptsNothing spec=config
  test("thinkingLevels refuses an entry that names no usable level", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      // A model accepting nothing at all cannot be asked for anything: far likelier a
      // typo than an intention, and boot is when to say so
      for (const levels of [[], ["ludicrous"], ["nope", "also-nope"]]) {
        await writeFile(configPath, JSON.stringify({ thinkingLevels: [{ provider: "maison", levels }] }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"thinkingLevels\[0\]"/);
      }
    });
  });

  // openlore: scenario=UnknownLevelName spec=config
  test("thinkingLevels keeps the known levels of a list that also names an unknown one", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({ thinkingLevels: [{ provider: "maison", levels: ["low", "ludicrous"] }] }, null, 2),
      );
      assert.deepEqual(loadConfig(dir, { config: configPath }).thinkingLevels?.[0].levels, ["off", "low"]);
    });
  });

  test("thinkingLevels refuses a malformed entry, naming it", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      for (const entry of [{ levels: ["off"] }, { provider: "maison" }, "maison", 42]) {
        await writeFile(configPath, JSON.stringify({ thinkingLevels: [entry] }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"thinkingLevels\[0\]"/);
      }
      await writeFile(configPath, JSON.stringify({ thinkingLevels: "off" }, null, 2));
      assert.throws(() => loadConfig(dir, { config: configPath }), /"thinkingLevels" must be an array/);
    });
  });

  test("files.watch defaults to on and can be turned off", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      // On without being configured to: a workspace browser that silently lies
      // about the workspace is worse than none, so the truthful setting is the
      // one you get for free.
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).files.watch, true);

      await writeFile(configPath, JSON.stringify({ files: { watch: false } }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).files.watch, false);
    });
  });

  test("files.watch refuses a value that is not a boolean", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      for (const watch of ["yes", 1, null, {}]) {
        await writeFile(configPath, JSON.stringify({ files: { watch } }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"files\.watch" must be a boolean/);
      }
    });
  });

  test("pdf.maxBytes defaults to 25 MB and can be raised or lowered", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).pdf.maxBytes, 26_214_400);

      await writeFile(configPath, JSON.stringify({ pdf: { maxBytes: 5_000_000 } }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).pdf.maxBytes, 5_000_000);
    });
  });

  test("docx.maxBytes defaults to 25 MB and can be changed", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).docx.maxBytes, 26_214_400);

      await writeFile(configPath, JSON.stringify({ docx: { maxBytes: 4_000_000 } }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).docx.maxBytes, 4_000_000);
    });
  });

  test("docx.maxBytes refuses a value that is not a positive integer", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      for (const maxBytes of ["25MB", 0, -1, 1.5]) {
        await writeFile(configPath, JSON.stringify({ docx: { maxBytes } }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"docx.maxBytes" must be a positive integer/);
      }
    });
  });

  test("xlsx.maxBytes defaults to 25 MB and can be changed", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).xlsx.maxBytes, 26_214_400);

      await writeFile(configPath, JSON.stringify({ xlsx: { maxBytes: 4_000_000 } }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).xlsx.maxBytes, 4_000_000);
    });
  });

  test("xlsx.maxBytes refuses a value that is not a positive integer", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      for (const maxBytes of ["25MB", 0, -1, 1.5]) {
        await writeFile(configPath, JSON.stringify({ xlsx: { maxBytes } }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"xlsx.maxBytes" must be a positive integer/);
      }
    });
  });

  test("pptx.maxBytes defaults to 25 MB and can be changed", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).pptx.maxBytes, 26_214_400);

      await writeFile(configPath, JSON.stringify({ pptx: { maxBytes: 4_000_000 } }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).pptx.maxBytes, 4_000_000);
    });
  });

  test("pptx.maxBytes refuses a value that is not a positive integer", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      for (const maxBytes of ["25MB", 0, -1, 1.5]) {
        await writeFile(configPath, JSON.stringify({ pptx: { maxBytes } }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"pptx.maxBytes" must be a positive integer/);
      }
    });
  });

  test("office rendering defaults to auto and accepts a renderer, executables and a timeout", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      const defaults = loadConfig(dir, { config: configPath }).office;
      assert.equal(defaults.renderer, "auto");
      assert.equal(defaults.renderTimeoutMs, 120_000);
      assert.equal(defaults.libreofficePath, undefined);

      await writeFile(
        configPath,
        JSON.stringify({ office: { renderer: "word", libreofficePath: "tools/soffice", onlyofficePath: path.join(dir, "oo", "docbuilder"), renderTimeoutMs: 30_000 } }, null, 2),
      );
      const office = loadConfig(dir, { config: configPath }).office;
      assert.equal(office.renderer, "word");
      // Relative to the configuration file, like every other path in it.
      assert.equal(office.libreofficePath, path.resolve(dir, "tools/soffice"));
      assert.equal(office.onlyofficePath, path.join(dir, "oo", "docbuilder"));
      assert.equal(office.renderTimeoutMs, 30_000);
    });
  });

  test("office rendering settings refuse what they cannot use", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ office: { renderer: "keynote" } }, null, 2));
      assert.throws(() => loadConfig(dir, { config: configPath }), /"office.renderer" must be one of "auto", "word", "powerpoint", "libreoffice", "onlyoffice"/);
      await writeFile(configPath, JSON.stringify({ office: { libreofficePath: "" } }, null, 2));
      assert.throws(() => loadConfig(dir, { config: configPath }), /"office.libreofficePath" must be a non-empty path/);
      for (const renderTimeoutMs of [0, -5, 2.5, "60s"]) {
        await writeFile(configPath, JSON.stringify({ office: { renderTimeoutMs } }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"office.renderTimeoutMs" must be a positive integer/);
      }
      // A deprecated key is checked under the name it was written with.
      await writeFile(configPath, JSON.stringify({ pptx: { renderer: "keynote" } }, null, 2));
      assert.throws(() => loadConfig(dir, { config: configPath }), /"pptx.renderer" must be one of/);
    });
  });

  test("PptxRendererKeysStillWork: the 0.29 pptx.* rendering keys are read, and named as deprecated", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ pptx: { renderer: "libreoffice", libreofficePath: "tools/soffice", renderTimeoutMs: 45_000 } }, null, 2));
      const lines: string[] = [];
      const original = console.log;
      console.log = (line: unknown) => void lines.push(String(line));
      let office;
      try {
        office = loadConfig(dir, { config: configPath }).office;
      } finally {
        console.log = original;
      }
      assert.equal(office.renderer, "libreoffice");
      assert.equal(office.libreofficePath, path.resolve(dir, "tools/soffice"));
      assert.equal(office.renderTimeoutMs, 45_000);
      assert.ok(lines.some((line) => /"pptx.renderer" is deprecated; rename it "office.renderer"/.test(line)), lines.join("\n"));
      assert.ok(lines.some((line) => /"pptx.libreofficePath" is deprecated/.test(line)));
    });
  });

  test("OfficeKeysWinOverTheirAliases: office.* wins, and the conflict is logged", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ office: { renderer: "onlyoffice" }, pptx: { renderer: "libreoffice" } }, null, 2));
      const lines: string[] = [];
      const original = console.log;
      console.log = (line: unknown) => void lines.push(String(line));
      let office;
      try {
        office = loadConfig(dir, { config: configPath }).office;
      } finally {
        console.log = original;
      }
      assert.equal(office.renderer, "onlyoffice");
      assert.ok(lines.some((line) => /"pptx.renderer" is ignored: "office.renderer" is set too/.test(line)), lines.join("\n"));
    });
  });

  test("docx.template is resolved against the configuration file, and refused when empty", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).docx.template, undefined);
      // A missing file is not an error at startup: the export that uses it reports it.
      await writeFile(configPath, JSON.stringify({ docx: { template: "templates/house.dotx" } }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).docx.template, path.resolve(dir, "templates/house.dotx"));
      await writeFile(configPath, JSON.stringify({ docx: { template: "" } }, null, 2));
      assert.throws(() => loadConfig(dir, { config: configPath }), /"docx.template" must be a non-empty path/);
    });
  });

  test("structuredExchange.maxBytes defaults to the contract's ceiling and can be tightened", async () => {
    // The default is not a guess about what people open, the way the document
    // ceilings above are: the contract bounds a conforming document, and accepting
    // more would promise something no schema does.
    //
    // It follows the widest supported version rather than the oldest. Capped at
    // version 1's four megabytes, the viewer would refuse an enriched document the
    // contract calls valid — and each version's own ceiling is applied after the
    // parse anyway, where the document has said which one it claims.
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      assert.equal(
        loadConfig(dir, { config: configPath }).structuredExchange.maxBytes,
        STRUCTURED_EXCHANGE_BYTES_CEILING_ANY,
      );

      await writeFile(configPath, JSON.stringify({ structuredExchange: { maxBytes: 500_000 } }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath }).structuredExchange.maxBytes, 500_000);
    });
  });

  test("structuredExchange.maxBytes cannot be raised past the contract ceiling", async () => {
    // Clamped, not refused: a deployment may only be more careful than the
    // published contract. Honouring a larger value would have the server serve a
    // document the browser's own bound then refuses, leaving the reader with raw
    // JSON and no explanation.
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ structuredExchange: { maxBytes: 26_214_400 } }, null, 2));
      assert.equal(
        loadConfig(dir, { config: configPath }).structuredExchange.maxBytes,
        STRUCTURED_EXCHANGE_BYTES_CEILING_ANY,
      );
    });
  });

  test("structuredExchange.maxBytes refuses a value that is not a positive integer", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      for (const maxBytes of ["4MB", 0, -1, 1.5]) {
        await writeFile(configPath, JSON.stringify({ structuredExchange: { maxBytes } }, null, 2));
        assert.throws(
          () => loadConfig(dir, { config: configPath }),
          /"structuredExchange.maxBytes" must be a positive integer/,
        );
      }
    });
  });

  test("pdf.maxBytes refuses a value that is not a positive integer", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      for (const maxBytes of ["25MB", 0, -1, 1.5]) {
        await writeFile(configPath, JSON.stringify({ pdf: { maxBytes } }, null, 2));
        assert.throws(() => loadConfig(dir, { config: configPath }), /"pdf.maxBytes" must be a positive integer/);
      }
    });
  });

  test("extensionPaths: relative paths resolve against config file dir", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await mkdir(path.join(dir, "ext"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({ extensionPaths: ["./ext/my-ext.ts"] }, null, 2),
      );
      const cfg = loadConfig(dir, { config: configPath });
      assert.equal(cfg.extensionPaths.length, 1);
      assert.equal(cfg.extensionPaths[0], path.resolve(dir, "ext", "my-ext.ts"));
    });
  });

  test("extensionPaths: absolute paths stay unchanged", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      const absPath = path.join(dir, "abs-ext.ts");
      await writeFile(absPath, "");
      await writeFile(configPath, JSON.stringify({ extensionPaths: [absPath] }, null, 2));
      const cfg = loadConfig(dir, { config: configPath });
      assert.equal(cfg.extensionPaths.length, 1);
      assert.equal(cfg.extensionPaths[0], absPath);
    });
  });

  test("extensionPaths: not set defaults to empty array", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      const cfg = loadConfig(dir, { config: configPath });
      assert.deepEqual(cfg.extensionPaths, []);
    });
  });

  test("skillPaths: relative paths resolve against config file dir", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await mkdir(path.join(dir, "skills"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({ skillPaths: ["./skills/my-skill"] }, null, 2),
      );
      const cfg = loadConfig(dir, { config: configPath });
      assert.equal(cfg.skillPaths.length, 1);
      assert.equal(cfg.skillPaths[0], path.resolve(dir, "skills", "my-skill"));
    });
  });

  test("skillPaths: not set defaults to empty array", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      const cfg = loadConfig(dir, { config: configPath });
      assert.deepEqual(cfg.skillPaths, []);
    });
  });

  test("promptPaths: relative paths resolve against config file dir", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await mkdir(path.join(dir, "prompts"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({ promptPaths: ["./prompts/my-prompt.md"] }, null, 2),
      );
      const cfg = loadConfig(dir, { config: configPath });
      assert.equal(cfg.promptPaths.length, 1);
      assert.equal(cfg.promptPaths[0], path.resolve(dir, "prompts", "my-prompt.md"));
    });
  });

  test("promptPaths: not set defaults to empty array", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      const cfg = loadConfig(dir, { config: configPath });
      assert.deepEqual(cfg.promptPaths, []);
    });
  });

  test("noExtensions defaults to false", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      const cfg = loadConfig(dir, { config: configPath });
      assert.equal(cfg.noExtensions, false);
    });
  });

  test("noSkills defaults to false", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      const cfg = loadConfig(dir, { config: configPath });
      assert.equal(cfg.noSkills, false);
    });
  });

  test("noPromptTemplates defaults to false", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({}, null, 2));
      const cfg = loadConfig(dir, { config: configPath });
      assert.equal(cfg.noPromptTemplates, false);
    });
  });

  test("multiple path arrays resolve correctly together", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await mkdir(path.join(dir, "ext"), { recursive: true });
      await mkdir(path.join(dir, "sk"), { recursive: true });
      await mkdir(path.join(dir, "pr"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            extensionPaths: ["./ext/a.ts", "./ext/b.ts"],
            skillPaths: ["./sk/x"],
            promptPaths: ["./pr/y.md"],
          },
          null,
          2,
        ),
      );
      const cfg = loadConfig(dir, { config: configPath });
      assert.deepEqual(cfg.extensionPaths, [
        path.resolve(dir, "ext", "a.ts"),
        path.resolve(dir, "ext", "b.ts"),
      ]);
      assert.deepEqual(cfg.skillPaths, [path.resolve(dir, "sk", "x")]);
      assert.deepEqual(cfg.promptPaths, [path.resolve(dir, "pr", "y.md")]);
    });
  });
});

// ---------------------------------------------------------------------------
// How the interface is presented once it opens.
// ---------------------------------------------------------------------------
describe("loadConfig — the shape the interface opens in", () => {
  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-outpost-openin-test-"));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function load(dir: string, raw: Record<string, unknown>) {
    const configPath = path.join(dir, "config.json");
    await writeFile(configPath, JSON.stringify(raw, null, 2));
    return loadConfig(dir, { config: configPath });
  }

  // openlore: scenario=ItOpensInAWindowOfItsOwn spec=cli
  test("a window of its own is what an unconfigured server opens", async () => {
    await withTempDir(async (dir) => {
      // The default is the whole point: the case that needs it most is a
      // double-clicked executable, where nobody is editing a configuration file.
      assert.equal((await load(dir, {})).openIn, "window");
    });
  });

  // openlore: scenario=TheOperatorCanAskForATab spec=cli
  test("every accepted shape is loaded as written", async () => {
    for (const shape of ["window", "browser"] as const) {
      await withTempDir(async (dir) => {
        assert.equal((await load(dir, { openIn: shape })).openIn, shape);
      });
    }
  });

  test("an unknown shape fails startup, naming the setting", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ openIn: "kiosk" }, null, 2));
      await assert.rejects(
        async () => loadConfig(dir, { config: configPath }),
        /openIn/,
        "a typo that silently fell back would leave an operator hunting a window that never appears",
      );
    });
  });

  test("the shape says nothing about whether anything opens", async () => {
    await withTempDir(async (dir) => {
      // Two settings, two questions. `openBrowser` still decides whether, and a
      // shape must never be read as a request to open.
      const config = await load(dir, { openBrowser: false, openIn: "window" });
      assert.equal(config.openBrowser, false);
      assert.equal(config.openIn, "window");
    });
  });

  test("the command line overrides the file", async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ openIn: "window" }, null, 2));
      assert.equal(loadConfig(dir, { config: configPath, openIn: "browser" }).openIn, "browser");
    });
  });

  // openlore: scenario=TheOperatorCanAskForATab spec=cli
  test("--open-in on the real command line reaches config, not just a hand-built flags object", async () => {
    // The seam the other tests skip: they pass `{ openIn }` straight to loadConfig,
    // so they pass even when parseCli drops the flag on the floor. Drive the actual
    // argv → parseCli → loadConfig path the server uses at startup.
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ openIn: "window" }, null, 2));
      const { flags } = parseCli(["--config", configPath, "--open-in", "browser"]);
      assert.equal(loadConfig(dir, flags).openIn, "browser");
    });
  });
});
