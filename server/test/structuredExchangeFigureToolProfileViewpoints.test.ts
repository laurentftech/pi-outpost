/**
 * `write_structure_figure` naming a viewpoint the project's profile declares.
 *
 * A domain reads its models by the same few concerns whatever the document, so those
 * readings belong in the profile rather than restated in every document. The agent
 * writing a report then asks for "verification" and gets it — and the tool has to be
 * as careful with a profile's viewpoint as with a document's: say where it came from,
 * refuse the ambiguous and the empty, and write nothing when it refuses.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { realResolve } from "../src/sandbox.ts";

type ToolResult = { content: { text: string }[]; isError?: boolean };

const profile = (viewpoints: unknown[]) => ({
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    { kind: "requirement", attributes: [{ name: "status", type: "enumeration", values: ["draft", "approved"], closed: true, required: true }] },
    { kind: "test" },
    { kind: "component" },
    { kind: "hazard" },
  ],
  relationshipKinds: [{ kind: "verifies" }, { kind: "allocates" }],
  viewpoints,
});

const verification = {
  id: "verification",
  label: "Verification",
  concern: "What verifies each requirement",
  elementKinds: ["requirement", "test"],
  relationshipKinds: ["verifies"],
};
const hazards = { id: "hazards", label: "Hazards", concern: "What can go wrong", elementKinds: ["hazard"] };

const document = (viewpoints?: unknown[]) => ({
  schema: "urn:structured-exchange:2",
  kind: "graph",
  profile: "acme/requirements",
  ...(viewpoints === undefined ? {} : { viewpoints }),
  data: {
    nodes: [
      { id: "r1", label: "Stop within 40 m", kind: "requirement", attributes: { status: "approved" } },
      { id: "t1", label: "Brake test", kind: "test" },
      { id: "c1", label: "Brake controller", kind: "component" },
    ],
    edges: [
      { from: "t1", to: "r1", kind: "verifies" },
      { from: "c1", to: "r1", kind: "allocates" },
    ],
  },
});

const structure = { id: "structure", label: "Structure", concern: "What implements what", elementKinds: ["component", "requirement"] };

describe("write_structure_figure with a profile's viewpoints", () => {
  let base: string;
  let counter = 0;

  function project(profileViewpoints: unknown[], files: Record<string, unknown>): string {
    const root = path.join(base, `project-${counter++}`);
    mkdirSync(path.join(root, "profiles"), { recursive: true });
    mkdirSync(path.join(root, ".pi-outpost"), { recursive: true });
    writeFileSync(
      path.join(root, ".pi-outpost/structured-exchange.json"),
      JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"] }),
    );
    writeFileSync(path.join(root, "profiles/requirements.json"), JSON.stringify(profile(profileViewpoints)));
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(root, name), JSON.stringify(content));
    return root;
  }

  const draw = (root: string, params: Record<string, unknown>) =>
    (
      createStructuredExchangeFigureToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 4_000_000, writableRoot: root, projectRoot: root })
        .execute as unknown as (id: string, params: unknown) => Promise<ToolResult>
    )("call-1", params);

  const drawnElements = (svg: string) => [...svg.matchAll(/data-element-id="([^"]+)"/g)].map((match) => match[1]).sort();

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-profile-viewpoints-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("writes a figure for a viewpoint only the profile declares, and says the profile declared it", async () => {
    // AFigureIsWrittenForAProfileViewpoint, TheResultNamesTheViewpoint
    const root = project([verification, hazards], { "model.json": document([structure]) });
    const result = await draw(root, { path: "model.json", output_path: "figures/verification.svg", viewpoint: "verification" });
    assert.notEqual(result.isError, true, result.content[0].text);
    const svg = readFileSync(path.join(root, "figures/verification.svg"), "utf8");
    assert.deepEqual(drawnElements(svg), ["r1", "t1"]);
    assert.match(svg, /Viewpoint: Verification/);
    assert.match(result.content[0].text, /Drawn for viewpoint `verification` \(Verification\), declared by this project's profile "acme\/requirements"/);
  });

  test("a viewpoint the document declares is still its own, and says so", async () => {
    // AFigureIsWrittenForADeclaredViewpoint
    const root = project([verification], { "model.json": document([structure]) });
    const result = await draw(root, { path: "model.json", output_path: "figures/structure.svg", viewpoint: "structure" });
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.deepEqual(drawnElements(readFileSync(path.join(root, "figures/structure.svg"), "utf8")), ["c1", "r1"]);
    assert.match(result.content[0].text, /declared by the document/);
  });

  test("a viewpoint both the document and its profile declare is refused naming both, and nothing is written", async () => {
    // AViewpointDeclaredByBothIsRefused
    const own = { ...verification, label: "My verification", concern: "Mine" };
    const root = project([verification], { "model.json": document([own]) });
    const result = await draw(root, { path: "model.json", output_path: "figures/both.svg", viewpoint: "verification" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /profile\/viewpoint-declared-twice at \/viewpoints\/0\/id/);
    assert.match(result.content[0].text, /profile "acme\/requirements" also declares a viewpoint "verification"/);
    assert.equal(existsSync(path.join(root, "figures/both.svg")), false);
  });

  test("a profile viewpoint retaining nothing of the document is refused, and nothing is written", async () => {
    // AProfileViewpointRetainingNothingOfTheDocumentIsRefused
    const root = project([verification, hazards], { "model.json": document() });
    const result = await draw(root, { path: "model.json", output_path: "figures/hazards.svg", viewpoint: "hazards" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /viewpoint "hazards" of profile "acme\/requirements" retains no kind that occurs in this document/);
    assert.equal(existsSync(path.join(root, "figures/hazards.svg")), false);
  });

  test("a viewpoint neither declares is refused, listing what each declares", async () => {
    // AnUndeclaredViewpointIsRefusedWithTheDeclaredOnes
    const root = project([verification, hazards], { "model.json": document([structure]) });
    const result = await draw(root, { path: "model.json", output_path: "figures/thermal.svg", viewpoint: "thermal" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /it declares "structure", and its profile "acme\/requirements" declares "verification", "hazards"/);
    assert.equal(existsSync(path.join(root, "figures/thermal.svg")), false);
  });

  test("a viewpoint named where neither declares any is refused saying so", async () => {
    // ADocumentWithoutViewpointsRefusesOne
    const root = project([], { "model.json": document() });
    const result = await draw(root, { path: "model.json", output_path: "figures/none.svg", viewpoint: "verification" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /declares no viewpoints, and neither does its profile "acme\/requirements"/);
    assert.equal(existsSync(path.join(root, "figures/none.svg")), false);
  });

  test("hidden kinds apply on top of a profile's viewpoint", async () => {
    // HiddenKindsApplyOnTopOfAViewpoint
    const root = project([verification], { "model.json": document() });
    const result = await draw(root, {
      path: "model.json",
      output_path: "figures/requirements-only.svg",
      viewpoint: "verification",
      hide_element_kinds: ["test"],
    });
    assert.notEqual(result.isError, true, result.content[0].text);
    const svg = readFileSync(path.join(root, "figures/requirements-only.svg"), "utf8");
    assert.deepEqual(drawnElements(svg), ["r1"]);
    assert.match(svg, /\(adjusted\)/);
  });

  test("without a registry, a profile named by the document supplies no viewpoints", async () => {
    const root = path.join(base, `bare-${counter++}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "model.json"), JSON.stringify(document()));
    const result = await draw(root, { path: "model.json", output_path: "figures/v.svg", viewpoint: "verification" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /declares no viewpoints, so it has no viewpoint "verification"/);
  });
});
