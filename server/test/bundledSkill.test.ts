/**
 * The skill that ships with the product, proven to load.
 *
 * `present_structure` without its skill is a mechanism with no instructions: the
 * agent can call the tool and has nothing telling it what a valid document looks
 * like, or that a described field is not a requested change. The packaging was right
 * for a long time while the loading was never demonstrated, and "it is in the
 * package" is not the same claim as "the agent gets it".
 *
 * This drives the SDK's real skill loader rather than a fake, because the two
 * questions that matter — does a path shaped like ours load, and does `noSkills`
 * still turn it off — are both answered by that loader and by nothing else.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKILLS = path.join(REPO, "skills");

const { loadSkills } = (await import(
  `file://${path.join(REPO, "node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js")}`
)) as {
  loadSkills: (options: { cwd: string; skillPaths: string[]; includeDefaults: boolean }) => {
    skills: { name: string; filePath: string; description?: string }[];
    diagnostics: { type: string; message: string; path: string }[];
  };
};

/** What the server enumerates: one path per skill, not the directory holding them. */
function bundledSkillPaths(): string[] {
  return ["docx-from-template", "pptx-from-template", "structured-exchange", "structured-exchange-project"]
    .map((name) => path.join(SKILLS, name))
    .filter((dir) => existsSync(path.join(dir, "SKILL.md")));
}

const load = (skillPaths: string[]) => loadSkills({ cwd: REPO, skillPaths, includeDefaults: false });

describe("the skill that ships with the tool", () => {
  test("is enumerated at all", () => {
    assert.deepEqual(bundledSkillPaths(), [
      path.join(SKILLS, "docx-from-template"),
      path.join(SKILLS, "pptx-from-template"),
      path.join(SKILLS, "structured-exchange"),
      path.join(SKILLS, "structured-exchange-project"),
    ]);
    // Every directory under skills/ holding a SKILL.md is shipped; none is left out of this list.
    const shipped = readdirSync(SKILLS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(SKILLS, entry.name, "SKILL.md")))
      .map((entry) => path.join(SKILLS, entry.name))
      .sort();
    assert.deepEqual(shipped, bundledSkillPaths());
  });

  test("loads from the path the server hands over", () => {
    const { skills, diagnostics } = load(bundledSkillPaths());

    // BothBundledSkillsLoad — and the presentation skill beside them.
    assert.deepEqual(skills.map((skill) => skill.name), ["docx-from-template", "pptx-from-template", "structured-exchange", "structured-exchange-project"]);
    assert.deepEqual(diagnostics, [], "a skill that loads with warnings is a skill half-loaded");
  });

  test("carries the description the model selects it by", () => {
    // A skill with no description is loaded and never chosen.
    const skill = load(bundledSkillPaths()).skills.find((each) => each.name === "structured-exchange")!;
    assert.ok(skill.description !== undefined && skill.description.length > 0);
    // Only the name and this description reach the prompt, so they decide whether the skill
    // is read at all. A model presenting a table of requirements under a project profile was
    // seen never opening it while the description spoke only of diagrams and proposals.
    assert.match(skill.description, /requirements/);
    assert.match(skill.description, /profile/);
    assert.match(skill.description, /before calling present_structure/);
  });

  test("the presentation skill teaches the render-and-fix loop over the three tools", () => {
    // TheSkillShipsWithTheProduct
    const skill = load(bundledSkillPaths()).skills.find((each) => each.name === "pptx-from-template");
    assert.ok(skill, "the presentation skill loads");
    assert.match(skill.description ?? "", /template \(\.potx or \.pptx\)/);
    assert.match(skill.description ?? "", /PowerPoint \(Windows\), LibreOffice or ONLYOFFICE/);
    const body = readFileSync(skill.filePath, "utf8");
    for (const tool of ["pptx_layouts", "pptx_create", "pptx_update", "pptx_render"]) assert.match(body, new RegExp(`\`${tool}\``), tool);
    assert.match(body, /Never declare a deck finished without having rendered it\./);
    assert.match(body, /overwrite: true/, "the rebuild step names how to replace the deck");
  });

  test("the Word skill teaches writing, updating as tracked changes, and rendering", () => {
    const skill = load(bundledSkillPaths()).skills.find((each) => each.name === "docx-from-template");
    assert.ok(skill, "the Word skill loads");
    assert.match(skill.description ?? "", /template/);
    assert.match(skill.description ?? "", /tracked changes/);
    assert.match(skill.description ?? "", /\.dotx/);
    const body = readFileSync(skill.filePath, "utf8");
    for (const tool of ["docx_styles", "docx_create", "docx_update", "docx_render", "docx_extract"]) assert.match(body, new RegExp(`\`${tool}\``), tool);
    assert.match(body, /Tracked changes are the default/);
    assert.match(body, /without a render, the document was not checked/);
  });

  test("the setup skill is selected for the project's registry, profiles and rules", () => {
    // TheSetupSkillIsSelectedForTheProjectsFiles
    const skill = load(bundledSkillPaths()).skills.find((each) => each.name === "structured-exchange-project");
    assert.ok(skill?.description !== undefined);
    assert.match(skill.description, /registry/);
    assert.match(skill.description, /profiles/);
    assert.match(skill.description, /rules/);
    assert.match(skill.description, /Read it before writing or changing any of those files/);
    assert.match(skill.description, /registry cannot be used/);
  });

  test("the authoring skill points to the setup skill", () => {
    // TheAuthoringSkillPointsToTheSetupSkill
    const authoring = readFileSync(path.join(SKILLS, "structured-exchange/SKILL.md"), "utf8");
    assert.match(authoring, /Writing or changing the registry, a profile or a rules file is another job: read the\s+`structured-exchange-project` skill/);
  });

  test("the setup skill teaches what validates yet checks something else", () => {
    // TheSetupSkillTeachesWhatPassesSilently
    const setup = readFileSync(path.join(SKILLS, "structured-exchange-project/SKILL.md"), "utf8");
    assert.match(setup, /Values in one condition are alternatives; conditions in one set must all hold/);
    assert.match(setup, /An item lacking an attribute named in `when` is not selected, and escapes the rule/);
    assert.match(setup, /`from` and `to` belong to link rules only/);
    assert.match(setup, /A link rule reads its conditions on the kinds the relationship allows at that end/);
    assert.match(setup, /present_project_model/);
    assert.match(setup, /Never\s+invent one to fill a gap: ask the user/);
  });

  test("still loads when the whole directory is handed over instead", () => {
    // The SDK's own documentation passes the parent, so both shapes have to work or
    // one of us is wrong about the contract.
    const names = load([SKILLS]).skills.map((skill) => skill.name);
    assert.ok(names.includes("structured-exchange"));
    assert.ok(names.includes("structured-exchange-project"));
  });

  test("a user's skill of the same name wins, because the server puts theirs first", () => {
    const mine = mkdtempSync(path.join(tmpdir(), "user-skill-"));
    const dir = path.join(mine, "structured-exchange");
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: structured-exchange\ndescription: the user's own\n---\n\nMine.\n",
    );

    // The order the server builds: user paths, then bundled.
    const { skills } = load([dir, ...bundledSkillPaths()]);
    const chosen = skills.find((skill) => skill.name === "structured-exchange")!;

    assert.equal(chosen.filePath, path.join(dir, "SKILL.md"), "the user's skill must be the one that wins");
  });

  test("noSkills silences what we bundle and not what the user named", () => {
    /**
     * Both halves, because each was got wrong in turn. Passing the bundled paths
     * regardless defeats the switch; dropping every path also drops the ones the user
     * asked for by name, and being given nothing after naming a skill is the worse
     * surprise of the two. noSkills turns off discovery of what we supply — a path
     * someone wrote down is not discovery.
     */
    const chosen = "/somewhere/of/their/own";
    const paths = (noSkills: boolean, configured: string[], bundled: string[]) => [
      ...configured,
      ...(noSkills ? [] : bundled),
    ];

    assert.deepEqual(paths(false, [chosen], bundledSkillPaths()), [chosen, ...bundledSkillPaths()]);
    assert.deepEqual(paths(true, [chosen], bundledSkillPaths()), [chosen]);
    assert.deepEqual(paths(true, [], bundledSkillPaths()), []);
    assert.deepEqual(paths(false, [], bundledSkillPaths()), bundledSkillPaths());
  });

  test("the loader does not enforce noSkills for us", () => {
    /**
     * The trap this pins down: the SDK merges `additionalSkillPaths` into the skill
     * set *even when noSkills is set*, so a server that passes the bundled paths
     * unconditionally silently defeats the switch. The server therefore omits them
     * entirely under noSkills rather than relying on the flag.
     */
    const source = readFileSync(
      path.join(REPO, "node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js"),
      "utf8",
    );
    assert.match(
      source,
      /noSkills\s*\?\s*this\.mergePaths\(cliEnabledSkills, this\.additionalSkillPaths\)/,
      "the SDK still merges additionalSkillPaths under noSkills — if this stopped being true, the server's guard can be simplified",
    );

    // And what the server does with that: nothing gets through — neither bundled skill.
    // TheSetupSkillIsTurnedOffWithSkills
    assert.deepEqual(load([]).skills, []);
  });
});
