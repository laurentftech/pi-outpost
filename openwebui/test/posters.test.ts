/**
 * Posters on the Open WebUI tool server: the tools, kept per user, and the embed the
 * user retouches them in. The scenarios are openwebui-posters'.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { MAX_POSTER_BYTES } from "@pi-outpost/posters/format";
import { POSTER_EXAMPLE, POSTER_GUIDE } from "@pi-outpost/posters/guide";
import { SECRET, testApp } from "./helpers.ts";
import { posterViewerAssets } from "../src/posters.ts";

const POSTER = { title: "Class rules", html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format };

function payloadOf(html: string, name: string): string {
  const match = new RegExp(`data-${name}="([A-Za-z0-9+/=]*)"`).exec(html);
  assert.ok(match, `payload ${name}`);
  return gunzipSync(Buffer.from(match[1]!, "base64")).toString("utf8");
}

// openlore: scenario=EachUserSeesTheirOwnPosters spec=openwebui-posters
test("EachUserSeesTheirOwnPosters: a poster is listed for its owner only, and another's id is not found", async (t) => {
  const { call } = await testApp(t);
  const alices = (await call("create_poster", POSTER, "alice")).json();
  await call("create_poster", { ...POSTER, title: "Bob's" }, "bob");
  assert.deepEqual((await call("list_posters", {}, "alice")).json().posters.map((p: { title: string }) => p.title), ["Class rules"]);
  assert.deepEqual((await call("list_posters", {}, "bob")).json().posters.map((p: { title: string }) => p.title), ["Bob's"]);
  const stolen = await call("get_poster", { id: alices.id }, "bob");
  assert.equal(stolen.statusCode, 404);
  assert.equal((await call("show_poster", { id: alices.id }, "bob")).statusCode, 404);
});

test("PosterTools: a change needs the revision it starts from, and a stale one is refused", async (t) => {
  const { call } = await testApp(t);
  const { id } = (await call("create_poster", POSTER)).json();
  const read = (await call("get_poster", { id })).json();
  assert.equal(read.revision, 1);
  assert.equal(read.html, POSTER.html);
  const changed = await call("update_poster", { id, base_revision: 1, html: POSTER.html.replace("I listen", "I listen well"), css: POSTER.css, format: "A4-portrait" });
  assert.equal(changed.json().revision, 2);
  const stale = await call("update_poster", { id, base_revision: 1, html: "<p>late</p>", css: "", format: "A4-portrait" });
  assert.equal(stale.statusCode, 409);
  assert.match(stale.json().error, /is at revision 2, not 1: read it again with get_poster/);
  assert.match((await call("get_poster", { id })).json().html, /I listen well/);
  assert.equal((await call("get_poster", { id, revision: 1 })).json().html, POSTER.html);
  assert.equal((await call("update_poster", { id, html: "x", css: "", format: "A4-portrait" })).statusCode, 422);
});

test("PosterTools refuse what the format refuses: a script, an unknown format, an oversized poster", async (t) => {
  const { call } = await testApp(t);
  const script = await call("create_poster", { ...POSTER, html: "<p>x</p><script>steal()</script>" });
  assert.equal(script.statusCode, 422);
  assert.match(script.json().error, /holds no script/);
  const format = await call("create_poster", { ...POSTER, format: "Letter" });
  assert.equal(format.statusCode, 422);
  assert.deepEqual(format.json().formats, ["A4-portrait", "A4-landscape", "A3-portrait", "A3-landscape", "slide-16:9"]);
  const huge = await call("create_poster", { ...POSTER, html: "x".repeat(MAX_POSTER_BYTES + 1) });
  assert.equal(huge.statusCode, 413);
  assert.deepEqual((await call("list_posters")).json().posters, []);
});

// openlore: scenario=TheEditorAppearsInTheChat spec=openwebui-posters
test("TheEditorAppearsInTheChat: show_poster answers a self-contained page carrying the editor and the poster", async (t) => {
  const { call } = await testApp(t);
  const { id } = (await call("create_poster", { ...POSTER, title: 'R&D "rules" <A>' })).json();
  const response = await call("show_poster", { id });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /^text\/html/);
  assert.equal(response.headers["content-disposition"], "inline");
  const html = response.body;
  // Open WebUI reads embeds back through an HTML-entity decoder: no & may be in the page.
  assert.ok(!html.includes("&"), "no & anywhere, even with one in the title");
  assert.doesNotMatch(html, /\b(src|href)=/, "the page loads nothing");
  const poster = JSON.parse(payloadOf(html, "poster"));
  assert.deepEqual(poster, { id, title: 'R&D "rules" <A>', revision: 1, html: POSTER.html, css: POSTER.css, format: "A4-portrait" });
  assert.equal(payloadOf(html, "script"), posterViewerAssets().script);
  assert.match(payloadOf(html, "script"), /mountEditor|poster-shell/);
});

test("The embed's policy lets only its own two scripts run, by hash, and fetches nothing", async (t) => {
  const { call } = await testApp(t);
  const { id } = (await call("create_poster", POSTER)).json();
  const html = (await call("show_poster", { id })).body;
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
  assert.ok(policy, "a policy in the page");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  // The page's one inline script, by position: the page is ours and holds exactly one.
  const opening = html.indexOf("<script>") + "<script>".length;
  const bootstrap = html.slice(opening, html.indexOf("</script>", opening));
  const hash = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
  assert.ok(policy.includes(hash(bootstrap)), "the bootstrap is allowed by its hash");
  assert.ok(policy.includes(hash(posterViewerAssets().script)), "the editor is allowed by its hash");
});

// openlore: scenario=TheLimitIsSaid spec=openwebui-posters
// openlore: scenario=TheDefaultSandboxStillShowsThePoster spec=openwebui-posters
test("TheLimitIsSaid: the embed's editor carries the notice, and names the setting editing needs", () => {
  const script = posterViewerAssets().script;
  assert.match(script, /Your changes stay in this page: your downloads carry them, but the model does not see them/);
  assert.match(script, /iframe Sandbox Allow Same Origin/);
});

// openlore: scenario=EveryHostGivesTheSameGuide spec=poster-documents
test("EveryHostGivesTheSameGuide (Open WebUI): create_poster and update_poster carry the shared guide", async (t) => {
  const { app } = await testApp(t);
  const document = (await app.inject({ method: "GET", url: "/openapi.json", headers: { authorization: `Bearer ${SECRET}` } })).json();
  for (const tool of ["create_poster", "update_poster"]) assert.ok(document.paths[`/${tool}`].post.description.includes(POSTER_GUIDE), tool);
  assert.match(document.paths["/get_poster"].post.description, /Unsaved changes in an open embed are not available until the user saves them/);
});

// openlore: scenario=TheModelStartsFromItsOwnVersion spec=openwebui-posters
test("TheModelStartsFromItsOwnVersion: without browser-save configuration, edits stay in the embed", async (t) => {
  const { call } = await testApp(t);
  const { id } = (await call("create_poster", POSTER)).json();
  await call("show_poster", { id });
  // Without public save configuration, the embed has no save capability and its policy
  // refuses every connection: the only revisions are the model's.
  const read = (await call("get_poster", { id })).json();
  assert.equal(read.revision, 1);
  assert.equal(read.html, POSTER.html);
  // GrapesJS carries fetch code (its telemetry, turned off); the page's policy refuses every
  // connection whatever it holds, which the policy test checks.
  assert.doesNotMatch(posterViewerAssets().script, /poster-save/);
});

// openlore: scenario=AUserSavesTouchUps spec=openwebui-posters
// openlore: scenario=TheEmbedDoesNotReceiveTheToolBearerSecret spec=openwebui-posters
// openlore: scenario=AStaleEmbedCannotOverwriteANewerRevision spec=openwebui-posters
test("EmbedSavesTouchUpsAsAnOwnerScopedRevision: capability saves, rotates, and conflicts on replay", async (t) => {
  const { app, call } = await testApp(t, { publicUrl: "http://localhost:8790", webUiOrigin: "http://localhost:3000" });
  const { id } = (await call("create_poster", POSTER, "alice")).json();
  const shown = await call("show_poster", { id }, "alice");
  const embedded = JSON.parse(payloadOf(shown.body, "poster"));
  assert.equal(embedded.saveEndpoint, "http://localhost:8790/poster-save");
  assert.equal(typeof embedded.saveTicket, "string");
  assert.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(shown.body)?.[1] ?? "", /connect-src http:\/\/localhost:8790/);
  assert.doesNotMatch(shown.body, /test-bearer-secret/);

  const save = (ticket: string, body: Record<string, unknown>, baseRevision = 1, origin = "http://localhost:3000") => app.inject({
    method: "POST", url: "/poster-save", headers: { origin, "content-type": "text/plain;charset=UTF-8" },
    payload: JSON.stringify({ id, base_revision: baseRevision, ticket, ...body }),
  });
  const changed = await save(embedded.saveTicket, { html: POSTER.html.replace("I listen", "I listen closely"), css: POSTER.css, format: POSTER.format });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().revision, 2);
  const replay = await save(embedded.saveTicket, { html: "<p>late</p>", css: "", format: POSTER.format });
  assert.equal(replay.statusCode, 409);
  const bob = await call("get_poster", { id }, "bob");
  assert.equal(bob.statusCode, 404);
  const alice = await call("get_poster", { id }, "alice");
  assert.equal(alice.json().revision, 2);
  assert.match(alice.json().html, /I listen closely/);

  const next = await save(changed.json().ticket, { html: POSTER.html.replace("I listen", "I listen well"), css: POSTER.css, format: POSTER.format }, 2);
  assert.equal(next.statusCode, 200, next.body);
  assert.equal(next.json().revision, 3);
});

// openlore: scenario=ADifferentOriginCannotSave spec=openwebui-posters
// openlore: scenario=AMissingOrInvalidCapabilityCannotSave spec=openwebui-posters
test("PosterSaveEndpointIsConstrainedToTheConfiguredWebUI: origin, poster and revision scope are checked", async (t) => {
  const { app, call } = await testApp(t, { publicUrl: "http://localhost:8790", webUiOrigin: "http://localhost:3000" });
  const { id } = (await call("create_poster", POSTER)).json();
  const embedded = JSON.parse(payloadOf((await call("show_poster", { id })).body, "poster"));
  const preflight = await app.inject({ method: "OPTIONS", url: "/poster-save", headers: { origin: "http://localhost:3000" } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.equal(preflight.headers["access-control-allow-credentials"], undefined);
  const request = (payload: Record<string, unknown>, origin = "http://localhost:3000") => app.inject({
    method: "POST", url: "/poster-save", headers: { origin, "content-type": "text/plain;charset=UTF-8" }, payload: JSON.stringify(payload),
  });
  const base = { id, base_revision: 1, ticket: embedded.saveTicket, html: "<p>edited</p>", css: "", format: POSTER.format };
  assert.equal((await request(base, "http://evil.test")).statusCode, 403);
  assert.equal((await request({ ...base, ticket: "" })).statusCode, 403);
  assert.equal((await request({ ...base, id: "po_fedcba0987654321" })).statusCode, 403);
  assert.equal((await request({ ...base, base_revision: 2 })).statusCode, 403);
  assert.equal((await request({ ...base, html: "<script>bad()</script>" })).statusCode, 422);
  assert.equal((await app.inject({ method: "OPTIONS", url: "/poster-save", headers: { origin: "http://evil.test" } })).statusCode, 403);
  assert.equal((await call("get_poster", { id })).json().revision, 1);
});

/** A picture as the editor embeds one, large enough that leaking it would show. */
const PHOTO = `data:image/jpeg;base64,${"/9j/4".repeat(40_000)}`;
const WITH_PHOTO = POSTER.html.replace('<img class="photo" data-poster-picture="class photo" alt="Our class">', `<img class="photo" data-poster-picture="class photo" alt="Our class" src="${PHOTO}">`);

async function savedWithPhoto(t: Parameters<typeof testApp>[0]) {
  const { app, call } = await testApp(t, { publicUrl: "http://localhost:8790", webUiOrigin: "http://localhost:3000" });
  const { id } = (await call("create_poster", POSTER)).json();
  const embedded = JSON.parse(payloadOf((await call("show_poster", { id })).body, "poster"));
  const saveAs = (ticket: string, html: string, base: number) => app.inject({
    method: "POST", url: "/poster-save", headers: { origin: "http://localhost:3000", "content-type": "text/plain;charset=UTF-8" },
    payload: JSON.stringify({ id, base_revision: base, ticket, html, css: POSTER.css, format: POSTER.format }),
  });
  const saved = await saveAs(embedded.saveTicket, WITH_PHOTO, 1);
  assert.equal(saved.statusCode, 200, saved.body);
  return { call, id, saveAs, ticket: saved.json().ticket as string };
}

// openlore: scenario=GetPosterReturnsMarkers spec=poster-elements
// openlore: scenario=TheModelRewritesAPosterAndKeepsItsPictures spec=poster-elements
test("Open WebUI: get_poster shows the user's picture as a marker, and update_poster puts it back", async (t) => {
  const { call, id } = await savedWithPhoto(t);
  const read = await call("get_poster", { id });
  assert.ok(!read.body.includes("base64"), "no picture data reaches the model");
  assert.match(read.json().html, /^<!-- poster pictures: poster-picture:1 \(class photo\) \d+ kB\./);
  assert.ok(read.json().html.includes('alt="Our class" src="poster-picture:1"'));
  const updated = await call("update_poster", { id, base_revision: 2, html: read.json().html.replace("Our class rules", "Our rules"), css: read.json().css, format: POSTER.format });
  assert.equal(updated.statusCode, 200, updated.body);
  const reread = await call("get_poster", { id });
  assert.equal(reread.json().revision, 3);
  // Read back in full through the store's own view of the poster: the photo is there, unchanged.
  const embed = JSON.parse(payloadOf((await call("show_poster", { id })).body, "poster"));
  assert.equal(embed.html, WITH_PHOTO.replace("Our class rules", "Our rules"));
});

// openlore: scenario=AnUnknownMarkerIsRefused spec=poster-elements
test("Open WebUI: a marker naming no picture is refused, and nothing is written", async (t) => {
  const { call, id } = await savedWithPhoto(t);
  const refused = await call("update_poster", { id, base_revision: 2, html: '<img src="poster-picture:3">', css: "", format: POSTER.format });
  assert.equal(refused.statusCode, 422);
  assert.match(refused.json().error, /poster-picture:3 names no picture of this poster \(it has poster-picture:1 to poster-picture:1\)/);
  assert.equal((await call("get_poster", { id })).json().revision, 2);
  const fresh = await call("create_poster", { ...POSTER, html: '<img src="poster-picture:1">' });
  assert.equal(fresh.statusCode, 422);
});

test("Open WebUI: a poster near the 8 MB ceiling is saved through the embed's capability", async (t) => {
  const { saveAs, ticket } = await savedWithPhoto(t);
  const big = `data:image/jpeg;base64,${"A".repeat(MAX_POSTER_BYTES - 200_000)}`;
  const saved = await saveAs(ticket, POSTER.html.replace("</main>", `<img src="${big}"></main>`), 2);
  assert.equal(saved.statusCode, 200, saved.body.slice(0, 200));
  assert.equal(saved.json().revision, 3);
});

// openlore: scenario=TheNewTitleIsListed spec=openwebui-posters
test("TheNewTitleIsListed: update_poster with a title retitles the poster", async (t) => {
  const { call } = await testApp(t);
  const { id } = (await call("create_poster", POSTER)).json();
  const updated = await call("update_poster", { id, base_revision: 1, title: "Menu du jour", html: POSTER.html, css: POSTER.css, format: POSTER.format });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().title, "Menu du jour");
  assert.equal((await call("get_poster", { id })).json().title, "Menu du jour");
  assert.deepEqual((await call("list_posters")).json().posters.map((entry: { title: string }) => entry.title), ["Menu du jour"]);
  assert.equal((await call("update_poster", { id, base_revision: 2, title: "  ", html: POSTER.html, css: POSTER.css, format: POSTER.format })).statusCode, 422);
});
