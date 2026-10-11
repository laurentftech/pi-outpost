/**
 * create_document, create_presentation and list_templates: a Word or PowerPoint file
 * written from one call, handed back inside the embed, nothing stored, nothing fetched.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";
import { createMermaidRenderer } from "@pi-outpost/office/mermaidRender.ts";
import { figureForEnvelope } from "@pi-outpost/shared/structured-exchange/export";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { judgeStructure } from "@pi-outpost/apps-core/structure";
import { DOCUMENT_EXAMPLE, PRESENTATION_EXAMPLE } from "../src/openapi.ts";
import { SECRET, filesUnder, mintToken, tempDir, testApp } from "./helpers.ts";

const FIXTURES = fileURLToPath(new URL("../../server/test/fixtures/", import.meta.url));
const CONFORMANCE = fileURLToPath(new URL("../../shared/conformance/", import.meta.url));
const conformance = async (name: string) => JSON.parse(await fs.readFile(path.join(CONFORMANCE, name), "utf8"));

const canvas = createRequire(import.meta.url)("@napi-rs/canvas") as {
  createCanvas(width: number, height: number): {
    getContext(kind: "2d"): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
    encode(format: "png"): Promise<Buffer>;
  };
};

async function png(): Promise<Buffer> {
  const surface = canvas.createCanvas(30, 10);
  const context = surface.getContext("2d");
  context.fillStyle = "#2f5496";
  context.fillRect(0, 0, 30, 10);
  return surface.encode("png");
}

interface Download {
  mode: string;
  fileName: string;
  mediaType: string;
  size: number;
  data: string;
  outline: { level: number; text: string }[];
  figures: string[];
  template: string;
}

/** The download an embed carries, as the viewer inflates it. */
function downloadOf(response: { statusCode: number; headers: Record<string, unknown>; body: string }): { payload: Download; bytes: Buffer; parts: Map<string, Buffer> } {
  assert.equal(response.statusCode, 200, response.body.slice(0, 500));
  assert.match(String(response.headers["content-type"]), /^text\/html/);
  assert.ok(!response.body.includes("&"), "survives Open WebUI's storage");
  const match = /data-planning="([A-Za-z0-9+/=]*)"/.exec(response.body);
  assert.ok(match, "an embed payload");
  const payload = JSON.parse(gunzipSync(Buffer.from(match[1]!, "base64")).toString("utf8")) as Download;
  assert.equal(payload.mode, "download");
  const bytes = Buffer.from(payload.data, "base64");
  assert.equal(payload.size, bytes.length);
  return { payload, bytes, parts: readAllZipEntries(bytes, { maxEntries: 2000, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 }) };
}

const text = (parts: Map<string, Buffer>, name: string) => {
  const part = parts.get(name);
  assert.ok(part, `${name} is in the package`);
  return part.toString("utf8");
};

const media = (parts: Map<string, Buffer>, folder: string, extension: string) => [...parts.keys()].filter((name) => name.startsWith(folder) && name.endsWith(extension));

/** The text a picture's SVG shows, without its markup. */
const shown = (svg: string) => svg.replace(/<[^>]+>/g, "");

const mermaid = createMermaidRenderer();
after(() => mermaid.close());
const app = (t: Parameters<typeof testApp>[0], overrides: Parameters<typeof testApp>[1] = {}) => testApp(t, overrides, { mermaid });

async function templatesFolder(t: Parameters<typeof testApp>[0]): Promise<string> {
  const dir = await tempDir(t);
  await fs.copyFile(path.join(FIXTURES, "docx-template.dotx"), path.join(dir, "acme-report.dotx"));
  await fs.copyFile(path.join(FIXTURES, "pptx-template.potx"), path.join(dir, "acme-deck.potx"));
  return dir;
}

describe("create_document", () => {
  // openlore: scenario=AReportIsCreatedWithTheDefaultTemplate spec=openwebui-office-documents
  test("AReportIsCreatedWithTheDefaultTemplate: headings, list and table in the default styles, nothing stored", async (t) => {
    const { call, config } = await app(t);
    const response = await call("create_document", { file_name: "report", markdown: "# Report\n\nIntro.\n\n## Detail\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n" });
    const { payload, parts } = downloadOf(response);
    assert.equal(payload.fileName, "report.docx");
    assert.equal(payload.mediaType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.deepEqual(payload.outline, [{ level: 1, text: "Report" }, { level: 2, text: "Detail" }]);
    const body = text(parts, "word/document.xml");
    assert.match(body, /<w:pStyle w:val="Heading1"\/>[\s\S]*Report/);
    assert.match(body, /<w:pStyle w:val="Heading2"\/>[\s\S]*Detail/);
    assert.match(body, /<w:numPr>/);
    assert.match(body, /<w:tbl>/);
    assert.match(text(parts, "word/styles.xml"), /w:styleId="Heading1"/, "the default template's own styles");
    assert.deepEqual(await filesUnder(config.dataDir), []);
  });

  test("a file name is a name: a path is refused, the extension added once", async (t) => {
    const { call } = await app(t);
    assert.equal(downloadOf(await call("create_document", { file_name: "Q3 report.docx", markdown: "x" })).payload.fileName, "Q3 report.docx");
    for (const fileName of ["../evil", "a/b", "c:\\x", "", "deck.pptx"]) {
      const response = await call("create_document", { file_name: fileName, markdown: "x" });
      assert.equal(response.statusCode, 422, fileName);
      assert.doesNotMatch(response.body, /data-planning/);
    }
  });

  // openlore: scenario=AGraphBecomesAPictureInWord spec=openwebui-office-documents
  test("AGraphBecomesAPictureInWord: the figure show_structure draws, with a PNG behind it", async (t) => {
    const { call } = await app(t);
    const graph = await conformance("valid/graph-with-containers.json");
    const response = await call("create_document", { file_name: "g", markdown: `# Graph\n\nBefore.\n\n\`\`\`json\n${JSON.stringify(graph, null, 2)}\n\`\`\`\n\nAfter.\n` });
    const { parts, payload } = downloadOf(response);
    const svgs = media(parts, "word/media/", ".svg");
    const pngs = media(parts, "word/media/", ".png");
    assert.equal(svgs.length, 1);
    assert.equal(pngs.length, 1);
    const verdict = judgeStructure(graph);
    assert.ok(verdict.valid);
    const figure = figureForEnvelope(verdict.envelope);
    assert.ok(figure.ok);
    assert.equal(text(parts, svgs[0]!), figure.svg, "equal to the figure show_structure draws");
    assert.ok(parts.get(pngs[0]!)!.length > 500, "a PNG fallback that is not empty");
    const body = text(parts, "word/document.xml");
    assert.ok(body.indexOf("Before.") < body.indexOf("svgBlip") && body.indexOf("svgBlip") < body.indexOf("After."), "in that place");
    assert.doesNotMatch(body, /urn:structured-exchange/, "not written as code");
    assert.equal(payload.figures.length, 1);
  });

  // openlore: scenario=ATableDocumentBecomesANativeTable spec=openwebui-office-documents
  test("ATableDocumentBecomesANativeTable (Word): the document's rows, and no picture", async (t) => {
    const { call } = await app(t);
    const table = await conformance("valid/table-minimal.json");
    const { parts } = downloadOf(await call("create_document", { file_name: "t", markdown: `\`\`\`json\n${JSON.stringify(table)}\n\`\`\`\n` }));
    const body = text(parts, "word/document.xml");
    assert.match(body, /<w:tbl>/);
    for (const cell of ["left", "right", "a", "b", "c"]) assert.match(body, new RegExp(`<w:t[^>]*>${cell}</w:t>`));
    assert.deepEqual(media(parts, "word/media/", ""), []);
  });

  // openlore: scenario=OrdinaryJsonStaysCode spec=openwebui-office-documents
  test("OrdinaryJsonStaysCode", async (t) => {
    const { call } = await app(t);
    const { parts } = downloadOf(await call("create_document", { file_name: "j", markdown: '```json\n{"name": "plain"}\n```\n' }));
    // A code block: its line in a run of the monospace face the mapping writes listings in.
    assert.match(text(parts, "word/document.xml"), /<w:r>(?:(?!<\/w:r>)[\s\S])*w:ascii="Consolas[^"]*"(?:(?!<\/w:r>)[\s\S])*name(?:(?!<\/w:r>)[\s\S])*plain/);
    assert.deepEqual(media(parts, "word/media/", ""), []);
  });

  // openlore: scenario=MermaidDiagramIsDrawnInWord spec=openwebui-office-documents
  test("MermaidDiagramIsDrawnInWord: an SVG picture in place, a PNG behind it, equal to a fresh render", async (t) => {
    const { call } = await app(t);
    const source = "flowchart LR\n  A[Ask] --> B[Write]";
    const { parts, payload } = downloadOf(await call("create_document", { file_name: "m", markdown: `Before.\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nAfter.\n` }));
    const svgs = media(parts, "word/media/", ".svg");
    assert.equal(svgs.length, 1);
    assert.ok(parts.get(media(parts, "word/media/", ".png")[0]!)!.length > 500);
    // A fresh render of the same source, but for the id each render is given.
    const withoutRenderId = (svg: string) => svg.replace(/mermaid-\d+/g, "mermaid-N");
    assert.equal(withoutRenderId(text(parts, svgs[0]!)), withoutRenderId((await mermaid.render(source)).svg));
    const body = text(parts, "word/document.xml");
    assert.ok(body.indexOf("Before.") < body.indexOf("svgBlip") && body.indexOf("svgBlip") < body.indexOf("After."));
    assert.deepEqual(payload.figures, ["Mermaid diagram 1"]);
  });

  // openlore: scenario=AnInvalidMermaidRefusesTheCall spec=openwebui-office-documents
  test("AnInvalidMermaidRefusesTheCall: no embed, the fence's position and Mermaid's message", async (t) => {
    const { call } = await app(t);
    const response = await call("create_document", { file_name: "m", markdown: "```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nflowchart LR\n  A -->\n```\n" });
    assert.equal(response.statusCode, 422);
    assert.doesNotMatch(response.body, /data-planning/);
    const answer = response.json();
    assert.equal(answer.mermaid.length, 1);
    assert.equal(answer.mermaid[0].position, 2);
    assert.match(answer.mermaid[0].reason, /parse error/i);
    assert.match(answer.error, /Mermaid diagram 2/);
  });

  // openlore: scenario=ADataUriPictureIsEmbedded spec=openwebui-office-documents
  test("ADataUriPictureIsEmbedded: the PNG given, at that place, with its alt text", async (t) => {
    const { call } = await app(t);
    const picture = await png();
    const { parts } = downloadOf(await call("create_document", { file_name: "p", markdown: `Logo: ![logo](data:image/png;base64,${picture.toString("base64")})\n` }));
    const embedded = media(parts, "word/media/", "");
    assert.equal(embedded.length, 1);
    assert.ok(parts.get(embedded[0]!)!.equals(picture));
    assert.match(text(parts, "word/document.xml"), /descr="logo"/);
  });

  // openlore: scenario=AnUnsupportedPictureIsRefused spec=openwebui-office-documents
  test("AnUnsupportedPictureIsRefused (Word): an SVG, or bytes that are not the declared type", async (t) => {
    const { call } = await app(t);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>').toString("base64");
    const lying = (await png()).toString("base64");
    const response = await call("create_document", { file_name: "p", markdown: `![a](data:image/svg+xml;base64,${svg})\n\n![b](data:image/jpeg;base64,${lying})\n` });
    assert.equal(response.statusCode, 422);
    assert.doesNotMatch(response.body, /data-planning/);
    const { pictures } = response.json();
    assert.deepEqual(pictures.map((picture: { position: number }) => picture.position), [1, 2]);
    assert.match(pictures[0].reason, /SVG picture is not accepted/);
    assert.match(pictures[1].reason, /declared image\/jpeg but its bytes are PNG/);
  });

  test("a picture over OUTPOST_MAX_IMAGE_BYTES is refused", async (t) => {
    const picture = await png();
    const { call } = await app(t, { maxImageBytes: picture.length - 1 });
    const response = await call("create_document", { file_name: "p", markdown: `![a](data:image/png;base64,${picture.toString("base64")})\n` });
    assert.equal(response.statusCode, 422);
    assert.match(response.json().pictures[0].reason, /over the limit/);
  });

  // openlore: scenario=AURLPictureIsNotFetched spec=openwebui-office-documents
  test("AURLPictureIsNotFetched: no request made, the picture named, its bytes asked for", async (t) => {
    const { createServer } = await import("node:http");
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const port = (server.address() as { port: number }).port;
    const { call } = await app(t);
    const response = await call("create_document", { file_name: "u", markdown: `![x](http://127.0.0.1:${port}/a.png)\n` });
    assert.equal(response.statusCode, 422);
    assert.doesNotMatch(response.body, /data-planning/);
    assert.equal(response.json().pictures[0].position, 1);
    assert.match(response.json().pictures[0].reason, /give the picture's bytes as a data: URI/);
    assert.equal(requests, 0);
  });

  // openlore: scenario=ARefusedDiagramRefusesTheDocument spec=openwebui-office-documents
  test("ARefusedDiagramRefusesTheDocument: the second diagram named, show_structure's issues, a guide topic", async (t) => {
    const { call } = await app(t);
    const good = await conformance("valid/graph-minimal.json");
    // As a model writes it: checked out on Windows, the file has CRLF line endings.
    const badText = (await fs.readFile(path.join(CONFORMANCE, "invalid/unresolved-endpoint.json"), "utf8")).replace(/\r\n/g, "\n");
    const response = await call("create_document", { file_name: "d", markdown: `\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\n\n\`\`\`json\n${badText}\n\`\`\`\n` });
    assert.equal(response.statusCode, 422);
    assert.doesNotMatch(response.body, /data-planning/);
    const answer = response.json();
    assert.equal(answer.diagrams.length, 1);
    assert.equal(answer.diagrams[0].position, 2);
    const expected = parseSerializedStructuredExchange(JSON.stringify(JSON.parse(badText)), checkStructuredExchangeSchema);
    assert.equal(expected.valid, false);
    assert.deepEqual(answer.diagrams[0].issues, expected.issues);
    assert.equal(typeof answer.diagrams[0].guide, "string");
    assert.match(answer.error, /diagram 2/);
    assert.match(answer.error, /read_structure_guide with topic/);
  });

  // openlore: scenario=ATooLargeResultIsRefused spec=openwebui-office-documents
  test("ATooLargeResultIsRefused: the limit and the size", async (t) => {
    const { call } = await app(t, { maxFileBytes: 1000 });
    const response = await call("create_document", { file_name: "big", markdown: "# Big\n\n" + "Lorem ipsum dolor sit amet. ".repeat(50) });
    assert.equal(response.statusCode, 422);
    assert.doesNotMatch(response.body, /data-planning/);
    assert.equal(response.json().limit, 1000);
    assert.ok(response.json().size > 1000);
  });

  // openlore: scenario=AnAdministratorTemplateIsUsed spec=openwebui-office-documents
  test("AnAdministratorTemplateIsUsed: the template's own heading style", async (t) => {
    const { call } = await app(t, { templatesDir: await templatesFolder(t) });
    const { parts, payload } = downloadOf(await call("create_document", { file_name: "r", markdown: "# Heading\n\nText.\n", template: "acme-report.dotx" }));
    assert.match(text(parts, "word/document.xml"), /<w:pStyle w:val="Titre1"\/>/, "the French template's heading 1 style id");
    assert.equal(payload.template, "acme-report.dotx");
  });

  // openlore: scenario=APathIsNotATemplateName spec=openwebui-office-documents
  test("APathIsNotATemplateName: refused with the names offered, nothing read outside", async (t) => {
    const parent = await tempDir(t);
    const dir = path.join(parent, "templates");
    await fs.mkdir(path.join(dir, "sub"), { recursive: true });
    await fs.copyFile(path.join(FIXTURES, "docx-template.dotx"), path.join(dir, "acme-report.dotx"));
    await fs.copyFile(path.join(FIXTURES, "docx-template.dotx"), path.join(dir, "sub", "acme.dotx"));
    // Beside the folder: what a path would reach if it were followed.
    await fs.writeFile(path.join(parent, "config.json"), '{"secret": "OUTSIDE-THE-FOLDER"}');
    const { call } = await app(t, { templatesDir: dir });
    for (const template of ["../config.json", "sub/acme.dotx", "sub\\acme.dotx", "missing.dotx"]) {
      const response = await call("create_document", { file_name: "r", markdown: "x", template });
      assert.equal(response.statusCode, 422, template);
      assert.deepEqual(response.json().templates, ["acme-report.dotx"], template);
      assert.doesNotMatch(response.body, /OUTSIDE-THE-FOLDER/, template);
    }
  });

  test("no templates folder: a named template is refused, saying to leave it out", async (t) => {
    const { call } = await app(t);
    const response = await call("create_document", { file_name: "r", markdown: "x", template: "acme.dotx" });
    assert.equal(response.statusCode, 422);
    assert.match(response.json().error, /leave template out/);
  });
});

describe("create_presentation", () => {
  // openlore: scenario=ADeckIsCreatedWithTheDefaultTemplate spec=openwebui-office-documents
  test("ADeckIsCreatedWithTheDefaultTemplate: four slides in order, with their content", async (t) => {
    const { call, config } = await app(t);
    const response = await call("create_presentation", {
      file_name: "deck",
      slides: [
        { title: "Review", subtitle: "October" },
        { title: "Points", bullets: ["one", "two"] },
        { title: "Table", table: { rows: [["h1", "h2"], ["v1", "v2"]] } },
        { title: "Chart", chart: { type: "column", categories: ["Q1", "Q2"], series: [{ name: "Sales", values: [1, 2] }] } },
      ],
    });
    const { parts, payload } = downloadOf(response);
    assert.equal(payload.fileName, "deck.pptx");
    assert.deepEqual(payload.outline.map((entry) => entry.text), ["Review", "Points", "Table", "Chart"]);
    const slides = [1, 2, 3, 4].map((n) => text(parts, `ppt/slides/slide${n}.xml`));
    assert.match(slides[0]!, /Review[\s\S]*October|October[\s\S]*Review/);
    assert.match(slides[1]!, /one[\s\S]*two/);
    assert.match(slides[2]!, /<a:tbl>[\s\S]*v2/);
    assert.match(slides[3]!, /<c:chart\b/);
    assert.ok(!parts.has("ppt/slides/slide5.xml"));
    assert.deepEqual(await filesUnder(config.dataDir), []);
  });

  // openlore: scenario=ASequenceBecomesASlidePicture spec=openwebui-office-documents
  test("ASequenceBecomesASlidePicture: the sequence's figure, with a PNG fallback", async (t) => {
    const { call } = await app(t);
    const sequence = await conformance("valid/sequence-ordered.json");
    const { parts } = downloadOf(await call("create_presentation", { file_name: "s", slides: [{ title: "Flow", diagram: sequence }] }));
    const svgs = media(parts, "ppt/media/", ".svg");
    assert.equal(svgs.length, 1);
    const verdict = judgeStructure(sequence);
    assert.ok(verdict.valid);
    const figure = figureForEnvelope(verdict.envelope);
    assert.ok(figure.ok);
    assert.equal(text(parts, svgs[0]!), figure.svg);
    assert.equal(media(parts, "ppt/media/", ".png").length, 1);
    assert.match(text(parts, "ppt/slides/slide1.xml"), /svgBlip/);
  });

  // openlore: scenario=ATableDocumentBecomesANativeTable spec=openwebui-office-documents
  test("ATableDocumentBecomesANativeTable (PowerPoint): the document's rows in a native table", async (t) => {
    const { call } = await app(t);
    const table = await conformance("valid/table-minimal.json");
    const { parts } = downloadOf(await call("create_presentation", { file_name: "t", slides: [{ title: "Rows", diagram: table }] }));
    const slide = text(parts, "ppt/slides/slide1.xml");
    assert.match(slide, /<a:tbl>/);
    for (const cell of ["left", "right", "a", "b", "c"]) assert.match(slide, new RegExp(`<a:t>${cell}</a:t>`));
    assert.deepEqual(media(parts, "ppt/media/", ""), []);
  });

  // openlore: scenario=MermaidDiagramIsDrawnOnASlide spec=openwebui-office-documents
  test("MermaidDiagramIsDrawnOnASlide: an SVG picture with a PNG fallback, labelled with the messages", async (t) => {
    const { call } = await app(t);
    const { parts } = downloadOf(
      await call("create_presentation", { file_name: "m", slides: [{ title: "Flow", mermaid: "sequenceDiagram\n  Alice->>Bob: Hello there\n  Bob-->>Alice: Fine thanks" }] }),
    );
    const svgs = media(parts, "ppt/media/", ".svg");
    assert.equal(svgs.length, 1);
    assert.ok(parts.get(media(parts, "ppt/media/", ".png")[0]!)!.length > 500);
    const labels = shown(text(parts, svgs[0]!));
    assert.match(labels, /Hello there/);
    assert.match(labels, /Fine thanks/);
  });

  test("an invalid Mermaid slide refuses the deck, naming the slide", async (t) => {
    const { call } = await app(t);
    const response = await call("create_presentation", { file_name: "m", slides: [{ title: "ok" }, { title: "Flow", mermaid: "flowchart LR\n  A -->" }] });
    assert.equal(response.statusCode, 422);
    assert.match(response.json().error, /slide 2: Mermaid could not draw the diagram/);
  });

  test("AnUnsupportedPictureIsRefused (PowerPoint): an SVG image is refused, a PNG one embedded", async (t) => {
    const { call } = await app(t);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>').toString("base64");
    const refused = await call("create_presentation", { file_name: "p", slides: [{ title: "Logo", image: { data: `data:image/svg+xml;base64,${svg}` } }] });
    assert.equal(refused.statusCode, 422);
    assert.match(refused.json().error, /slide 1: picture: an SVG picture is not accepted/);
    const picture = await png();
    const { parts } = downloadOf(await call("create_presentation", { file_name: "p", slides: [{ title: "Logo", image: { data: `data:image/png;base64,${picture.toString("base64")}`, alt: "logo" } }] }));
    assert.ok(parts.get(media(parts, "ppt/media/", ".png")[0]!)!.equals(picture));
  });

  test("a slide with two visuals is refused, saying which", async (t) => {
    const { call } = await app(t);
    const response = await call("create_presentation", { file_name: "x", slides: [{ title: "Two", table: { rows: [["a"]] }, mermaid: "flowchart LR\n  A --> B" }] });
    assert.equal(response.statusCode, 422);
    assert.match(response.json().error, /slide 1: a slide holds one of/);
  });

  // openlore: scenario=AWordTemplateIsRefusedForADeck spec=openwebui-office-documents
  test("AWordTemplateIsRefusedForADeck", async (t) => {
    const { call } = await app(t, { templatesDir: await templatesFolder(t) });
    const response = await call("create_presentation", { file_name: "d", slides: [{ title: "x" }], template: "acme-report.dotx" });
    assert.equal(response.statusCode, 422);
    assert.match(response.json().error, /is a Word template/);
    assert.deepEqual(response.json().templates, ["acme-deck.potx"]);
  });

  test("an administrator's PowerPoint template is used", async (t) => {
    const { call } = await app(t, { templatesDir: await templatesFolder(t) });
    const { payload } = downloadOf(await call("create_presentation", { file_name: "d", slides: [{ title: "x" }], template: "acme-deck.potx" }));
    assert.equal(payload.template, "acme-deck.potx");
  });
});

describe("list_templates", () => {
  // openlore: scenario=TemplatesAreListed spec=openwebui-office-documents
  test("TemplatesAreListed: each with its format, Word with its styles, PowerPoint with its layouts", async (t) => {
    const dir = await templatesFolder(t);
    await fs.writeFile(path.join(dir, "notes.txt"), "not a template");
    const { call } = await app(t, { templatesDir: dir });
    const response = await call("list_templates", {});
    assert.equal(response.statusCode, 200);
    const { templates } = response.json();
    assert.deepEqual(templates.map((template: { name: string; format: string }) => [template.name, template.format]), [["acme-deck.potx", "powerpoint"], ["acme-report.dotx", "word"]]);
    const word = templates.find((template: { format: string }) => template.format === "word");
    assert.ok(word.styles.some((style: string) => /heading 1/.test(style)));
    const deck = templates.find((template: { format: string }) => template.format === "powerpoint");
    assert.match(deck.layouts, /Layout name/);
  });

  test("with no folder, says to leave template out", async (t) => {
    const { call } = await app(t);
    const response = await call("list_templates", {});
    assert.deepEqual(response.json().templates, []);
    assert.match(response.json().how, /leave template out/);
  });
});

// openlore: scenario=AnUnsignedCallIsRefused spec=openwebui-office-documents
test("AnUnsignedCallIsRefused: without the bearer key or a valid identity, before the body is read", async (t) => {
  const { app: server } = await app(t);
  const body = { file_name: "x", markdown: "# x" };
  for (const tool of ["create_document", "create_presentation", "list_templates"]) {
    const noKey = await server.inject({ method: "POST", url: `/${tool}`, headers: { "x-openwebui-user-jwt": mintToken("alice") }, payload: body });
    assert.equal(noKey.statusCode, 401, tool);
    const noIdentity = await server.inject({ method: "POST", url: `/${tool}`, headers: { authorization: `Bearer ${SECRET}` }, payload: body });
    assert.equal(noIdentity.statusCode, 401, tool);
    const forged = await server.inject({ method: "POST", url: `/${tool}`, headers: { authorization: `Bearer ${SECRET}`, "x-openwebui-user-jwt": mintToken("alice", { key: "wrong-key-0123456789abcdef0123456789abcd" }) }, payload: body });
    assert.equal(forged.statusCode, 401, tool);
  }
});

// openlore: scenario=TheDocumentExamplesAreWritten spec=openwebui-planning-server
test("TheDocumentExamplesAreWritten: each description's example writes its file", async (t) => {
  const { call } = await app(t);
  const document = downloadOf(await call("create_document", DOCUMENT_EXAMPLE));
  assert.equal(media(document.parts, "word/media/", ".svg").length, 1, "the Mermaid diagram drawn");
  assert.equal(document.payload.figures.length, 1);
  assert.match(text(document.parts, "word/document.xml"), /descr="Company logo"/, "the picture embedded");
  const deck = downloadOf(await call("create_presentation", PRESENTATION_EXAMPLE));
  assert.equal(deck.payload.outline.length, PRESENTATION_EXAMPLE.slides.length);
  assert.equal(media(deck.parts, "ppt/media/", ".svg").length, 1, "the Mermaid slide drawn");
});
