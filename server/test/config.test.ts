import assert from "node:assert/strict";
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
} from "../src/config.ts";
import type { AppConfig, CliOptions } from "../src/config.ts";

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
      noSkills: false,
      skillPaths: [],
      noPromptTemplates: false,
      promptPaths: [],
      appendSystemPrompt: [],
      webContext: true,
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
      noSkills: false,
      skillPaths: [],
      noPromptTemplates: false,
      promptPaths: [],
      appendSystemPrompt: [],
      webContext: true,
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
      noSkills: false,
      skillPaths: [],
      noPromptTemplates: false,
      promptPaths: [],
      appendSystemPrompt: [],
      webContext: true,
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
