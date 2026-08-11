/**
 * Resource isolation E2E smoke tests: verify that the server's hello message
 * reflects resource-loading flags (noExtensions, extensionPaths, noSkills,
 * skillPaths, noPromptTemplates, promptPaths).
 *
 * Config-path resolution (relative vs absolute, defaults) is tested at the
 * unit level in config.test.ts — these integration tests boot a server only
 * to confirm the full pipeline (config → SDK → WebSocket hello) works.
 *
 * Each subtest boots one server. Keep the count low.
 */
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connect, startServer, freePort } from "./harness.mjs";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

describe("resource isolation", () => {
  test("extensionPaths + skillPaths + promptPaths load explicitly listed resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-res-"));
    try {
      // Copy fixtures so relative paths work
      await cp(
        path.join(FIXTURES, "test-extension.ts"),
        path.join(root, "test-extension.ts"),
      );
      await cp(
        path.join(FIXTURES, "test-skill"),
        path.join(root, "test-skill"),
        { recursive: true },
      );
      await cp(
        path.join(FIXTURES, "test-prompt.md"),
        path.join(root, "test-prompt.md"),
      );

      const server = await startServer(root, {
        noExtensions: true,
        extensionPaths: ["./test-extension.ts"],
        noSkills: true,
        skillPaths: ["./test-skill"],
        noPromptTemplates: true,
        promptPaths: ["./test-prompt.md"],
        server: { port: await freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      // Extension loaded
      const extCmd = hello.commands?.find((c) => c.name === "test-ext");
      assert.ok(extCmd, "extension 'test-ext' must be present");
      assert.equal(extCmd.source, "extension");

      // Skill loaded (only one)
      const skills = hello.commands?.filter((c) => c.source === "skill") ?? [];
      assert.equal(
        skills.length,
        1,
        `exactly one skill expected, got: ${JSON.stringify(skills)}`,
      );
      assert.equal(skills[0].name, "skill:test-skill");

      // Prompt loaded (only one)
      const prompts = hello.commands?.filter((c) => c.source === "prompt") ?? [];
      assert.equal(
        prompts.length,
        1,
        `exactly one prompt expected, got: ${JSON.stringify(prompts)}`,
      );
      assert.equal(prompts[0].name, "test-prompt");

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("noSkills + noPromptTemplates blocks auto-discovered resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-block-"));
    try {
      // Create auto-discoverable resources
      await mkdir(path.join(root, ".agents", "skills", "test-auto-skill"), {
        recursive: true,
      });
      await writeFile(
        path.join(root, ".agents", "skills", "test-auto-skill", "SKILL.md"),
        "# Auto-Discovered Skill\n## Steps\n1. x\n",
      );
      await mkdir(path.join(root, ".pi", "prompts"), { recursive: true });
      await writeFile(
        path.join(root, ".pi", "prompts", "auto-prompt.md"),
        "---\ndescription: auto-discovered\n---\nDo something",
      );

      const server = await startServer(root, {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        server: { port: await freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      const skills = hello.commands?.filter((c) => c.source === "skill") ?? [];
      assert.equal(
        skills.length,
        0,
        `no skills expected with noSkills:true, got: ${JSON.stringify(skills)}`,
      );

      const prompts = hello.commands?.filter((c) => c.source === "prompt") ?? [];
      assert.equal(
        prompts.length,
        0,
        `no prompts expected with noPromptTemplates:true, got: ${JSON.stringify(prompts)}`,
      );

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("absolute extensionPaths loads the listed extension", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-abs-ext-"));
    try {
      const server = await startServer(root, {
        noExtensions: true,
        extensionPaths: [path.join(FIXTURES, "test-extension.ts")],
        server: { port: await freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      const extCmd = hello.commands?.find((c) => c.name === "test-ext");
      assert.ok(extCmd, "extension command 'test-ext' must be present");
      assert.equal(extCmd.source, "extension");

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
