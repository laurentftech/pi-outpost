/**
 * The skill catalogue: what a repository carries, found by its own folder tree.
 *
 * The fixture is shaped like khalilbenaz/claude-skills-collection — category
 * folders, the same skills again as prefixed copies under `skills/`, and a
 * manifest whose categories do not match the folders.
 */
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { discoverSkillCatalogue } from "../src/resourceRepositories.ts";

const roots: string[] = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function temp(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "pi-skill-catalogue-")));
  roots.push(root);
  return root;
}

async function skill(root: string, relative: string, frontmatter = `name: ${path.basename(relative)}\ndescription: ${path.basename(relative)} skill`): Promise<string> {
  const dir = path.join(root, ...relative.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Body\n`);
  return dir;
}

async function collection(): Promise<string> {
  const root = await temp();
  await skill(root, "dev-skills/react-guide");
  await skill(root, "dev-skills/rust-guide");
  await skill(root, "agent-skills/a2a-protocol-guide");
  await skill(root, "skills/dev-react-guide");
  await skill(root, "skills/agent-a2a-protocol-guide");
  await writeFile(
    path.join(root, "skills.json"),
    JSON.stringify({ categories: [{ key: "everything", label: "All in one" }] }),
  );
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "README.md"), "# Not a skill\n");
  return root;
}

describe("skill catalogue", () => {
  // openlore: scenario=CategoryFoldersBecomeGroups spec=agent-resource-management
  test("category folders become groups", async () => {
    const root = await collection();
    const { skills, bound } = await discoverSkillCatalogue(root);
    assert.equal(bound, undefined);
    assert.deepEqual(
      skills.map((entry) => [entry.group, entry.relativePath, entry.name]),
      [
        ["agent-skills", "agent-skills/a2a-protocol-guide", "a2a-protocol-guide"],
        ["dev-skills", "dev-skills/react-guide", "react-guide"],
        ["dev-skills", "dev-skills/rust-guide", "rust-guide"],
        ["skills", "skills/agent-a2a-protocol-guide", "agent-a2a-protocol-guide"],
        ["skills", "skills/dev-react-guide", "dev-react-guide"],
      ],
    );
    assert.equal(skills[0].description, "a2a-protocol-guide skill");
  });

  // openlore: scenario=DuplicatesAreListedAsShipped spec=agent-resource-management
  test("duplicates are listed as shipped", async () => {
    const root = await temp();
    const body = "name: a2a\ndescription: Same skill twice";
    await skill(root, "agent-skills/a2a-protocol-guide", body);
    await skill(root, "skills/agent-a2a-protocol-guide", body);
    const { skills } = await discoverSkillCatalogue(root);
    assert.deepEqual(skills.map((entry) => entry.relativePath), ["agent-skills/a2a-protocol-guide", "skills/agent-a2a-protocol-guide"]);
    assert.deepEqual(skills.map((entry) => entry.name), ["a2a", "a2a"], "both kept, even under one name");
  });

  // openlore: scenario=NoManifestDecidesTheGrouping spec=agent-resource-management
  test("a manifest has no effect on the grouping", async () => {
    const root = await collection();
    const { skills } = await discoverSkillCatalogue(root);
    assert.deepEqual([...new Set(skills.map((entry) => entry.group))], ["agent-skills", "dev-skills", "skills"]);
    assert.ok(!skills.some((entry) => entry.group === "everything"));
  });

  test("a skill at the repository root is one skill, grouped under the root", async () => {
    const root = await temp();
    await skill(root, ".", "name: root-skill\ndescription: At the top");
    await skill(root, "nested/ignored");
    const { skills } = await discoverSkillCatalogue(root);
    assert.deepEqual(skills.map((entry) => [entry.group, entry.relativePath, entry.name]), [["", "", "root-skill"]]);
  });

  test("a directory holding SKILL.md is not descended into", async () => {
    const root = await temp();
    await skill(root, "outer");
    await skill(root, "outer/inner");
    const { skills } = await discoverSkillCatalogue(root);
    assert.deepEqual(skills.map((entry) => entry.relativePath), ["outer"]);
  });

  test("missing frontmatter names the skill by its folder", async () => {
    const root = await temp();
    const dir = path.join(root, "g", "plain");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), "# Plain skill without frontmatter\n");
    const { skills } = await discoverSkillCatalogue(root);
    assert.deepEqual(skills, [{ relativePath: "g/plain", name: "plain", group: "g" }]);
  });

  test("a large SKILL.md is read only up to the byte bound", async () => {
    const root = await temp();
    const dir = path.join(root, "g", "big");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), `---\nname: big\ndescription: Large body\n---\n${"x".repeat(2 * 1024 * 1024)}\n`);
    const { skills } = await discoverSkillCatalogue(root);
    assert.deepEqual(skills, [{ relativePath: "g/big", name: "big", description: "Large body", group: "g" }]);
  });

  // openlore: scenario=ASymlinkedSkillIsNotFollowed spec=agent-resource-management
  test("a symlinked skill contributes nothing, inside or outside the worktree", async () => {
    const root = await temp();
    const outside = await temp();
    const real = await skill(root, "real/one");
    await skill(outside, "secret");
    await mkdir(path.join(root, "links"), { recursive: true });
    await symlink(real, path.join(root, "links", "inside"), "dir");
    await symlink(path.join(outside, "secret"), path.join(root, "links", "outside"), "dir");
    const { skills } = await discoverSkillCatalogue(root);
    assert.deepEqual(skills.map((entry) => entry.relativePath), ["real/one"]);
  });

  test(".git and node_modules are skipped", async () => {
    const root = await temp();
    await skill(root, ".git/hooks-skill");
    await skill(root, "node_modules/pkg/skill");
    await skill(root, "kept/one");
    const { skills } = await discoverSkillCatalogue(root);
    assert.deepEqual(skills.map((entry) => entry.relativePath), ["kept/one"]);
  });

  // openlore: scenario=ACatalogueThatReachesItsBoundSaysSo spec=agent-resource-management
  test("a catalogue that reaches its count bound says so", async () => {
    const root = await collection();
    const { skills, bound } = await discoverSkillCatalogue(root, { maxSkills: 3 });
    assert.equal(skills.length, 3);
    assert.deepEqual(bound, { kind: "count", limit: 3 });
  });

  test("a catalogue that reaches its depth bound says so", async () => {
    const root = await temp();
    await skill(root, "a/shallow");
    await skill(root, "a/b/c/deep");
    const { skills, bound } = await discoverSkillCatalogue(root, { maxDepth: 2 });
    assert.deepEqual(skills.map((entry) => entry.relativePath), ["a/shallow"]);
    assert.deepEqual(bound, { kind: "depth", limit: 2 });
  });

  // openlore: scenario=CataloguingRunsNoRepositoryCode spec=agent-resource-management
  test("cataloguing runs no repository code", async () => {
    const root = await collection();
    const marker = path.join(root, "side-effect-ran");
    await mkdir(path.join(root, "extensions"), { recursive: true });
    await writeFile(
      path.join(root, "extensions", "loud.ts"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default () => {};\n`,
    );
    await writeFile(path.join(root, "dev-skills", "react-guide", "helper.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\n`);
    await discoverSkillCatalogue(root);
    await assert.rejects(access(marker), "no module from the repository was imported");
  });
});
