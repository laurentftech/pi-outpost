/**
 * update_document, update_presentation and list_documents: a file written earlier, kept
 * under its name for the user, changed by naming what to change.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";
import { slideTitles } from "@pi-outpost/office/pptxUpdate.ts";
import { createMermaidRenderer } from "@pi-outpost/office/mermaidRender.ts";
import { DOCUMENT_EXAMPLE, PRESENTATION_EXAMPLE, UPDATE_DOCUMENT_EXAMPLE, UPDATE_PRESENTATION_EXAMPLE } from "../src/openapi.ts";
import { filesUnder, testApp } from "./helpers.ts";

const mermaid = createMermaidRenderer();
after(() => mermaid.close());
const app = (t: Parameters<typeof testApp>[0], overrides: Parameters<typeof testApp>[1] = {}) => testApp(t, overrides, { mermaid });

/** The file an embed carries, and its card's outline. */
function download(response: { statusCode: number; body: string }) {
  assert.equal(response.statusCode, 200, response.body.slice(0, 500));
  const payload = JSON.parse(gunzipSync(Buffer.from(/data-planning="([A-Za-z0-9+/=]*)"/.exec(response.body)![1]!, "base64")).toString("utf8"));
  const bytes = Buffer.from(payload.data, "base64");
  return { payload, bytes, parts: readAllZipEntries(bytes, { maxEntries: 2000, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 }) };
}

const DECK = {
  file_name: "review",
  slides: [{ title: "Review", subtitle: "October" }, { title: "Progress", bullets: ["one", "two"] }, { title: "Risks", bullets: ["late boards"] }],
};

const headingTexts = (parts: Map<string, Buffer>) =>
  [...parts.get("word/document.xml")!.toString("utf8").matchAll(/<w:pStyle w:val="Heading(\d)"\/>(?:(?!<\/w:p>)[\s\S])*?<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => `${match[1]} ${match[2]}`);

// openlore: scenario=ASlideIsAddedToAKeptDeck spec=openwebui-office-documents
test("ASlideIsAddedToAKeptDeck: the new slide in its place, every other slide as it was", async (t) => {
  const { call } = await app(t);
  const created = download(await call("create_presentation", DECK));
  const updated = download(
    await call("update_presentation", { file_name: "review.pptx", edits: [{ action: "insert_after", slide: "2", content: { title: "Budget", bullets: ["on track"] } }] }),
  );
  assert.deepEqual(slideTitles(updated.bytes), ["Review", "Progress", "Budget", "Risks"]);
  assert.deepEqual(updated.payload.outline.map((entry: { text: string }) => entry.text), ["Review", "Progress", "Budget", "Risks"]);
  assert.equal(updated.payload.fileName, "review.pptx");
  // The untouched slides keep their own parts, byte for byte.
  const text = (parts: Map<string, Buffer>, title: string) => [...parts.entries()].find(([name, data]) => /^ppt\/slides\/slide\d+\.xml$/.test(name) && data.toString("utf8").includes(`>${title}<`))![1];
  for (const title of ["Review", "Progress", "Risks"]) assert.ok(text(created.parts, title).equals(text(updated.parts, title)), title);
});

// openlore: scenario=SlidesAreReplacedRemovedAndMoved spec=openwebui-office-documents
test("SlidesAreReplacedRemovedAndMoved: by number or title, against the deck as it was", async (t) => {
  const { call } = await app(t);
  download(await call("create_presentation", DECK));
  const updated = download(
    await call("update_presentation", {
      file_name: "review",
      edits: [
        { action: "replace", slide: "Progress", content: { title: "Progress", mermaid: "flowchart LR\n  A[Build] --> B[Ship]" } },
        { action: "delete", slide: "1" },
        { action: "move", slide: "Risks", after: "0" },
      ],
    }),
  );
  assert.deepEqual(slideTitles(updated.bytes), ["Risks", "Progress"]);
  assert.equal([...updated.parts.keys()].filter((name) => name.startsWith("ppt/media/") && name.endsWith(".svg")).length, 1, "the Mermaid slide drawn");
});

// openlore: scenario=ASectionIsAddedToAKeptDocument spec=openwebui-office-documents
test("ASectionIsAddedToAKeptDocument: inserted, appended and rewritten by heading, the rest untouched", async (t) => {
  const { call } = await app(t);
  download(await call("create_document", { file_name: "notes", markdown: "# Notes\n\n## Plots\n\nPlot 4 is free.\n\n## Tools\n\nThe shed is open.\n" }));
  const updated = download(
    await call("update_document", {
      file_name: "notes.docx",
      edits: [
        { action: "replace", section: "Plots", markdown: "Plot 4 went to Sam." },
        { action: "insert_after", section: "Plots", markdown: "## Rota\n\n```mermaid\nflowchart LR\n  A[Fill] --> B[Water]\n```\n" },
        { action: "append", markdown: "## Next meeting\n\nIn June." },
      ],
    }),
  );
  assert.deepEqual(headingTexts(updated.parts), ["1 Notes", "2 Plots", "2 Rota", "2 Tools", "2 Next meeting"]);
  const body = updated.parts.get("word/document.xml")!.toString("utf8");
  assert.match(body, /Plot 4 went to Sam\./);
  assert.doesNotMatch(body, /Plot 4 is free\./);
  assert.match(body, /The shed is open\./, "the untouched section is kept");
  assert.doesNotMatch(body, /<w:ins\b/, "written straight in, not as tracked changes");
  assert.equal([...updated.parts.keys()].filter((name) => name.startsWith("word/media/") && name.endsWith(".svg")).length, 1, "the Mermaid diagram drawn");
  assert.deepEqual(updated.payload.outline.map((entry: { text: string }) => entry.text), ["Notes", "Plots", "Rota", "Tools", "Next meeting"]);
});

// openlore: scenario=AnUpdateOfAnUnknownFileIsRefused spec=openwebui-office-documents
test("AnUpdateOfAnUnknownFileIsRefused: with the names there are, or how to start one", async (t) => {
  const { call } = await app(t);
  const none = await call("update_presentation", { file_name: "review", edits: [{ action: "delete", slide: "1" }] });
  assert.equal(none.statusCode, 422);
  assert.match(none.json().error, /write it first with create_presentation/);
  download(await call("create_presentation", DECK));
  const wrong = await call("update_presentation", { file_name: "reviews", edits: [{ action: "delete", slide: "1" }] });
  assert.equal(wrong.statusCode, 422);
  assert.deepEqual(wrong.json().documents, ["review.pptx"]);
});

// openlore: scenario=ARefusedUpdateChangesNothing spec=openwebui-office-documents
test("ARefusedUpdateChangesNothing: a slide that does not exist, the kept deck untouched", async (t) => {
  const { call } = await app(t);
  const created = download(await call("create_presentation", DECK));
  const refused = await call("update_presentation", { file_name: "review", edits: [{ action: "insert_after", slide: "2", content: { title: "x" } }, { action: "delete", slide: "9" }] });
  assert.equal(refused.statusCode, 422);
  assert.match(refused.json().error, /no slide 9/);
  assert.match(refused.json().error, /1\. Review/, "the deck's slides listed");
  const listed = (await call("list_documents", {})).json();
  assert.deepEqual(listed.documents[0].slides.map((slide: { title: string }) => slide.title), ["Review", "Progress", "Risks"]);
  // Changing it now starts from the deck as created.
  const next = download(await call("update_presentation", { file_name: "review", edits: [{ action: "delete", slide: "3" }] }));
  assert.deepEqual(slideTitles(next.bytes), ["Review", "Progress"]);
  assert.ok(created.bytes.length > 0);
});

// openlore: scenario=DocumentsAreListed spec=openwebui-office-documents
test("DocumentsAreListed: each kept file with its slides or headings, the latest first", async (t) => {
  const { call } = await app(t);
  download(await call("create_document", { file_name: "notes", markdown: "# Notes\n\n## Plots\n\nx\n" }));
  download(await call("create_presentation", DECK));
  const listed = (await call("list_documents", {})).json();
  assert.deepEqual(
    listed.documents.map((document: { file_name: string; format: string }) => [document.file_name, document.format]),
    [["review.pptx", "powerpoint"], ["notes.docx", "word"]],
  );
  assert.deepEqual(listed.documents[0].slides, [{ number: 1, title: "Review" }, { number: 2, title: "Progress" }, { number: 3, title: "Risks" }]);
  assert.deepEqual(listed.documents[1].headings, ["# Notes", "## Plots"]);
});

// openlore: scenario=KeptDocumentsArePersonal spec=openwebui-office-documents
test("KeptDocumentsArePersonal: another user neither lists nor changes them", async (t) => {
  const { call } = await app(t);
  download(await call("create_presentation", DECK, "alice"));
  assert.deepEqual((await call("list_documents", {}, "bob")).json().documents, []);
  const refused = await call("update_presentation", { file_name: "review", edits: [{ action: "delete", slide: "1" }] }, "bob");
  assert.equal(refused.statusCode, 422);
  assert.equal((await call("list_documents", {}, "alice")).json().documents.length, 1);
});

// openlore: scenario=OldDocumentsAreDropped spec=openwebui-office-documents
test("OldDocumentsAreDropped: past the count the oldest goes, past the days every one does", async (t) => {
  const { call, config } = await app(t, { maxDocuments: 2, documentDays: 30 });
  for (const name of ["first", "second", "third"]) download(await call("create_presentation", { ...DECK, file_name: name }));
  assert.deepEqual((await call("list_documents", {})).json().documents.map((document: { file_name: string }) => document.file_name), ["third.pptx", "second.pptx"]);
  // Written 31 days ago: dropped on the next look.
  for (const file of (await filesUnder(config.dataDir)).filter((name) => name.endsWith(".json"))) {
    const full = path.join(config.dataDir, file);
    const meta = JSON.parse(await fs.readFile(full, "utf8"));
    await fs.writeFile(full, JSON.stringify({ ...meta, updated: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() }));
  }
  assert.deepEqual((await call("list_documents", {})).json().documents, []);
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

test("two updates at once both land: each starts from the other's result", async (t) => {
  const { call } = await app(t);
  download(await call("create_presentation", DECK));
  const [first, second] = await Promise.all([
    call("update_presentation", { file_name: "review", edits: [{ action: "insert_after", slide: "3", content: { title: "A" } }] }),
    call("update_presentation", { file_name: "review", edits: [{ action: "insert_after", slide: "3", content: { title: "B" } }] }),
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  const titles = (await call("list_documents", {})).json().documents[0].slides.map((slide: { title: string }) => slide.title);
  assert.equal(titles.length, 5);
  assert.ok(titles.includes("A") && titles.includes("B"), titles.join(", "));
});

// openlore: scenario=TheDocumentExamplesAreWritten spec=openwebui-planning-server
test("the update examples apply to the files the create examples write", async (t) => {
  const { call } = await app(t);
  download(await call("create_presentation", PRESENTATION_EXAMPLE));
  download(await call("create_document", DOCUMENT_EXAMPLE));
  const deck = download(await call("update_presentation", UPDATE_PRESENTATION_EXAMPLE));
  assert.deepEqual(slideTitles(deck.bytes), ["Allotment society", "This year", "New rules", "Harvest (kg)", "Watering rota"]);
  const document = download(await call("update_document", UPDATE_DOCUMENT_EXAMPLE));
  assert.deepEqual(headingTexts(document.parts).map((heading) => heading.slice(2)), ["Allotment society newsletter", "Plots", "Tools", "Watering rota", "Our badge", "Next meeting"]);
});
