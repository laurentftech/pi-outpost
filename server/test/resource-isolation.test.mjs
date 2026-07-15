/**
 * Test: noExtensions + extensionScripts + noSkills + skillPaths + noPromptTemplates + promptPaths
 * isolation.
 *
 * The harness pins agentDir to a throwaway directory so real ~/.pi/agent
 * is never touched in any test. This test verifies that when
 * noExtensions/noSkills/noPromptTemplates are active with explicit paths,
 * only those explicitly listed resources are loaded.
 */
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connect, startServer, makeWorkspace, freePort } from "./harness.mjs";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

describe("resource isolation", () => {
  test("extensionPaths loads the listed extension", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-ext-test-"));
    try {
      const server = await startServer(root, {
        noExtensions: true,
        extensionPaths: [path.join(FIXTURES, "test-extension.ts")],
        server: { port: freePort() },
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

  test("noSkills:true + skillPaths loads only the listed skill", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-skill-test-"));
    try {
      const server = await startServer(root, {
        noExtensions: true,
        noSkills: true,
        skillPaths: [path.join(FIXTURES, "test-skill")],
        noPromptTemplates: true,
        server: { port: freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      // Only our explicitly listed skill should be loaded
      const skills = hello.commands?.filter((c) => c.source === "skill") ?? [];
      assert.equal(
        skills.length,
        1,
        `exactly one skill should be loaded, got: ${JSON.stringify(skills)}`,
      );
      assert.equal(skills[0].name, "skill:test-skill");

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative extensionPaths resolves against config file dir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-rel-ext-"));
    try {
      // Copy fixture into root so relative path resolves to it
      await cp(
        path.join(FIXTURES, "test-extension.ts"),
        path.join(root, "test-extension.ts"),
      );

      const server = await startServer(root, {
        noExtensions: true,
        extensionPaths: ["./test-extension.ts"], // relative → resolved against root
        server: { port: freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      const extCmd = hello.commands?.find((c) => c.name === "test-ext");
      assert.ok(extCmd, "extension command 'test-ext' must be present with relative path");
      assert.equal(extCmd.source, "extension");

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative skillPaths resolves against config file dir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-rel-skill-"));
    try {
      // Copy fixture into root so relative path resolves to it
      await cp(
        path.join(FIXTURES, "test-skill"),
        path.join(root, "test-skill"),
        { recursive: true },
      );

      const server = await startServer(root, {
        noExtensions: true,
        noSkills: true,
        skillPaths: ["./test-skill"], // relative → resolved against root
        noPromptTemplates: true,
        server: { port: freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      const skills = hello.commands?.filter((c) => c.source === "skill") ?? [];
      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, "skill:test-skill");

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("noExtensions + extensionPaths + extensionScripts + noSkills + skillPaths + noPromptTemplates + promptPaths together", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-combo-"));
    try {
      // Copy all fixtures so relative paths work
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
        extensionScripts: ["./test-extension.ts"],
        noSkills: true,
        skillPaths: ["./test-skill"],
        noPromptTemplates: true,
        promptPaths: ["./test-prompt.md"],
        server: { port: freePort() },
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

  test("noPromptTemplates:true + promptPaths loads the listed prompt (absolute)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-prompt-abs-"));
    try {
      const server = await startServer(root, {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        promptPaths: [path.join(FIXTURES, "test-prompt.md")],
        server: { port: freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      const prompts = hello.commands?.filter((c) => c.source === "prompt") ?? [];
      assert.equal(
        prompts.length,
        1,
        `exactly one prompt expected with absolute path, got: ${JSON.stringify(prompts)}`,
      );
      assert.equal(prompts[0].name, "test-prompt");

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative promptPaths resolves against config file dir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-prompt-rel-"));
    try {
      await cp(
        path.join(FIXTURES, "test-prompt.md"),
        path.join(root, "test-prompt.md"),
      );

      const server = await startServer(root, {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        promptPaths: ["./test-prompt.md"],
        server: { port: freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      const prompts = hello.commands?.filter((c) => c.source === "prompt") ?? [];
      assert.equal(
        prompts.length,
        1,
        `exactly one prompt expected with relative path, got: ${JSON.stringify(prompts)}`,
      );
      assert.equal(prompts[0].name, "test-prompt");

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("noPromptTemplates:true blocks auto-discovered prompts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-block-prompt-"));
    try {
      // Create .pi/prompts/auto-prompt.md (would be auto-discovered)
      await mkdir(path.join(root, ".pi", "prompts"), { recursive: true });
      await writeFile(
        path.join(root, ".pi", "prompts", "auto-prompt.md"),
        "---\ndescription: auto-discovered\n---\nDo something",
      );

      const server = await startServer(root, {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        server: { port: freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

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

  test("noSkills:true blocks auto-discovered skills in .agents/skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-block-test-"));
    try {
      // Create .agents/skills/test-auto-skill/SKILL.md (would be auto-discovered)
      await mkdir(path.join(root, ".agents", "skills", "test-auto-skill"), {
        recursive: true,
      });
      await writeFile(
        path.join(root, ".agents", "skills", "test-auto-skill", "SKILL.md"),
        "# Auto-Discovered Skill\n## Steps\n1. x\n",
      );

      const server = await startServer(root, {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        server: { port: freePort() },
      });

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 15_000);

      const skills = hello.commands?.filter((c) => c.source === "skill") ?? [];
      assert.equal(
        skills.length,
        0,
        `no skills should be loaded with noSkills:true, got: ${JSON.stringify(skills)}`,
      );

      client.close();
      await server.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
