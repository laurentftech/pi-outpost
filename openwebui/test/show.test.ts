/**
 * What show_planning answers: a page Open WebUI embeds, carrying the planning — or
 * the comparison — itself, and surviving the way Open WebUI stores embeds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { samplePlanning, testApp } from "./helpers.ts";

function payloadOf(html: string, name: string): string {
  const match = new RegExp(`data-${name}="([A-Za-z0-9+/=]*)"`).exec(html);
  assert.ok(match, `payload ${name}`);
  return gunzipSync(Buffer.from(match[1]!, "base64")).toString("utf8");
}

/**
 * Open WebUI v0.11.4 stores embeds with JSON.stringify and reads them back through an
 * HTML-entity decoder before JSON.parse (structuredOutput.ts, ToolCallDisplay.svelte).
 * The decoder used is `html-entities` at level "all"; any `&` that starts an entity
 * can change the JSON. A page with no `&` at all survives the round trip unchanged.
 */
function survivesOpenWebUIStorage(html: string): boolean {
  return !html.includes("&");
}

// openlore: scenario=ShowingAPlanningEmbedsTheTimeline spec=openwebui-planning-server
test("ShowingAPlanningEmbedsTheTimeline: inline HTML, the current revision inside, nothing to fetch", async (t) => {
  const { call } = await testApp(t);
  const planning = samplePlanning("R&D <plan> \"quoted\"");
  const created = await call("create_planning", { planning });
  const response = await call("show_planning", { id: created.json().id });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /^text\/html/);
  assert.equal(response.headers["content-disposition"], "inline");
  assert.match(String(response.headers["access-control-expose-headers"]), /Content-Disposition/);

  const html = response.body;
  assert.ok(survivesOpenWebUIStorage(html), "no & anywhere in the page, even with one in the planning");
  assert.doesNotMatch(html, /\b(src|href)=/, "the page loads nothing");
  const embedded = JSON.parse(payloadOf(html, "planning"));
  assert.equal(embedded.id, created.json().id);
  assert.equal(embedded.revision, 1);
  assert.deepEqual(embedded.data, planning.data);
  assert.match(payloadOf(html, "script"), /input:prompt/);
  assert.doesNotMatch(payloadOf(html, "script"), /input:prompt:submit/);
});

test("show_planning refuses an id that is not one", async (t) => {
  const { call } = await testApp(t);
  assert.equal((await call("show_planning", {})).statusCode, 422);
  assert.equal((await call("show_planning", { id: "pl_AAAAAAAAAAAAAAAA" })).statusCode, 404);
});
