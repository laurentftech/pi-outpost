/**
 * The agent's two structured-exchange tools, in a project that registers profiles.
 *
 * Driven through the tools exactly as the agent calls them, against real projects on
 * disk: what the agent reads back is the whole interface here, so assertions are on
 * the text it receives, on what reaches the interface's channel, and — for the figure
 * tool — on whether a file exists afterwards.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { createStructuredExchangeToolDefinition } from "../src/structuredExchangeTool.ts";
import { realResolve } from "../src/sandbox.ts";

type ToolResult = { content: { text: string }[]; details?: unknown; isError?: boolean };

const requirementsProfile = (statuses = ["draft", "approved", "withdrawn"]) => ({
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "status", type: "enumeration", values: statuses, closed: true, required: true },
        { name: "priority", type: "enumeration", values: ["must", "should", "could"], closed: false },
      ],
    },
    { kind: "test" },
  ],
  relationshipKinds: [{ kind: "verifies" }],
});

const registry = (extra: Record<string, unknown> = {}) => ({
  schema: "urn:structured-exchange-profile-registry:1",
  profiles: ["profiles/requirements.json"],
  ...extra,
});

const requirementsGraph = (status: unknown = "approved", extra: Record<string, unknown> = {}) => ({
  schema: "urn:structured-exchange:2",
  kind: "graph",
  profile: "acme/requirements",
  data: {
    nodes: [
      { id: "r1", label: "Stop within 40 m", kind: "requirement", attributes: { status, ...extra } },
      { id: "t1", label: "Brake test", kind: "test" },
    ],
    edges: [{ from: "t1", to: "r1", kind: "verifies" }],
  },
});

describe("the agent's tools in a project with profiles", () => {
  let base: string;
  let counter = 0;

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

  const withProfile = (extra: Record<string, unknown> = {}, profile: unknown = requirementsProfile()) =>
    project({ ".pi-outpost/structured-exchange.json": registry(extra), "profiles/requirements.json": profile });

  const present = (projectRoot: string, document: unknown) =>
    (createStructuredExchangeToolDefinition({ projectRoot }).execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)(
      "call-1",
      { document: JSON.stringify(document), summary: "Requirements and their tests." },
    );

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-tool-profiles-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  describe("present_structure", () => {
    test("presents a conforming document and says which profile it conforms to", async () => {
      // AConformingDocumentIsPresented
      const result = await present(withProfile(), requirementsGraph());
      assert.notEqual(result.isError, true, result.content[0].text);
      assert.equal((result.details as { profile?: string }).profile, "acme/requirements");
      assert.match(result.content[0].text, /conforms to this project's profile "acme\/requirements"\)/);
    });

    test("refuses a stray document with the profile's rule, pointer and allowed values, presenting nothing", async () => {
      const result = await present(withProfile(), requirementsGraph("in review"));
      assert.equal(result.isError, true);
      assert.equal(result.details, undefined, "a refused document reached the interface");
      assert.match(result.content[0].text, /refused by this project's profile "acme\/requirements"/);
      assert.match(result.content[0].text, /profile\/closed-enumeration at \/data\/nodes\/0\/attributes\/status/);
      assert.match(result.content[0].text, /"draft", "approved", "withdrawn"/);
    });

    test("reports values outside open enumerations, and still presents", async () => {
      // AValueOutsideAnOpenEnumerationIsAcceptedAndReported, as the agent reads it
      const result = await present(withProfile(), requirementsGraph("approved", { priority: "urgnet" }));
      assert.notEqual(result.isError, true, result.content[0].text);
      assert.ok(result.details);
      assert.match(result.content[0].text, /with 1 value outside open enumerations/);
      assert.match(result.content[0].text, /\/data\/nodes\/0\/attributes\/priority: "urgnet"/);
      assert.match(result.content[0].text, /"must", "should", "could"/);
    });

    test("reports core violations first, and applies the profile once they are fixed", async () => {
      // CoreViolationsAreReportedFirst
      const root = withProfile();
      const broken = requirementsGraph("in review");
      broken.data.edges = [{ from: "t1", to: "nowhere", kind: "verifies" }];
      const first = await present(root, broken);
      assert.equal(first.isError, true);
      assert.doesNotMatch(first.content[0].text, /profile\//, "profile rules were applied to a document the core contract refused");
      assert.match(first.content[0].text, /nowhere/);
      // ACoreRefusalSaysItIsNotTheProfile: the agent is told where the cause is not.
      assert.match(first.content[0].text, /refused by the structured-exchange contract itself — not by this project's profile/);

      broken.data.edges = [{ from: "t1", to: "r1", kind: "verifies" }];
      const second = await present(root, broken);
      assert.equal(second.isError, true);
      assert.match(second.content[0].text, /profile\/closed-enumeration/);
    });

    test("under a default, refuses a document naming no profile that strays from the default", async () => {
      const unnamed = requirementsGraph("in review") as Record<string, unknown>;
      delete unnamed.profile;
      const result = await present(withProfile({ default: "acme/requirements" }), unnamed);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /profile\/closed-enumeration/);
    });

    test("an unusable registry refuses a document the core contract accepts, naming the file", async () => {
      // AnUnusableRegistryNeverDegradesToTheCoreContract, AMalformedProfileRefusesEveryDocument
      const broken = requirementsProfile();
      (broken.elementKinds[0].attributes![0] as Record<string, unknown>).values = [];
      const result = await present(withProfile({}, broken), requirementsGraph());
      assert.equal(result.isError, true);
      assert.equal(result.details, undefined);
      assert.match(result.content[0].text, /registry cannot be used/);
      assert.match(result.content[0].text, /profile-format\/schema\/minItems in profiles\/requirements\.json at \/elementKinds\/0\/attributes\/0\/values/);
    });

    test("an unusable registry refuses even a document that names no profile", async () => {
      // AMissingProfileFileRefusesEveryDocument
      const root = project({ ".pi-outpost/structured-exchange.json": registry() });
      const plain = { schema: "urn:structured-exchange:1", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } };
      const result = await present(root, plain);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /registry\/missing-profile in \.pi-outpost\/structured-exchange\.json at \/profiles\/0/);
    });

    test("a default nothing registers, and two files claiming one identifier, refuse every document", async () => {
      // AnUnregisteredDefaultRefusesEveryDocument, TwoProfilesSharingAnIdentifierRefuseEveryDocument
      const plain = { schema: "urn:structured-exchange:1", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } };
      const unregistered = await present(withProfile({ default: "acme/other" }), plain);
      assert.equal(unregistered.isError, true);
      assert.match(unregistered.content[0].text, /registry\/unregistered-default/);
      assert.match(unregistered.content[0].text, /"acme\/other"/);

      const twice = project({
        ".pi-outpost/structured-exchange.json": { ...registry(), profiles: ["profiles/a.json", "profiles/b.json"] },
        "profiles/a.json": requirementsProfile(),
        "profiles/b.json": requirementsProfile(),
      });
      const duplicate = await present(twice, plain);
      assert.equal(duplicate.isError, true);
      assert.match(duplicate.content[0].text, /registry\/duplicate-profile-identifier/);
      assert.match(duplicate.content[0].text, /profiles\/a\.json/);
      assert.match(duplicate.content[0].text, /profiles\/b\.json/);
    });

    test("two projects with different profiles reach different verdicts on the same document", async () => {
      // The tool is built per project: one shared instance would hold every project to one registry.
      const strict = withProfile({}, requirementsProfile(["draft", "approved"]));
      const lenient = withProfile({}, requirementsProfile(["draft", "approved", "in review"]));
      const document = requirementsGraph("in review");
      assert.equal((await present(strict, document)).isError, true);
      assert.notEqual((await present(lenient, document)).isError, true);
    });

    test("a project without a registry is judged by the core contract alone", async () => {
      // AProjectWithoutARegistryIsUnconstrained
      const result = await present(project({ "README.md": "nothing" }), requirementsGraph("anything at all"));
      assert.notEqual(result.isError, true, result.content[0].text);
      assert.doesNotMatch(result.content[0].text, /conforms to/);
      assert.equal((result.details as { profile?: string }).profile, "acme/requirements", "the profile identifier did not survive");
    });

    test("says a contract refusal is not the profile's even under an unusable registry, and says nothing of profiles without one", async () => {
      // ACoreRefusalSaysItIsNotTheProfile
      const broken = { schema: "urn:structured-exchange:2", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "ghost" }] } };
      const underBrokenRegistry = await present(project({ ".pi-outpost/structured-exchange.json": "{ nope" }), broken);
      assert.equal(underBrokenRegistry.isError, true);
      assert.match(underBrokenRegistry.content[0].text, /not by this project's profile/);

      const withoutRegistry = await present(project({ "README.md": "nothing" }), broken);
      assert.equal(withoutRegistry.isError, true);
      assert.match(withoutRegistry.content[0].text, /^The document was refused\. Nothing was presented\./);
      assert.doesNotMatch(withoutRegistry.content[0].text, /profile/, "a project with no profiles was told about one");
    });

    test("an edited profile applies to the very next call of the same tool", async () => {
      // AnEditedProfileAppliesToTheNextCheck
      const root = withProfile({}, requirementsProfile(["draft", "approved"]));
      const tool = createStructuredExchangeToolDefinition({ projectRoot: root });
      const call = () =>
        (tool.execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-1", {
          document: JSON.stringify(requirementsGraph("in review")),
          summary: "Requirements.",
        });
      assert.equal((await call()).isError, true);
      writeFileSync(path.join(root, "profiles/requirements.json"), JSON.stringify(requirementsProfile(["draft", "approved", "in review"])));
      const again = await call();
      assert.notEqual(again.isError, true, again.content[0].text);
      assert.ok(again.details, "the accepted document did not reach the interface");
    });

    test("under a default, an unregistered profile and a version 1 document are refused, presenting nothing", async () => {
      // AnUnregisteredProfileIsRefusedUnderADefault, AVersionOneDocumentIsRefusedUnderADefault
      const root = withProfile({ default: "acme/requirements" });
      const other = { ...requirementsGraph(), profile: "acme/other" };
      const unregistered = await present(root, other);
      assert.equal(unregistered.isError, true);
      assert.equal(unregistered.details, undefined);
      assert.match(unregistered.content[0].text, /profile\/unregistered-profile at \/profile/);
      assert.match(unregistered.content[0].text, /registered: "acme\/requirements"/);

      const versionOne = await present(root, { schema: "urn:structured-exchange:1", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } });
      assert.equal(versionOne.isError, true);
      assert.equal(versionOne.details, undefined);
      assert.match(versionOne.content[0].text, /profile\/version-1-under-default at \/schema/);
      assert.match(versionOne.content[0].text, /urn:structured-exchange:2/);
    });

    test("without a default, a document naming an unregistered profile is presented generically, its identifier intact", async () => {
      // WithoutADefaultAnUnregisteredProfileIsPresentedGenerically, UnknownProfileUsesGenericPresentation
      const document = { ...requirementsGraph("anything at all"), profile: "https://vendor.example/profiles/other" };
      const result = await present(withProfile(), document);
      assert.notEqual(result.isError, true, result.content[0].text);
      assert.equal((result.details as { profile?: string }).profile, "https://vendor.example/profiles/other");
      assert.doesNotMatch(result.content[0].text, /conforms to/);
    });

    test("tells the agent that a project may hold its documents to a profile", () => {
      const tool = createStructuredExchangeToolDefinition({ projectRoot: base });
      assert.match(tool.description, /profile of its own/);
      assert.match(tool.description, /never invent one/);
    });
  });

  describe("write_structure_figure", () => {
    const figureTool = (projectRoot: string) =>
      createStructuredExchangeFigureToolDefinition({ cwd: projectRoot, allowedRoots: [projectRoot], maxBytes: 4_000_000, writableRoot: projectRoot, projectRoot });
    const draw = (projectRoot: string, params: Record<string, unknown>) =>
      (figureTool(projectRoot).execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-1", params);

    test("does not draw a document that strays from its profile, and writes nothing", async () => {
      // AStrayDocumentIsNotDrawn
      const root = withProfile();
      writeFileSync(path.join(root, "stray.json"), JSON.stringify(requirementsGraph("in review")));
      const result = await draw(root, { path: "stray.json", output_path: "figures/stray.svg" });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /No figure was written/);
      assert.match(result.content[0].text, /profile\/closed-enumeration at \/data\/nodes\/0\/attributes\/status/);
      assert.equal(existsSync(path.join(root, "figures/stray.svg")), false, "a refused figure was written");
    });

    test("draws a conforming document", async () => {
      const root = withProfile();
      writeFileSync(path.join(root, "fine.json"), JSON.stringify(requirementsGraph()));
      const result = await draw(root, { path: "fine.json", output_path: "figures/fine.svg" });
      assert.notEqual(result.isError, true, result.content[0].text);
      assert.ok(existsSync(path.join(root, "figures/fine.svg")));
    });

    test("draws nothing at all while the registry is unusable", async () => {
      const root = project({ ".pi-outpost/structured-exchange.json": "{ broken" });
      writeFileSync(path.join(root, "fine.json"), JSON.stringify(requirementsGraph()));
      const result = await draw(root, { path: "fine.json", output_path: "figures/fine.svg" });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /registry\/not-json/);
      assert.equal(existsSync(path.join(root, "figures/fine.svg")), false);
    });

    test("holds the document to the project's registry, not to one beside the sandbox root", async () => {
      // Under a sandbox, cwd is the sandbox root inside the project; the registry is the project's.
      const root = withProfile();
      const sandboxRoot = path.join(root, "work");
      mkdirSync(sandboxRoot, { recursive: true });
      writeFileSync(path.join(sandboxRoot, "stray.json"), JSON.stringify(requirementsGraph("in review")));
      const tool = createStructuredExchangeFigureToolDefinition({
        cwd: sandboxRoot,
        allowedRoots: [sandboxRoot],
        maxBytes: 4_000_000,
        writableRoot: sandboxRoot,
        projectRoot: root,
      });
      const result = await (tool.execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-1", {
        path: "stray.json",
        output_path: "figures/stray.svg",
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /profile\/closed-enumeration/);
    });
  });
});
