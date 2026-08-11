/**
 * Unit + integration tests for the file sandbox and its readException mechanism.
 *
 * Unit tests cover the pure path-checking functions (isWithin, isWithinAny).
 * Integration tests verify that a server with sandbox.readExceptions pointing
 * outside the sandbox root starts and serves correctly.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { isWithin, isWithinAny } from "../src/sandbox.ts";
import { connect, startServer, makeWorkspace, freePort } from "./harness.mjs";

describe("sandbox path checking", () => {
  const SEP = path.sep;

  test("isWithin — exact root matches", () => {
    assert.ok(isWithin("/sandbox", "/sandbox"));
  });

  test("isWithin — path inside root", () => {
    assert.ok(isWithin("/sandbox", `/sandbox${SEP}dir${SEP}file.ts`));
  });

  test("isWithin — path outside root (sibling)", () => {
    assert.ok(!isWithin("/sandbox", `/other${SEP}file.ts`));
  });

  test("isWithin — path outside root (parent)", () => {
    assert.ok(!isWithin("/sandbox/child", `/sandbox${SEP}file.ts`));
  });

  test("isWithin — path outside root (unrelated)", () => {
    assert.ok(!isWithin("/sandbox", `/sandbox_evil${SEP}file.ts`));
  });

  test("isWithinAny — empty list denies everything", () => {
    assert.ok(!isWithinAny([], `/sandbox${SEP}file.ts`));
  });

  test("isWithinAny — matches against any root", () => {
    assert.ok(
      isWithinAny(
        ["/skills", "/prompts"],
        `/skills${SEP}my-skill${SEP}SKILL.md`,
      ),
    );
  });

  test("isWithinAny — matches second root", () => {
    assert.ok(
      isWithinAny(
        ["/skills", "/prompts"],
        `/prompts${SEP}review.md`,
      ),
    );
  });

  test("isWithinAny — denies path outside all roots", () => {
    assert.ok(
      !isWithinAny(
        ["/skills", "/prompts"],
        `/other${SEP}secret.txt`,
      ),
    );
  });

  test("isWithinAny — path matching root prefix but not contained", () => {
    assert.ok(
      !isWithinAny(
        ["/skills"],
        `/skills_extra${SEP}file.md`,
      ),
    );
  });
});

describe("sandbox readExceptions integration", () => {
  let server;
  const SEP = path.sep;

  before(async () => {
    // Create workspace: sandbox root is a subdirectory.
    // Skills live OUTSIDE the sandbox root, only accessible via readExceptions.
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-sbox-"));
    const sandboxRoot = path.join(root, "workspace");
    const skillDir = path.join(root, "skills", "my-skill");
    await mkdir(sandboxRoot, { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(sandboxRoot, "readme.md"), "# Workspace");
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: A skill for testing sandbox read exceptions\n---\n\n# My Skill\n\n## Steps\n1. Read\n",
    );

    server = await startServer(sandboxRoot, {
      sandbox: {
        root: sandboxRoot,
        allowWrite: false,
        allowBash: false,
      },
      noExtensions: true,
      noSkills: true,
      skillPaths: [skillDir],
      noPromptTemplates: true,
      server: { port: await freePort() },
    });
  });

  after(async () => {
    await server?.stop();
  });

  test("server starts with readExceptions pointing outside sandbox root", async () => {
    // Smoke test: if the server is running, the config was accepted
    const res = await fetch(`${server.base}/health`);
    assert.ok(res.ok);
  });

  test("skills from outside the sandbox root are registered as commands", async () => {
    const client = connect(server.wsUrl());
    await client.open();
    const hello = await client.waitFor("hello", 15_000);

    const skills = hello.commands?.filter((c) => c.source === "skill") ?? [];
    assert.ok(
      skills.some((s) => s.name === "skill:my-skill"),
      `"skill:my-skill" should be registered among commands: ${JSON.stringify(skills.map((s) => s.name))}`,
    );

    client.close();
  });
});
