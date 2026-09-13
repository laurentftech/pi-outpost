/**
 * Reading a project's profiles from its own directory.
 *
 * Real files in a real temporary project, because every guarantee here is about the
 * filesystem: what is outside the project, what a link resolves to, what is missing,
 * and what an edit changes on the very next read.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { holdToProfile } from "@pi-outpost/shared/structured-exchange/profile-check";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { readProjectProfiles, type ProjectProfiles } from "../src/structuredExchangeProfiles.ts";
import { realResolve } from "../src/sandbox.ts";

const profile = (id: string, statuses: string[] = ["draft", "approved"]) => ({
  schema: "urn:structured-exchange-profile:1",
  id,
  label: id,
  elementKinds: [{ kind: "requirement", attributes: [{ name: "status", type: "enumeration", values: statuses, closed: true }] }],
});

const registry = (profiles: string[], extra: Record<string, unknown> = {}) => ({
  schema: "urn:structured-exchange-profile-registry:1",
  profiles,
  ...extra,
});

describe("a project's profiles", () => {
  let base: string;
  let counter = 0;

  /** A fresh project with the given files, relative paths to JSON values or raw text. */
  function project(files: Record<string, unknown>): string {
    const root = path.join(base, `project-${counter++}`);
    mkdirSync(root, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    }
    return root;
  }

  const unusable = (outcome: ProjectProfiles) => {
    assert.equal(outcome.state, "unusable", `expected an unusable registry, got ${outcome.state}`);
    return (outcome as Extract<ProjectProfiles, { state: "unusable" }>).issues;
  };

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-profiles-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("a project without a registry is unconstrained", async () => {
    // AProjectWithoutARegistryIsUnconstrained
    assert.deepEqual(await readProjectProfiles(project({ "README.md": "# nothing here" })), { state: "none" });
  });

  test("a registered profile is found by its identifier, with the default", async () => {
    // ARegisteredProfileIsFoundByItsIdentifier
    // Paths are relative to the project, not to the registry's own directory.
    const root = project({
      ".pi-outpost/structured-exchange.json": registry([".pi-outpost/profiles/requirements.json"], { default: "acme/requirements" }),
      ".pi-outpost/profiles/requirements.json": profile("acme/requirements"),
    });
    const outcome = await readProjectProfiles(root);
    assert.equal(outcome.state, "usable");
    assert.ok(outcome.state === "usable");
    assert.equal(outcome.context.profiles.get("acme/requirements")?.label, "acme/requirements");
    assert.equal(outcome.context.default, "acme/requirements");
  });

  test("a profile path climbing out of the project is refused, naming the entry", async () => {
    // ARegistryPathLeavingTheProjectIsRefused
    const root = project({ ".pi-outpost/structured-exchange.json": registry(["../elsewhere.json"]) });
    writeFileSync(path.join(base, "elsewhere.json"), JSON.stringify(profile("acme/stolen")));
    const issues = unusable(await readProjectProfiles(root));
    assert.deepEqual(
      issues.map((issue) => `${issue.rule} in ${issue.file} at ${issue.path}`),
      ["registry/profile-outside-project in .pi-outpost/structured-exchange.json at /profiles/0"],
    );
  });

  test("an absolute profile path is refused even when it points inside the project", async () => {
    const root = project({ "profiles/p.json": profile("acme/p") });
    mkdirSync(path.join(root, ".pi-outpost"), { recursive: true });
    writeFileSync(path.join(root, ".pi-outpost/structured-exchange.json"), JSON.stringify(registry([path.join(root, "profiles/p.json")])));
    const issues = unusable(await readProjectProfiles(root));
    assert.equal(issues[0].rule, "registry/profile-outside-project");
  });

  test("a profile reached through a link that leaves the project is refused", async (t) => {
    const root = project({ ".pi-outpost/structured-exchange.json": registry(["profiles/linked.json"]) });
    writeFileSync(path.join(base, `outside-${counter}.json`), JSON.stringify(profile("acme/outside")));
    mkdirSync(path.join(root, "profiles"), { recursive: true });
    try {
      symlinkSync(path.join(base, `outside-${counter}.json`), path.join(root, "profiles/linked.json"));
    } catch {
      return t.skip("symlinks unavailable on this platform");
    }
    const issues = unusable(await readProjectProfiles(root));
    assert.equal(`${issues[0].rule} at ${issues[0].path}`, "registry/profile-outside-project at /profiles/0");
  });

  test("a missing profile file makes the registry unusable, naming the file", async () => {
    // AMissingProfileFileRefusesEveryDocument, at the reading level
    const root = project({ ".pi-outpost/structured-exchange.json": registry(["profiles/gone.json"]) });
    const issues = unusable(await readProjectProfiles(root));
    assert.equal(`${issues[0].rule} at ${issues[0].path}`, "registry/missing-profile at /profiles/0");
    assert.match(issues[0].message, /profiles\/gone\.json/);
  });

  test("a malformed profile makes the registry unusable, naming the profile file, rule and pointer", async () => {
    // AMalformedProfileRefusesEveryDocument, at the reading level
    const broken = profile("acme/requirements");
    (broken.elementKinds[0].attributes[0] as Record<string, unknown>).values = [];
    const root = project({
      ".pi-outpost/structured-exchange.json": registry(["profiles/requirements.json"]),
      "profiles/requirements.json": broken,
    });
    const issues = unusable(await readProjectProfiles(root));
    assert.deepEqual(
      issues.map((issue) => `${issue.rule} in ${issue.file} at ${issue.path}`),
      ["profile-format/schema/minItems in profiles/requirements.json at /elementKinds/0/attributes/0/values"],
    );
  });

  test("every broken file is reported, not only the first", async () => {
    const root = project({
      ".pi-outpost/structured-exchange.json": registry(["profiles/a.json", "profiles/b.json", "profiles/c.json"]),
      "profiles/a.json": "{ not json",
      "profiles/c.json": { ...profile("acme/c"), extends: "x" },
    });
    const issues = unusable(await readProjectProfiles(root));
    assert.deepEqual(
      issues.map((issue) => `${issue.rule} in ${issue.file}`),
      [
        "profile-format/not-json in profiles/a.json",
        "registry/missing-profile in .pi-outpost/structured-exchange.json",
        "profile-format/schema/additionalProperties in profiles/c.json",
      ],
    );
  });

  test("a registry that is not JSON, or not a registry, is unusable", async () => {
    const notJson = unusable(await readProjectProfiles(project({ ".pi-outpost/structured-exchange.json": "profiles: [a.json]" })));
    assert.equal(`${notJson[0].rule} in ${notJson[0].file}`, "registry/not-json in .pi-outpost/structured-exchange.json");
    const notRegistry = unusable(await readProjectProfiles(project({ ".pi-outpost/structured-exchange.json": { profiles: ["a.json"] } })));
    assert.equal(notRegistry[0].rule, "registry/schema/required");
  });

  test("two files declaring one identifier, and an unregistered default, are reported against the registry", async () => {
    const root = project({
      ".pi-outpost/structured-exchange.json": registry(["profiles/a.json", "profiles/b.json"]),
      "profiles/a.json": profile("acme/requirements"),
      "profiles/b.json": profile("acme/requirements"),
    });
    const duplicate = unusable(await readProjectProfiles(root));
    assert.equal(`${duplicate[0].rule} at ${duplicate[0].path}`, "registry/duplicate-profile-identifier at /profiles/1");

    const defaulted = project({
      ".pi-outpost/structured-exchange.json": registry(["profiles/a.json"], { default: "acme/other" }),
      "profiles/a.json": profile("acme/requirements"),
    });
    const unregistered = unusable(await readProjectProfiles(defaulted));
    assert.equal(`${unregistered[0].rule} in ${unregistered[0].file}`, "registry/unregistered-default in .pi-outpost/structured-exchange.json");
  });

  test("an edited profile applies to the next check, with nothing restarted", async () => {
    // AnEditedProfileAppliesToTheNextCheck
    const root = project({
      ".pi-outpost/structured-exchange.json": registry(["profiles/requirements.json"]),
      "profiles/requirements.json": profile("acme/requirements", ["draft", "approved"]),
    });
    const parsed = parseStructuredExchange(
      {
        schema: "urn:structured-exchange:2",
        kind: "table",
        profile: "acme/requirements",
        data: { columns: ["id"], rows: [{ id: "r1", kind: "requirement", cells: ["R1"], attributes: { status: "in review" } }] },
      },
      checkStructuredExchangeSchema,
    );
    assert.ok(parsed.valid);
    const verdictUnder = async () => {
      const outcome = await readProjectProfiles(root);
      assert.ok(outcome.state === "usable");
      return holdToProfile(parsed.envelope, outcome.context).outcome;
    };
    assert.equal(await verdictUnder(), "refused");
    writeFileSync(path.join(root, "profiles/requirements.json"), JSON.stringify(profile("acme/requirements", ["draft", "approved", "in review"])));
    assert.equal(await verdictUnder(), "conforms");
  });

  test("a registry past its size ceiling is refused before it is parsed", async () => {
    const root = project({ ".pi-outpost/structured-exchange.json": `{"schema":"x","padding":"${"x".repeat(70_000)}"}` });
    const issues = unusable(await readProjectProfiles(root));
    assert.equal(issues[0].rule, "registry/too-large");
    assert.equal(issues[0].limit, 65_536);
  });
});
