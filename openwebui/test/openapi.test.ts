/**
 * The description Open WebUI builds its tools from — tested as published, so the
 * examples a model copies are the ones the server accepts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SECRET, testApp } from "./helpers.ts";

async function published(t: test.TestContext) {
  const harness = await testApp(t);
  const response = await harness.app.inject({ method: "GET", url: "/openapi.json", headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(response.statusCode, 200);
  return { ...harness, document: response.json() };
}

function exampleIn(description: string): unknown {
  const match = /```json\n([\s\S]*?)\n```/.exec(description);
  assert.ok(match, "a json example in the description");
  return JSON.parse(match[1]!);
}

// openlore: scenario=TheDescriptionNamesTheFiveTools spec=openwebui-planning-server
test("TheDescriptionNamesTheFiveTools: exactly the operations — planning, structure and document tools, each described with an input schema", async (t) => {
  const { document } = await published(t);
  const operations = Object.values(document.paths as Record<string, { post: { operationId: string; description: string; requestBody: unknown } }>).map(
    (path) => path.post,
  );
  assert.deepEqual(operations.map((op) => op.operationId).sort(), [
    "create_document",
    "create_planning",
    "create_poster",
    "create_presentation",
    "get_planning",
    "get_poster",
    "list_documents",
    "list_plannings",
    "list_posters",
    "list_templates",
    "read_structure_guide",
    "show_planning",
    "show_poster",
    "show_structure",
    "update_document",
    "update_planning",
    "update_poster",
    "update_presentation",
  ]);
  for (const op of operations) {
    assert.ok(op.description.length > 40, op.operationId);
    assert.equal((op.requestBody as { content: Record<string, { schema: { type: string } }> }).content["application/json"]!.schema.type, "object");
  }
  // Each path is the tool's own name, so the route and the tool cannot disagree.
  for (const [path, item] of Object.entries(document.paths as Record<string, { post: { operationId: string } }>)) {
    assert.equal(path, `/${item.post.operationId}`);
  }
});

// openlore: scenario=TheCreationExampleIsValid spec=openwebui-planning-server
// openlore: scenario=TheUpdateExampleApplies spec=openwebui-planning-server
test("TheCreationExampleIsValid and TheUpdateExampleApplies: the examples as published", async (t) => {
  const { document, call } = await published(t);
  const creation = exampleIn(document.paths["/create_planning"].post.description);
  const created = await call("create_planning", { planning: creation });
  assert.equal(created.statusCode, 201, created.body);

  const update = exampleIn(document.paths["/update_planning"].post.description) as { id: string };
  const applied = await call("update_planning", { ...update, id: created.json().id });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().revision, 2);
  // The example says it moves the inspection and adds a handover: it does.
  const items = applied.json().planning.data.rows.flatMap((row: { items?: Array<{ id: string; date?: string }> }) => row.items ?? []);
  assert.equal(items.find((item: { id: string }) => item.id === "inspection").date, "2031-05-28");
  assert.ok(items.some((item: { id: string }) => item.id === "handover"));
});

// openlore: scenario=EveryExampleIsShown spec=openwebui-structured-exchange
test("EveryExampleIsShown: each example in show_structure's published description is shown", async (t) => {
  const { document, call } = await published(t);
  const description: string = document.paths["/show_structure"].post.description;
  const examples = [...description.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]!));
  assert.deepEqual(
    examples.map((example) => (example.target ? "proposal" : example.kind)),
    ["graph", "sequence", "table", "proposal"],
  );
  for (const example of examples) {
    const response = await call("show_structure", { document: example });
    assert.equal(response.statusCode, 200, `${example.kind}${example.target ? " proposal" : ""}: ${response.body.slice(0, 300)}`);
  }
  assert.match(description, /nothing is applied/);
  assert.match(description, /Omitting an element never removes it/);
});

// openlore: scenario=ShowStructureNamesTheGuide spec=openwebui-structure-guide
test("ShowStructureNamesTheGuide: the structure and planning tools point to the guide and its topics", async (t) => {
  const { document } = await published(t);
  const structure: string = document.paths["/show_structure"].post.description;
  assert.match(structure, /read_structure_guide/);
  for (const topic of ["graphs-and-tables", "proposals", "timelines", "enriched"]) assert.ok(structure.includes(`"${topic}"`), topic);
  assert.match(document.paths["/create_planning"].post.description, /read_structure_guide with topic "timelines"/);
  const guide = document.paths["/read_structure_guide"].post;
  assert.deepEqual(guide.requestBody.content["application/json"].schema.properties.topic.enum, ["graphs-and-tables", "proposals", "timelines", "enriched"]);
});

test("no description offers a copyable placeholder id, and show_planning waits for create_planning", async (t) => {
  const { document } = await published(t);
  const text = JSON.stringify(document);
  assert.doesNotMatch(text, /pl_…|pl_\\u2026/, "a model copied `pl_…` as an id");
  assert.match(document.paths["/create_planning"].post.description, /once this call has answered[\s\S]*never in the same step/);
});

test("the creating tools send a change to the updating ones", async (t) => {
  const { document } = await published(t);
  const description = (tool: string) => (document.paths as Record<string, { post: { description: string } }>)[`/${tool}`]!.post.description;
  // Codestral, asked to add a slide, sent create_presentation only the new one.
  assert.match(description("create_presentation"), /use update_presentation with its file_name, not create_presentation/);
  assert.match(description("create_document"), /use update_document with its file_name, not create_document/);
});
