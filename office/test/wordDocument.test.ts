import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readAllZipEntries } from "../src/zip.ts";
import { createDocument } from "../src/docxBuild.ts";
import { describeWordTemplate, readWordPackage } from "../src/docxTemplate.ts";
import { defaultWordTemplateBytes } from "../src/defaultWordTemplate.ts";
import { callPictures, DEFAULT_MAX_IMAGE_BYTES } from "../src/callPictures.ts";
import { createMermaidRenderer } from "../src/mermaidRender.ts";

const require = createRequire(import.meta.url);
const canvas = require("@napi-rs/canvas") as {
  createCanvas(width: number, height: number): {
    getContext(kind: "2d"): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
    encode(format: "png" | "jpeg"): Promise<Buffer>;
  };
};

/** A real picture: a 40×20 blue rectangle. */
async function picture(format: "png" | "jpeg" = "png"): Promise<Buffer> {
  const surface = canvas.createCanvas(40, 20);
  const context = surface.getContext("2d");
  context.fillStyle = "#2f5496";
  context.fillRect(0, 0, 40, 20);
  return surface.encode(format);
}

const dataUri = (mediaType: string, bytes: Buffer) => `data:${mediaType};base64,${bytes.toString("base64")}`;

function partsOf(bytes: Buffer): Map<string, Buffer> {
  return readAllZipEntries(bytes, { maxEntries: 1000, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
}

function body(parts: Map<string, Buffer>): string {
  return parts.get("word/document.xml")!.toString("utf8");
}

const template = () => readWordPackage(defaultWordTemplateBytes());

describe("the default Word template", () => {
  test("offers a title, headings, a list style and a table style", () => {
    const description = describeWordTemplate(template());
    for (const level of [1, 2, 3]) assert.equal(description.roles.find((role) => role.role === `heading ${level}`)?.style?.name, `heading ${level}`);
    assert.equal(description.roles.find((role) => role.role === "list")?.style?.name, "List Paragraph");
    assert.ok(description.tableStyles.some((style) => style.name === "Table Grid"));
    assert.ok(template().styles.has("Title"));
    assert.equal(description.features.sampleParagraphs, 0, "nothing to delete before writing");
  });

  test("writes headings, a bullet list and a table in its styles", async () => {
    const { bytes, warnings } = await createDocument(template(), "# Report\n\nIntro.\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
    const xml = body(partsOf(bytes));
    assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
    assert.match(xml, /<w:numPr>/, "the list is numbered as a list");
    assert.match(xml, /<w:tbl>/);
    assert.deepEqual(warnings, []);
  });
});

describe("pictures and Mermaid given in the call", () => {
  const mermaid = createMermaidRenderer();
  after(() => mermaid.close());

  test("MermaidDiagramIsDrawnInWord: a fence becomes an SVG picture with a PNG behind it", async () => {
    const pictures = callPictures({ mermaid });
    const source = "flowchart LR\n  A[Ask] --> B[Write]";
    const { bytes } = await createDocument(template(), `# Flow\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, { pictures: pictures.source });
    assert.deepEqual(pictures.refusals(), []);
    const parts = partsOf(bytes);
    const svgs = [...parts.keys()].filter((name) => name.startsWith("word/media/") && name.endsWith(".svg"));
    const pngs = [...parts.keys()].filter((name) => name.startsWith("word/media/") && name.endsWith(".png"));
    assert.equal(svgs.length, 1);
    assert.equal(pngs.length, 1);
    assert.match(body(parts), /svgBlip/, "the picture carries the SVG extension Word 2016+ draws");
    assert.doesNotMatch(body(parts), /flowchart LR/, "the source is not written as code");
    // The vector is what a fresh render of the same source draws, but for the id each
    // render is given.
    const fresh = await mermaid.render(source);
    const withoutRenderId = (svg: string) => svg.replace(/mermaid-\d+/g, "mermaid-N");
    assert.equal(withoutRenderId(parts.get(svgs[0])!.toString("utf8")), withoutRenderId(fresh.svg));
  });

  test("AnInvalidMermaidRefusesTheCall: the fence's position and Mermaid's message", async () => {
    const pictures = callPictures({ mermaid });
    await createDocument(template(), "```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nflowchart LR\n  A -->\n```\n", { pictures: pictures.source });
    const refusals = pictures.refusals();
    assert.equal(refusals.length, 1);
    assert.equal(refusals[0].kind, "mermaid");
    assert.equal(refusals[0].position, 2);
    assert.match(refusals[0].reason, /parse error/i);
  });

  test("ADataUriPictureIsEmbedded: the PNG given is the PNG in the file", async () => {
    const png = await picture();
    const pictures = callPictures();
    const { bytes } = await createDocument(template(), `Logo: ![the logo](${dataUri("image/png", png)})\n`, { pictures: pictures.source });
    assert.deepEqual(pictures.refusals(), []);
    const parts = partsOf(bytes);
    const media = [...parts.entries()].filter(([name]) => name.startsWith("word/media/"));
    assert.equal(media.length, 1);
    assert.ok(media[0][1].equals(png), "embedded as given");
    assert.match(body(parts), /descr="the logo"/);
  });

  test("a JPEG is embedded too", async () => {
    const pictures = callPictures();
    await createDocument(template(), `![photo](${dataUri("image/jpeg", await picture("jpeg"))})\n`, { pictures: pictures.source });
    assert.deepEqual(pictures.refusals(), []);
  });

  test("AnUnsupportedPictureIsRefused: SVG, a lying media type, bad base64, oversize", async () => {
    const png = await picture();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const markdown = [
      `![svg](${dataUri("image/svg+xml", svg)})`,
      `![lie](${dataUri("image/jpeg", png)})`,
      "![junk](data:image/png;base64,@@@@)",
      "![plain](data:image/png,notbase64)",
    ].join("\n\n");
    const pictures = callPictures();
    await createDocument(template(), markdown, { pictures: pictures.source });
    const reasons = pictures.refusals().map((refusal) => `${refusal.position}: ${refusal.reason}`);
    assert.equal(reasons.length, 4, reasons.join("\n"));
    assert.match(reasons[0], /^1: an SVG picture is not accepted/);
    assert.match(reasons[1], /^2: .*declared image\/jpeg but its bytes are PNG/);
    assert.match(reasons[2], /^3: .*characters base64 does not use/);
    assert.match(reasons[3], /^4: .*not base64/);

    const small = callPictures({ maxImageBytes: png.length - 1 });
    await createDocument(template(), `![big](${dataUri("image/png", png)})\n`, { pictures: small.source });
    assert.match(small.refusals()[0]?.reason ?? "", new RegExp(`it is ${png.length} bytes, over the limit of ${png.length - 1}`));
  });

  test("AURLPictureIsNotFetched: refused without a request", async () => {
    const pictures = callPictures();
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      fetched.push(String(input));
      throw new Error("no network in this test");
    }) as typeof fetch;
    try {
      await createDocument(template(), "![x](https://example.com/a.png)\n", { pictures: pictures.source });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(fetched, []);
    const [refusal] = pictures.refusals();
    assert.equal(refusal.kind, "picture");
    assert.match(refusal.reason, /is not fetched: give the picture's bytes as a data: URI/);
  });

  test("the default limit is one megabyte", () => {
    assert.equal(DEFAULT_MAX_IMAGE_BYTES, 1024 * 1024);
  });
});
