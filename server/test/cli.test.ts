import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const emptyFlags = () => ({
  config: undefined,
  profile: undefined,
  cwd: undefined,
  agentDir: undefined,
  port: undefined,
  host: undefined,
});
import { parseCli, runInit, CliError } from "../src/cli.ts";

// ---------------------------------------------------------------------------
// parseCli
// ---------------------------------------------------------------------------
describe("parseCli", () => {
  test("defaults to serve with no args", () => {
    const result = parseCli([]);
    assert.equal(result.command, "serve");
    assert.deepEqual(result.flags, emptyFlags());
  });

  test("--help returns help command", () => {
    const result = parseCli(["--help"]);
    assert.equal(result.command, "help");
  });

  test("-h returns help command", () => {
    const result = parseCli(["-h"]);
    assert.equal(result.command, "help");
  });

  test("--version returns version command", () => {
    const result = parseCli(["--version"]);
    assert.equal(result.command, "version");
  });

  test("-v returns version command", () => {
    const result = parseCli(["-v"]);
    assert.equal(result.command, "version");
  });

  test("init subcommand", () => {
    const result = parseCli(["init"]);
    assert.equal(result.command, "init");
    assert.equal(result.init.global, false);
    assert.equal(result.init.force, false);
  });

  test("init --global --force", () => {
    const result = parseCli(["init", "--global", "--force"]);
    assert.equal(result.command, "init");
    assert.equal(result.init.global, true);
    assert.equal(result.init.force, true);
  });

  test("config subcommand", () => {
    const result = parseCli(["config"]);
    assert.equal(result.command, "config");
  });

  test("login subcommand", () => {
    const result = parseCli(["login", "--provider", "anthropic"]);
    assert.equal(result.command, "login");
    assert.equal(result.login.provider, "anthropic");
  });

  test("login without --provider", () => {
    const result = parseCli(["login"]);
    assert.equal(result.command, "login");
    assert.equal(result.login.provider, undefined);
  });

  test("--config <path>", () => {
    const result = parseCli(["--config", "/tmp/my-config.json"]);
    assert.equal(result.flags.config, "/tmp/my-config.json");
  });

  test("--profile <name>", () => {
    const result = parseCli(["--profile", "work"]);
    assert.equal(result.flags.profile, "work");
  });

  test("--cwd <dir>", () => {
    const result = parseCli(["--cwd", "/home/project"]);
    assert.equal(result.flags.cwd, "/home/project");
  });

  test("--agent-dir <dir>", () => {
    const result = parseCli(["--agent-dir", "/custom/agent"]);
    assert.equal(result.flags.agentDir, "/custom/agent");
  });

  test("--agent-dir with windows-style path", () => {
    const result = parseCli(["--agent-dir", "D:\\pi-agent"]);
    assert.equal(result.flags.agentDir, "D:\\pi-agent");
  });

  test("--port <n>", () => {
    const result = parseCli(["--port", "8080"]);
    assert.equal(result.flags.port, 8080);
  });

  test("--host <addr>", () => {
    const result = parseCli(["--host", "0.0.0.0"]);
    assert.equal(result.flags.host, "0.0.0.0");
  });

  test("combines multiple flags with serve", () => {
    const result = parseCli([
      "--port", "9090",
      "--host", "0.0.0.0",
      "--cwd", "/workspace",
    ]);
    assert.equal(result.command, "serve");
    assert.equal(result.flags.port, 9090);
    assert.equal(result.flags.host, "0.0.0.0");
    assert.equal(result.flags.cwd, "/workspace");
  });

  test("throws CliError for invalid port (string)", () => {
    assert.throws(
      () => parseCli(["--port", "abc"]),
      CliError,
    );
  });

  test("throws CliError for out-of-range port (0)", () => {
    assert.throws(
      () => parseCli(["--port", "0"]),
      CliError,
    );
  });

  test("throws CliError for out-of-range port (70000)", () => {
    assert.throws(
      () => parseCli(["--port", "70000"]),
      CliError,
    );
  });

  test("throws CliError for an unknown command", () => {
    assert.throws(
      () => parseCli(["run"]),
      /unknown command/,
    );
  });

  test("throws CliError for an extra positional", () => {
    assert.throws(
      () => parseCli(["init", "extra"]),
      /unexpected argument/,
    );
  });

  test("throws CliError for an unknown flag", () => {
    assert.throws(
      () => parseCli(["--unknown"]),
      CliError,
    );
  });
});

// ---------------------------------------------------------------------------
// runInit
// ---------------------------------------------------------------------------
describe("runInit", () => {
  test("writes a starter config in the target directory", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "pi-cli-init-"));
    try {
      const written = runInit(tmpDir, { global: false, force: false });
      assert.ok(written.startsWith(tmpDir));
      assert.ok(written.endsWith("pi-outpost.config.json"));
      assert.ok(existsSync(written));

      const content = JSON.parse(readFileSync(written, "utf8"));
      assert.equal(content.cwd, ".");
      assert.equal(content.sandbox.allowWrite, false);
      assert.equal(content.sandbox.allowBash, false);
      assert.equal(content.server.port, 3141);
      assert.equal(content.server.host, "127.0.0.1");
      assert.equal(content.branding.title, "\u03c0");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("global init omits cwd and sandbox.root", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "pi-cli-global-"));
    const stubEnv = { XDG_CONFIG_HOME: tmpDir };
    try {
      const written = runInit(tmpDir, { global: true, force: false }, stubEnv);
      const content = JSON.parse(readFileSync(written, "utf8"));
      assert.equal(content.cwd, undefined);
      assert.equal(content.sandbox.root, undefined);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("throws when file exists without --force", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "pi-cli-exists-"));
    try {
      runInit(tmpDir, { global: false, force: false });
      assert.throws(
        () => runInit(tmpDir, { global: false, force: false }),
        /already exists/,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("--force overwrites an existing file", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "pi-cli-force-"));
    try {
      const first = runInit(tmpDir, { global: false, force: false });
      const second = runInit(tmpDir, { global: false, force: true });
      assert.equal(first, second);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
