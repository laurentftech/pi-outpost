/**
 * When `present_project_model` is published: the reading of "the conversation touched the
 * project's model", on the texts, calls and results an agent actually produces.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  projectModelFiles,
  promptNamesProjectModel,
  resultReportsUnusableRegistry,
  toolCallTouchesProjectModel,
} from "../src/projectModelTool.ts";

const project = (registry?: string) => {
  const root = mkdtempSync(path.join(tmpdir(), "project-model-triggers-"));
  if (registry !== undefined) {
    mkdirSync(path.join(root, ".pi-outpost"));
    writeFileSync(path.join(root, ".pi-outpost/structured-exchange.json"), registry);
  }
  return root;
};

describe("the files of a project's model", () => {
  test("are the registry and every path it lists", async () => {
    const root = project(JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"], rules: ["./rules/review.json"] }));
    assert.deepEqual(await projectModelFiles(root), [".pi-outpost/structured-exchange.json", "profiles/requirements.json", "rules/review.json"]);
  });

  test("still name the registry when it is missing or broken", async () => {
    assert.deepEqual(await projectModelFiles(project()), [".pi-outpost/structured-exchange.json"]);
    assert.deepEqual(await projectModelFiles(project("{ not json")), [".pi-outpost/structured-exchange.json"]);
  });
});

describe("a prompt", () => {
  const files = [".pi-outpost/structured-exchange.json", "profiles/requirements.json"];

  test("naming a listed file or the registry calls for the tool", () => {
    // NamingAModelFilePublishesTheTool, at the reading level
    assert.equal(promptNamesProjectModel("Add a status value to profiles/requirements.json.", files), true);
    assert.equal(promptNamesProjectModel("Check @.pi-outpost/structured-exchange.json", files), true);
    assert.equal(promptNamesProjectModel("look at `profiles/requirements.json`", files), true);
  });

  test("opening the setup skill calls for the tool", () => {
    // UserOpeningTheSetupSkillPublishesTheTool, at the reading level
    assert.equal(promptNamesProjectModel("/skill:structured-exchange-project add the ARP4754A rule", files), true);
    assert.equal(promptNamesProjectModel("/skill:structured-exchange-project", files), true);
    assert.equal(promptNamesProjectModel("/skill:structured-exchange present the table", files), false);
  });

  test("about rules or profiles in words does not", () => {
    // TheToolIsWithheldUntilTheModelIsTouched, at the reading level
    assert.equal(promptNamesProjectModel("Write a rule: a derived requirement does not satisfy an upstream one.", files), false);
    assert.equal(promptNamesProjectModel("Which profile does this project use?", files), false);
    assert.equal(promptNamesProjectModel("see old-profiles/requirements.json.bak", files), false);
  });
});

describe("a tool call", () => {
  const root = "/work/project";
  const files = [".pi-outpost/structured-exchange.json", "rules/review.json"];

  test("reading or writing the registry or a listed file touches the model, by relative or absolute path", () => {
    // WritingAModelFilePublishesTheToolWithinTheTurn, at the reading level
    assert.equal(toolCallTouchesProjectModel({ path: ".pi-outpost/structured-exchange.json", content: "{}" }, [root], files), true);
    assert.equal(toolCallTouchesProjectModel({ path: "/work/project/rules/review.json" }, [root], files), true);
    assert.equal(toolCallTouchesProjectModel({ path: "./rules/../rules/review.json", edits: [] }, [root], files), true);
  });

  test("writing a file that declares the profile or rules format touches the model wherever it is", () => {
    const content = JSON.stringify({ schema: "urn:structured-exchange-rules:1", profile: "acme/requirements", rules: [] }, null, 2);
    assert.equal(toolCallTouchesProjectModel({ path: "drafts/new-rules.json", content }, [root], files), true);
    const profile = JSON.stringify({ schema: "urn:structured-exchange-profile:1", id: "x", label: "x" });
    assert.equal(toolCallTouchesProjectModel({ path: "drafts/profile.json", content: profile }, [root], files), true);
  });

  test("reading the setup skill touches the model", () => {
    // ReadingTheSetupSkillPublishesTheTool, at the reading level
    assert.equal(toolCallTouchesProjectModel({ path: "/opt/pi-outpost/skills/structured-exchange-project/SKILL.md" }, [root], files), true);
    assert.equal(toolCallTouchesProjectModel({ path: "/opt/pi-outpost/skills/structured-exchange/SKILL.md" }, [root], files), false);
  });

  test("anything else does not — including a structured-exchange document that is not the model", () => {
    assert.equal(toolCallTouchesProjectModel({ path: "src/index.ts" }, [root], files), false);
    assert.equal(toolCallTouchesProjectModel({ command: "cat rules/review.json" }, [root], files), false);
    const document = JSON.stringify({ schema: "urn:structured-exchange:2", kind: "table", data: { columns: ["id"], rows: [] } });
    assert.equal(toolCallTouchesProjectModel({ path: "reports/table.json", content: document }, [root], files), false);
    assert.equal(toolCallTouchesProjectModel(undefined, [root], files), false);
  });
});

describe("a tool result", () => {
  test("refusing because the registry cannot be used calls for the tool", () => {
    // AnUnusableRegistryRefusalPublishesTheTool, at the reading level
    assert.equal(
      resultReportsUnusableRegistry("present_structure", "The document was not presented: this project's structured-exchange profile registry cannot be used, so no document can be checked against it."),
      true,
    );
    assert.equal(resultReportsUnusableRegistry("write_structure_table", "No table was written. This project's structured-exchange profile registry cannot be used, so …"), true);
    assert.equal(resultReportsUnusableRegistry("write_structure_figure", "No figure was written. This project's structured-exchange profile registry cannot be used, so …"), true);
  });

  test("any other refusal, or another tool quoting the words, does not", () => {
    assert.equal(resultReportsUnusableRegistry("present_structure", "The document was refused by this project's profile \"acme/requirements\"."), false);
    assert.equal(resultReportsUnusableRegistry("bash", "grep: structured-exchange profile registry cannot be used"), false);
  });
});
