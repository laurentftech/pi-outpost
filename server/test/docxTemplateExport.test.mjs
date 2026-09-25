/**
 * POST /files/docx-template — the viewer's Word export, written into the configured
 * template.
 *
 * The body sent is what the browser sends: a document built with the shared mapping
 * and packed by `docx`. What comes back must be that content in the template's styles,
 * with the template's header and footer; without a template, or with one that cannot
 * be used, the answer says so and the page keeps its plain export.
 */
import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { Packer } from "docx";
import { docxDocument, markdownToDocx } from "@pi-outpost/shared/docx";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { readAllZipEntries } from "../src/zip.ts";

const TEMPLATE = fileURLToPath(new URL("./fixtures/docx-template.dotx", import.meta.url));
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TOKEN = "test-token-docx-template";

const unzip = (bytes) => readAllZipEntries(Buffer.from(bytes), { maxEntries: 4096, maxInflatedBytes: 1e8, maxTotalBytes: 1e9 });

/** The export the browser builds, before the server sees it. */
async function browserExport(markdown) {
  return Buffer.from(await Packer.toBuffer(docxDocument(await markdownToDocx(markdown, {}))));
}

function post(server, body, token = TOKEN) {
  return fetch(`${server.base}/files/docx-template`, {
    method: "POST",
    headers: { "Content-Type": DOCX, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });
}

async function hello(server) {
  const client = connect(server.wsUrl(TOKEN));
  try {
    return await client.waitFor("hello", 30_000);
  } finally {
    client.close();
  }
}

describe("POST /files/docx-template", () => {
  let configured;
  let unconfigured;
  let missing;
  let broken;
  let document;

  before(async () => {
    document = await browserExport("# Findings\n\nThe quarter went **well**.\n\n## Detail\n\n- one\n- two\n");
    const root = await makeWorkspace({});
    await copyFile(TEMPLATE, path.join(root, "house.dotx"));
    configured = await startServer(root, { server: { token: TOKEN }, docx: { template: path.join(root, "house.dotx") } });
    unconfigured = await startServer(await makeWorkspace({}), { server: { token: TOKEN } });
    const missingRoot = await makeWorkspace({});
    missing = await startServer(missingRoot, { server: { token: TOKEN }, docx: { template: path.join(missingRoot, "gone.dotx") } });
    const brokenRoot = await makeWorkspace({});
    await writeFile(path.join(brokenRoot, "broken.dotx"), "not a zip");
    broken = await startServer(brokenRoot, { server: { token: TOKEN }, docx: { template: path.join(brokenRoot, "broken.dotx") } });
  });
  after(async () => {
    await configured?.stop();
    await unconfigured?.stop();
    await missing?.stop();
    await broken?.stop();
  });

  test("ExportUsesTheConfiguredTemplate: the document comes back in the template's styles, header and footer", async () => {
    assert.equal((await hello(configured)).docxTemplate, "house.dotx", "the page is told a template is there, by name only");
    const res = await post(configured, document);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), DOCX);
    const parts = unzip(await res.arrayBuffer());
    const template = unzip(await readFile(TEMPLATE));
    const body = parts.get("word/document.xml").toString("utf8");
    // The template's heading styles, by their localized ids.
    assert.match(body, /<w:pStyle w:val="Titre1"\/><\/w:pPr><w:r><w:t[^>]*>Findings<\/w:t>/);
    assert.match(body, /<w:pStyle w:val="Titre2"\/><\/w:pPr><w:r><w:t[^>]*>Detail<\/w:t>/);
    assert.match(body, /<w:b\/>[\s\S]*well/);
    // Its header and footer, reached from the final section.
    for (const name of ["word/header1.xml", "word/footer1.xml"]) assert.ok(parts.get(name)?.equals(template.get(name)), `${name} is the template's`);
    assert.match(body, /<w:headerReference [^>]*r:id="[^"]+"/);
    assert.match(body, /<w:footerReference [^>]*r:id="[^"]+"/);
    // A document, not a template, and none of the template's sample text.
    assert.match(parts.get("[Content_Types].xml").toString("utf8"), /wordprocessingml\.document\.main\+xml/);
    assert.doesNotMatch(body, /texte d’exemple/);
  });

  test("WithoutATemplateTheExportIsUnchanged: no template is offered, and the route says there is none", async () => {
    assert.equal((await hello(unconfigured)).docxTemplate, undefined);
    const res = await post(unconfigured, document);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "no-template", message: "No Word template is configured (docx.template)." });
  });

  test("ABrokenTemplateDoesNotBlockThePlainExport: a missing or unusable template is reported with its reason", async () => {
    const gone = await post(missing, document);
    assert.equal(gone.status, 422);
    assert.match((await gone.json()).message, /The Word template gone\.dotx cannot be read\./);
    const bad = await post(broken, document);
    assert.equal(bad.status, 422);
    assert.match((await bad.json()).message, /^The Word template broken\.dotx: the template cannot be read/);
  });

  test("a body that is not a Word document is refused as such, not blamed on the template", async () => {
    const res = await post(configured, Buffer.from("not a docx"));
    assert.equal(res.status, 422);
    const answer = await res.json();
    assert.equal(answer.error, "document");
    assert.match(answer.message, /^The document could not be written into the template/);
  });

  test("the token is required, as for every other file route", async () => {
    assert.equal((await post(configured, document, null)).status, 401);
    assert.equal((await post(configured, document, "wrong")).status, 401);
  });
});
