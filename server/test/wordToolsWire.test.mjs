/**
 * The Word tools over a real server and a real embedded session: withheld until a
 * Word template is named or the skill is loaded, and then used end to end — the agent
 * reads the template's styles, writes a report into it, revises a section as tracked
 * changes, and renders the result.
 *
 * The "model" is scripted (fixtures/presentation-tools-provider.mjs). What is asserted
 * is what reached it — the tool lists it was sent, the results it was handed back — and
 * the files it left in the workspace.
 */
import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/presentation-tools-provider.mjs", import.meta.url));
const TEMPLATE = fileURLToPath(new URL("./fixtures/docx-template.dotx", import.meta.url));
const SKILL_DIR = fileURLToPath(new URL("../../skills/docx-from-template", import.meta.url));
const WORD = ["docx_styles", "docx_create", "docx_update", "docx_restyle", "docx_render"];

async function lines(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** The nth request that carried tools — a session-naming call carries none. */
async function nthRequest(file, index, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = (await lines(file)).filter((tools) => tools.length > 0);
    if (all.length > index) return all[index];
    if (Date.now() > deadline) throw new Error(`request ${index} never reached the model (${all.length} so far)`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function results(file, count, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await lines(file);
    if (all.length >= count) return all;
    if (Date.now() > deadline) throw new Error(`only ${all.length} of ${count} tool results arrived`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** A part of a .docx, read with the server's own zip reader. */
async function part(file, name) {
  const { readAllZipEntries } = await import("../src/zip.ts");
  return readAllZipEntries(await readFile(file), { maxEntries: 4096, maxInflatedBytes: 1e8, maxTotalBytes: 1e9 }).get(name)?.toString("utf8") ?? "";
}

async function start(config = {}) {
  const root = await makeWorkspace({
    "diagram.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#2563EB"/></svg>',
  });
  await copyFile(TEMPLATE, path.join(root, "brand.dotx"));
  const toolsLog = path.join(root, "tools.jsonl");
  const resultsLog = path.join(root, "results.jsonl");
  const server = await startServer(
    root,
    {
      extensionPaths: [PROVIDER],
      skillPaths: [SKILL_DIR],
      allowedModels: [{ provider: "presentation-tools-test", id: "presentation-tools-test" }],
      ...config,
    },
    { env: { DOCUMENT_TOOLS_LOG: toolsLog, PRESENTATION_RESULTS_LOG: resultsLog } },
  );
  const client = connect(server.wsUrl());
  const hello = await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", provider: "presentation-tools-test", id: "presentation-tools-test" });
  await client.waitFor((message) => message.type === "model_changed");
  return { root, toolsLog, resultsLog, server, client, hello };
}

test("NamingAWordTemplatePublishesTheTools: withheld until a .dotx is named, then the four tools and not the extractor", async () => {
  const { toolsLog, server, client, hello } = await start();
  try {
    const published = hello.tools.filter((tool) => tool.active).map((tool) => tool.name);
    for (const tool of WORD) assert.ok(!published.includes(tool), `${tool} is withheld from a fresh session`);
    for (const tool of WORD) assert.ok(hello.tools.some((entry) => entry.name === tool), `${tool} is registered`);

    client.send({ type: "prompt", text: "Just say ok." });
    const plain = await nthRequest(toolsLog, 0);
    for (const tool of WORD) assert.ok(!plain.includes(tool), `${tool} not sent for a prompt naming no template`);

    client.send({ type: "prompt", text: "Write the quarterly report from brand.dotx." });
    const named = await nthRequest(toolsLog, 1);
    for (const tool of WORD) assert.ok(named.includes(tool), `${tool} reached the model on the turn that named the template`);
    assert.ok(!named.includes("docx_extract"), "naming a .dotx does not publish the extractor");
  } finally {
    client.close();
    await server.stop();
  }
});

test("ReadingTheSkillPublishesTheToolsWithinTheTurn: the request after the read carries the four tools", async () => {
  const { toolsLog, server, client } = await start();
  try {
    client.send({ type: "prompt", text: `READ THE SKILL ${path.join(SKILL_DIR, "SKILL.md")}` });
    const before = await nthRequest(toolsLog, 0);
    for (const tool of WORD) assert.ok(!before.includes(tool), `${tool} not there before the skill is read`);
    const after = await nthRequest(toolsLog, 1);
    for (const tool of WORD) assert.ok(after.includes(tool), `${tool} offered on the request after the agent read the skill`);
    assert.ok(!after.includes("docx_extract"), "the skill does not bring the extractor back");
  } finally {
    client.close();
    await server.stop();
  }
});

test("the agent reads the styles, writes a report, revises a section as tracked changes, and renders it", async () => {
  const { root, resultsLog, server, client } = await start();
  try {
    client.send({ type: "prompt", text: "WRITE THE REPORT from brand.dotx" });
    const [styles, created, updated, rendered] = await results(resultsLog, 4);

    assert.equal(styles.tool, "docx_styles");
    assert.equal(styles.isError, false, styles.text);
    assert.match(styles.text, /heading 1/i);

    assert.equal(created.tool, "docx_create");
    assert.equal(created.isError, false, created.text);
    const report = path.join(root, "report.docx");
    const body = await part(report, "word/document.xml");
    // Headings in the template's own (French) styles, the picture embedded, the cover kept.
    assert.match(body, /<w:pStyle w:val="Titre1"\/><\/w:pPr><w:r><w:t[^>]*>Findings<\/w:t>/);
    assert.match(body, /<w:pStyle w:val="Titre2"\/><\/w:pPr><w:r><w:t[^>]*>Detail<\/w:t>/);
    assert.match(body, /<a:blip r:embed="/);
    assert.match(body, /docPartGallery w:val="Cover Pages"/);
    assert.doesNotMatch(body, /texte d’exemple/, "no sample text");

    assert.equal(updated.tool, "docx_update");
    assert.equal(updated.isError, false, updated.text);
    const revised = await part(path.join(root, "report-v2.docx"), "word/document.xml");
    assert.match(revised, /<w:delText[^>]*>Keep going\.<\/w:delText>/);
    assert.match(revised, /<w:ins [^>]*w:author="pi-outpost"[^>]*><w:r><w:t[^>]*>Hire two people\.<\/w:t>/);
    assert.equal(await part(report, "word/document.xml"), body, "the original is unchanged");

    assert.equal(rendered.tool, "docx_render");
    // CI runners have no office application: there the result says so. Where one
    // exists, the chapters come back as bookmarks and every paragraph is on a page.
    if (rendered.isError) {
      assert.match(rendered.text, /No office application could render the document[\s\S]*Install LibreOffice/);
    } else {
      assert.match(rendered.text, /^Rendered `report-v2\.docx` with (Word|LibreOffice|ONLYOFFICE): \d+ page\(s\)\./);
      assert.match(rendered.text, /Findings[\s\S]*Next steps/);
      assert.ok(rendered.images >= 1);
    }
  } finally {
    client.close();
    await server.stop();
  }
});

test("PptxRendererKeysStillWork: the 0.29 pptx.* keys choose the renderer of documents and decks alike", async () => {
  // A LibreOffice named at a path that does not exist: if the deprecated keys reached
  // both tools, both try LibreOffice there and nothing else — on any machine.
  const missing = path.join(path.dirname(TEMPLATE), "no-such-office", "soffice");
  const { root, resultsLog, server, client } = await start({ pptx: { renderer: "libreoffice", libreofficePath: missing } });
  try {
    await copyFile(fileURLToPath(new URL("./fixtures/docx-rendered.docx", import.meta.url)), path.join(root, "report.docx"));
    await copyFile(fileURLToPath(new URL("./fixtures/pptx-rendered.pptx", import.meta.url)), path.join(root, "deck.pptx"));
    client.send({ type: "prompt", text: "RENDER BOTH report.docx and deck.pptx" });
    const [document, deck] = await results(resultsLog, 2);
    assert.equal(document.tool, "docx_render");
    assert.equal(deck.tool, "pptx_render");
    for (const rendered of [document, deck]) {
      assert.equal(rendered.isError, true, rendered.text);
      // One attempt, LibreOffice at the configured path: no other application was tried.
      const attempts = rendered.text.split(/\r?\n/).filter((line) => line.startsWith("- "));
      assert.deepEqual(attempts, [`- libreoffice: no executable at ${missing}`], rendered.text);
    }
  } finally {
    client.close();
    await server.stop();
  }
});

test("the agent brings an old document into the template and renders it", async () => {
  const { root, resultsLog, server, client } = await start();
  try {
    await copyFile(fileURLToPath(new URL("./fixtures/docx-drifted.docx", import.meta.url)), path.join(root, "old.docx"));
    const original = await readFile(path.join(root, "old.docx"));
    client.send({ type: "prompt", text: "RESTYLE THE DOCUMENT old.docx with brand.dotx" });
    const [restyled, rendered] = await results(resultsLog, 2);

    assert.equal(restyled.tool, "docx_restyle");
    assert.equal(restyled.isError, false, restyled.text);
    assert.match(restyled.text, /Removed hand-set formatting from 17 run\(s\)/);
    assert.match(restyled.text, /"Boxed text" \(1 use\)/);
    const body = await part(path.join(root, "old-restyled.docx"), "word/document.xml");
    assert.match(body, /<w:pStyle w:val="Titre1"\/>/);
    assert.match(body, /<w:rPrChange [^>]*w:author="pi-outpost"/);
    assert.ok((await readFile(path.join(root, "old.docx"))).equals(original), "the original is unchanged");

    assert.equal(rendered.tool, "docx_render");
    if (rendered.isError) {
      assert.match(rendered.text, /No office application could render the document[\s\S]*Install LibreOffice/);
    } else {
      assert.match(rendered.text, /^Rendered `old-restyled\.docx` with (Word|LibreOffice|ONLYOFFICE): \d+ page\(s\)\./);
      // The template's heading numbering, in the bookmarks.
      assert.match(rendered.text, /- 1\. Introduction[\s\S]*- 2\. Conclusion/);
      assert.match(rendered.text, /Text check: every paragraph of the body is on a page\./);
    }
  } finally {
    client.close();
    await server.stop();
  }
});
