/**
 * Reading a Word template, and writing Markdown into it.
 *
 * `fixtures/docx-template.dotx` is a template as a French Word install writes one: heading
 * styles with localized ids (`Titre1`) and built-in English names (`heading 1`), numbered
 * by a numbering definition of its own; a cover page and a table of contents as content
 * controls; a header, a footer and custom margins; sample text with a picture nothing
 * else uses. See make-docx-template.mjs.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { createDocument } from "../src/docxBuild.ts";
import { describeWordTemplate, formatTemplateDescription, readWordPackage, WordTemplateError } from "../src/docxTemplate.ts";
import { withUpdateFields } from "../src/docxGraft.ts";
import { readAllZipEntries } from "../src/zip.ts";
import { writeZip } from "../src/zipWriter.ts";
import { bodyLayout } from "../src/wordml.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const templateBytes = await readFile(path.join(FIXTURES, "docx-template.dotx"));
const template = () => readWordPackage(templateBytes);

function unzip(bytes: Uint8Array): Map<string, Buffer> {
  return readAllZipEntries(Buffer.from(bytes), { maxEntries: 4096, maxInflatedBytes: 1e8, maxTotalBytes: 1e9 });
}

/** Prefixes used on an element or attribute with no declaration in scope. */
function undeclaredPrefixes(xml: string): string[] {
  const scopes: Array<Set<string>> = [new Set(["xml"])];
  const missing = new Set<string>();
  for (const [, closing, name, attributes, selfClosing] of xml.matchAll(/<(\/?)([\w.-]+(?::[\w.-]+)?)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    if (closing) {
      scopes.pop();
      continue;
    }
    const scope = new Set(scopes[scopes.length - 1]);
    for (const [, prefix] of attributes.matchAll(/\sxmlns:([\w.-]+)\s*=/g)) scope.add(prefix);
    const used = [name, ...[...attributes.matchAll(/\s([^\s=]+)\s*=/g)].map((match) => match[1])]
      .filter((qualified) => qualified.includes(":") && !qualified.startsWith("xmlns:"))
      .map((qualified) => qualified.slice(0, qualified.indexOf(":")));
    for (const prefix of used) if (!scope.has(prefix)) missing.add(prefix);
    if (!selfClosing) scopes.push(scope);
  }
  return [...missing];
}

function text(parts: Map<string, Buffer>, name: string): string {
  const part = parts.get(name);
  assert.ok(part, `${name} is in the package`);
  return part.toString("utf8");
}

/** A 1×1 PNG. */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 1, 2, 3]))), chunk("IEND", Buffer.alloc(0))]);
}

describe("docx_styles: what a template offers", () => {
  test("StylesAreReportedByRole: headings by name under localized ids, with their numbering", () => {
    const description = describeWordTemplate(template());
    const heading = (level: number) => description.roles.find((role) => role.role === `heading ${level}`)!;
    assert.deepEqual(heading(1).style, { id: "Titre1", name: "heading 1" });
    assert.equal(heading(1).numbered, true);
    assert.deepEqual(heading(2).style, { id: "Titre2", name: "heading 2" });
    assert.equal(heading(2).numbered, true);
    assert.deepEqual(heading(3).style, { id: "Titre3", name: "heading 3" });
    assert.equal(heading(3).numbered, false);
    // No heading 4 in the template: reported absent, not guessed.
    assert.equal(heading(4).style, undefined);
    assert.deepEqual(description.roles.find((role) => role.role === "list")?.style, { id: "Paragraphedeliste", name: "List Paragraph" });
    assert.deepEqual(description.roles.find((role) => role.role === "body text")?.style, { id: "Normal", name: "Normal" });
    assert.deepEqual(description.tableStyles.map((style) => style.name), ["Normal Table", "Table Grid"]);
    const shown = formatTemplateDescription(description);
    assert.match(shown, /heading 1: "heading 1" \(id Titre1\), numbered by the template/);
  });

  test("TemplateFeaturesAreReported: cover page, header, footer and table of contents", () => {
    const { features } = describeWordTemplate(template());
    assert.deepEqual(features, { cover: true, tableOfContents: true, headers: true, footers: true, sampleParagraphs: 4 });
    assert.match(formatTemplateDescription(describeWordTemplate(template())), /keep: \["cover", "toc"\]/);
  });

  test("AnUnusableWordTemplateIsRefusedWithItsReason", async () => {
    const refuse = (bytes: Uint8Array, reason: RegExp) => assert.throws(() => readWordPackage(bytes), (error: unknown) => error instanceof WordTemplateError && reason.test(error.message));
    refuse(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), /password-protected or a legacy \.doc\/\.dot/);
    refuse(Buffer.from("not a zip at all"), /cannot be read/);
    refuse(await readFile(path.join(FIXTURES, "pptx-template.potx")), /not a Word document/);
    const parts = unzip(templateBytes);
    const macro = new Map(parts);
    macro.set(
      "[Content_Types].xml",
      Buffer.from(
        text(parts, "[Content_Types].xml").replace(
          /(<Override PartName="\/word\/document\.xml" ContentType=")[^"]*"/,
          '$1application/vnd.ms-word.template.macroEnabledTemplate.main+xml"',
        ),
      ),
    );
    refuse(writeZip([...macro].map(([name, data]) => ({ name, data }))), /macro-enabled/);
    const doctype = new Map(parts);
    doctype.set("word/document.xml", Buffer.from(text(parts, "word/document.xml").replace("<w:document", '<!DOCTYPE w [<!ENTITY a "b">]><w:document')));
    refuse(writeZip([...doctype].map(([name, data]) => ({ name, data }))), /damaged: .*DOCTYPE/);
  });
});

describe("docx_create: Markdown written into a template", () => {
  test("ContentWearsTheTemplatesStyles: headings take the template's ids, found by name", async () => {
    const created = await createDocument(template(), "# Introduction\n\nBody text.\n\n## Scope\n\n#### Deep\n");
    const parts = unzip(created.bytes);
    const document = text(parts, "word/document.xml");
    assert.match(document, /<w:pStyle w:val="Titre1"\/><\/w:pPr><w:r>(?:(?!<\/w:p>).)*Introduction/);
    assert.match(document, /<w:pStyle w:val="Titre2"\/>(?:(?!<\/w:p>).)*Scope/);
    assert.doesNotMatch(document, /w:val="Heading1"|w:val="Heading2"/);
    // The template's style definitions are the document's — its heading 1 is still its own.
    const styles = text(parts, "word/styles.xml");
    assert.ok(styles.includes(text(unzip(templateBytes), "word/styles.xml").match(/<w:style w:type="paragraph" w:styleId="Titre1">[\s\S]*?<\/w:style>/)![0]));
    // A heading level the template lacks is added under the writer's name, not replaced.
    assert.match(document, /w:val="Heading4"/);
    assert.match(styles, /<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="Heading 4"\/>[\s\S]*?<w:outlineLvl w:val="3"\/>/);
  });

  test("HeadersFootersAndPageSetupAreKept: the template's final section ends the new body", async () => {
    const created = await createDocument(template(), "Just a paragraph.");
    const parts = unzip(created.bytes);
    const document = text(parts, "word/document.xml");
    const sectPr = bodyLayout(document).sectPr?.xml ?? "";
    assert.match(sectPr, /<w:headerReference w:type="default" r:id="rIdHeader"\/>/);
    assert.match(sectPr, /<w:footerReference w:type="default" r:id="rIdFooter"\/>/);
    assert.match(sectPr, /<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701"/);
    assert.equal(text(parts, "word/header1.xml"), text(unzip(templateBytes), "word/header1.xml"));
    assert.match(text(parts, "word/_rels/document.xml.rels"), /Id="rIdHeader"[^>]*Target="header1.xml"/);
  });

  test("SampleBodyIsDropped: no sample text, and what only it used is gone", async () => {
    const created = await createDocument(template(), "# Report\n\nOur text.");
    const parts = unzip(created.bytes);
    const document = text(parts, "word/document.xml");
    for (const sample of ["Remplacez ce texte", "Encore du texte", "Titre de section", "Rapport annuel", "Sommaire"]) {
      assert.ok(!document.includes(sample), sample);
    }
    assert.equal(parts.has("word/media/exemple.png"), false, "the sample's picture is swept");
    assert.doesNotMatch(text(parts, "word/_rels/document.xml.rels"), /rIdSample/);
    assert.doesNotMatch(text(parts, "[Content_Types].xml"), /exemple\.png/);
  });

  test("CoverAndTableOfContentsAreKeptOnRequest: both precede the content, and fields refresh on open", async () => {
    const created = await createDocument(template(), "# Report\n\nOur text.", { keep: ["cover", "toc"] });
    const parts = unzip(created.bytes);
    const children = bodyLayout(text(parts, "word/document.xml")).children;
    assert.match(children[0].xml, /docPartGallery w:val="Cover Pages"/);
    assert.match(children[1].xml, /docPartGallery w:val="Table of Contents"/);
    assert.match(children[2].xml, /Report/);
    const settings = text(parts, "word/settings.xml");
    // Placed where CT_Settings puts it: after characterSpacingControl, before compat.
    assert.match(settings, /<w:characterSpacingControl w:val="doNotCompress"\/><w:updateFields w:val="true"\/><w:compat>/);
    // Without keep, neither is carried and settings are left alone.
    const plain = unzip((await createDocument(template(), "# Report")).bytes);
    assert.doesNotMatch(text(plain, "word/document.xml"), /Cover Pages|Table of Contents/);
    assert.equal(text(plain, "word/settings.xml"), text(unzip(templateBytes), "word/settings.xml"));
    assert.deepEqual((await createDocument(readWordPackage(await readFile(path.join(FIXTURES, "docx-report.docx")), "d"), "x", { keep: ["cover"] })).warnings, [
      "the template has no cover page to keep",
    ]);
  });

  test("updateFields goes before the first settings child the schema puts after it", () => {
    assert.equal(withUpdateFields('<w:settings xmlns:w="w"><w:zoom/><w:rsids/></w:settings>'), '<w:settings xmlns:w="w"><w:zoom/><w:updateFields w:val="true"/><w:rsids/></w:settings>');
    assert.equal(withUpdateFields('<w:settings xmlns:w="w"><w:zoom/></w:settings>'), '<w:settings xmlns:w="w"><w:zoom/><w:updateFields w:val="true"/></w:settings>');
  });

  test("ListsImagesAndTablesSurviveTheGraft: numbering coexists, the picture resolves", async () => {
    const picture = png();
    const created = await createDocument(template(), "1. one\n2. two\n\n- bullet\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![chart](chart.png)\n\n[a link](https://example.com)\n", {
      pictures: { imageKey: (src) => src, loadImage: async () => ({ kind: "raster", type: "png", bytes: new Uint8Array(picture), width: 1, height: 1 }) },
    });
    const parts = unzip(created.bytes);
    const document = text(parts, "word/document.xml");
    const numbering = text(parts, "word/numbering.xml");
    // The template's own definitions are untouched and first.
    const original = text(unzip(templateBytes), "word/numbering.xml");
    assert.ok(numbering.includes(original.match(/<w:abstractNum w:abstractNumId="0">[\s\S]*?<\/w:abstractNum>/)![0]));
    assert.match(numbering, /<w:num w:numId="1"><w:abstractNumId w:val="0"\/><\/w:num>/);
    // The content's lists use ids past the template's, each defined.
    const used = [...new Set([...document.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((match) => match[1]))];
    assert.ok(used.length >= 2 && used.every((id) => Number(id) > 1), `list ids ${used}`);
    for (const id of used) assert.match(numbering, new RegExp(`<w:num w:numId="${id}"><w:abstractNumId w:val="\\d+"`));
    // abstractNum elements come before every num, as the schema requires.
    assert.ok(numbering.lastIndexOf("<w:abstractNum ") < numbering.indexOf("<w:num "));
    assert.doesNotMatch(numbering, /w15:restartNumberingAfterBreak/);
    assert.match(document, /<w:tbl>/);
    const embed = /r:embed="([^"]+)"/.exec(document)![1];
    const rel = new RegExp(`Id="${embed}"[^>]*Target="([^"]+)"`).exec(text(parts, "word/_rels/document.xml.rels"))![1];
    assert.ok(parts.get(`word/${rel}`)?.equals(picture), "the picture's relationship reaches its bytes");
    assert.match(text(parts, "[Content_Types].xml"), /Extension="png"/);
    assert.match(text(parts, "word/_rels/document.xml.rels"), /Target="https:\/\/example\.com" TargetMode="External"/);
    // Every namespace prefix is declared where it is used: on the element or one of
    // its ancestors (the graft declares the body's on the root; a picture carries its own).
    assert.deepEqual(undeclaredPrefixes(document), []);
  });

  test("ATemplateBecomesADocument: the main part is retyped", async () => {
    const parts = unzip((await createDocument(template(), "Text")).bytes);
    const types = text(parts, "[Content_Types].xml");
    assert.match(types, /PartName="\/word\/document\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml"/);
    assert.doesNotMatch(types, /template\.main/);
    assert.equal(readWordPackage(Buffer.from(writeZip([...parts].map(([name, data]) => ({ name, data }))))).isTemplate, false);
  });

  test("a mermaid diagram and a missing picture are reported, not silently dropped", async () => {
    const created = await createDocument(template(), "```mermaid\ngraph TD; A-->B\n```\n\n![gone](gone.png)", {
      pictures: { imageKey: (src) => src, loadImage: async () => undefined },
    });
    assert.deepEqual(created.warnings, [
      "1 mermaid diagram(s) written as their source, as code: diagrams are drawn only by the viewer's export",
      'picture "gone.png" could not be loaded; its alt text was written instead',
    ]);
    assert.match(text(unzip(created.bytes), "word/document.xml"), /graph TD; A--&gt;B/);
  });
});
