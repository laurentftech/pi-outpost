/**
 * docx_restyle: a drifted document brought into a template's house style.
 *
 * `fixtures/docx-drifted.docx` is an English Word's document (`Heading1`) with its own
 * Arial styles, theme and Roman heading numbering, and fonts, sizes and colours set by
 * hand everywhere its text lives; `docx-template.dotx` is a French Word's template
 * (`Titre1`) numbered "1. / 1.1.". See make-docx-template.mjs.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { readWordPackage, WordTemplateError } from "../src/docxTemplate.ts";
import { assertTextUnchanged, restyleDocument, type RestyleOptions } from "../src/docxRestyle.ts";
import { REVISION_AUTHOR } from "../src/docxUpdate.ts";
import { realResolve } from "../src/sandbox.ts";
import { bodyLayout } from "../src/wordml.ts";
import { createDocxRestyleToolDefinition } from "../src/wordTools.ts";
import { readAllZipEntries } from "../src/zip.ts";
import { writeZip } from "../src/zipWriter.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const driftedBytes = await readFile(path.join(FIXTURES, "docx-drifted.docx"));
const templateBytes = await readFile(path.join(FIXTURES, "docx-template.dotx"));
const DATE = new Date("2026-03-01T00:00:00Z");

const unzip = (bytes: Uint8Array) => readAllZipEntries(Buffer.from(bytes), { maxEntries: 4096, maxInflatedBytes: 1e8, maxTotalBytes: 1e9 });
const text = (parts: Map<string, Buffer>, name: string) => {
  const part = parts.get(name);
  assert.ok(part, `${name} is in the package`);
  return part.toString("utf8");
};

function restyle(options: RestyleOptions = {}, bytes: Buffer = driftedBytes) {
  const result = restyleDocument(readWordPackage(bytes, "the document"), readWordPackage(templateBytes), { date: DATE, ...options });
  return { result, parts: unzip(result.bytes) };
}

/** The run (`<w:r>…</w:r>`) whose text is `words`. */
function runOf(xml: string, words: string): string {
  const at = xml.indexOf(`>${words}</w:t>`);
  assert.ok(at >= 0, `"${words}" is in the part`);
  const start = xml.lastIndexOf("<w:r>", at);
  return xml.slice(start, xml.indexOf("</w:r>", at) + "</w:r>".length);
}

/** A run's own properties, without the tracked record of the old ones. */
const liveProps = (run: string) => (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run.replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/, ""))?.[1] ?? "");
const HAND_SET = /<w:(rFonts|sz|szCs|color)\b/;

describe("restyleDocument", () => {
  test("DocumentTakesTheTemplatesStyles: headings on the template's ids, its style sheet and theme", () => {
    const { parts } = restyle();
    const body = text(parts, "word/document.xml");
    assert.match(body, /<w:pStyle w:val="Titre1"\/><\/w:pPr><w:r><w:t[^>]*>Introduction</);
    assert.match(body, /<w:pStyle w:val="Titre2"\/><\/w:pPr><w:r>[\s\S]*?Détails</);
    assert.doesNotMatch(body, /w:val="Heading1"|w:val="Heading2"/);
    const template = unzip(templateBytes);
    const styles = text(parts, "word/styles.xml");
    const heading1 = /<w:style w:type="paragraph" w:styleId="Titre1">[\s\S]*?<\/w:style>/.exec(text(template, "word/styles.xml"))![0];
    // The template's definition, but with its heading numbering renumbered into the document's.
    assert.equal(heading1.replace(/<w:numId w:val="\d+"\/>/, ""), /<w:style w:type="paragraph" w:styleId="Titre1">[\s\S]*?<\/w:style>/.exec(styles)![0].replace(/<w:numId w:val="\d+"\/>/, ""));
    assert.doesNotMatch(styles, /w:styleId="Heading1"|Times New Roman/, "the document's own definitions and defaults are gone");
    assert.ok(text(parts, "word/theme/theme1.xml") === text(template, "word/theme/theme1.xml"), "the theme is the template's");
  });

  test("HandSetFontsSizesAndColoursAreRemoved: in the body, a heading, a list, a table, a text box, a footnote and the header", () => {
    const { parts, result } = restyle({ trackChanges: false });
    const body = text(parts, "word/document.xml");
    for (const words of ["Texte collé d’un courriel", "Détails", "Premier point", "Cellule", "Zone de texte", "Section en paysage"]) {
      assert.doesNotMatch(runOf(body, words), HAND_SET, words);
    }
    // The paragraph mark's own properties too.
    assert.doesNotMatch(/<w:pPr><w:spacing[\s\S]*?<\/w:pPr>/.exec(body)![0], HAND_SET);
    assert.doesNotMatch(runOf(text(parts, "word/footnotes.xml"), " Une note."), HAND_SET);
    assert.doesNotMatch(runOf(text(parts, "word/header1.xml"), "Ancien en-tête"), HAND_SET);
    // Not the document's text: a comment is someone's note, an equation keeps its math font.
    assert.match(runOf(text(parts, "word/comments.xml"), "Voir la police."), /Courier New/);
    assert.match(body, /<m:r><w:rPr><w:rFonts w:ascii="Cambria Math"/);
    assert.deepEqual(result.removed, { runs: 17, fonts: 14, sizes: 6, colours: 3 });
  });

  test("OtherFormattingIsKept: emphasis, superscript, highlight, spacing and indentation stay", () => {
    const { parts } = restyle({ trackChanges: false });
    const body = text(parts, "word/document.xml");
    assert.equal(liveProps(runOf(body, " en gras")), "<w:b/>");
    assert.equal(liveProps(runOf(body, " en italique")), "<w:i/>");
    assert.equal(liveProps(runOf(body, "2")), '<w:vertAlign w:val="superscript"/>');
    assert.equal(liveProps(runOf(body, " surligné")), '<w:highlight w:val="yellow"/>');
    assert.match(body, /<w:pPr><w:spacing w:after="0"\/><w:ind w:left="360"\/><\/w:pPr><w:r><w:t[^>]*>Interligne posé à la main/);
  });

  test("HeadingNumberingFollowsTheTemplateAndListsKeepTheirs", () => {
    const { parts } = restyle();
    const numbering = text(parts, "word/numbering.xml");
    const styles = text(parts, "word/styles.xml");
    const headingNum = /w:styleId="Titre1">[\s\S]*?<w:numId w:val="(\d+)"\/>/.exec(styles)![1];
    const abstract = new RegExp(`<w:num w:numId="${headingNum}"><w:abstractNumId w:val="(\\d+)"/>`).exec(numbering)![1];
    const definition = new RegExp(`<w:abstractNum w:abstractNumId="${abstract}">[\\s\\S]*?</w:abstractNum>`).exec(numbering)![0];
    assert.match(definition, /<w:lvlText w:val="%1\."\/>[\s\S]*<w:lvlText w:val="%1\.%2\."\/>/, "the template's 1. / 1.1.");
    assert.notEqual(headingNum, "1");
    // The document's Roman heading numbering no longer claims the heading style.
    assert.doesNotMatch(/<w:abstractNum w:abstractNumId="0">[\s\S]*?<\/w:abstractNum>/.exec(numbering)![0], /pStyle/);
    // Its own list keeps its definition and id.
    assert.match(numbering, /<w:num w:numId="2"><w:abstractNumId w:val="1"\/><\/w:num>/);
    assert.match(numbering, /<w:abstractNum w:abstractNumId="1">[\s\S]*?lowerLetter/);
    assert.match(text(parts, "word/document.xml"), /<w:numId w:val="2"\/><\/w:numPr><\/w:pPr><w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>Premier point/);
  });

  test("a template style numbered by a list its package does not hold is left unnumbered, not pointed at the document's lists", () => {
    const parts = unzip(templateBytes);
    parts.set("word/styles.xml", Buffer.from(text(parts, "word/styles.xml").replace('<w:numId w:val="1"/>', '<w:numId w:val="7"/>'), "utf8"));
    const broken = writeZip([...parts].map(([name, data]) => ({ name, data })));
    const result = restyleDocument(readWordPackage(driftedBytes, "the document"), readWordPackage(broken), { date: DATE });
    const styles = unzip(result.bytes).get("word/styles.xml")!.toString("utf8");
    assert.match(/w:styleId="Titre1">[\s\S]*?<\/w:style>/.exec(styles)![0], /<w:numId w:val="0"\/>/);
  });

  test("PageSetupAndHeadersOnlyOnRequest: margins and headers from the template, orientation kept", () => {
    const plain = restyle();
    const plainBody = text(plain.parts, "word/document.xml");
    assert.equal([...plainBody.matchAll(/<w:pgMar w:top="1440"/g)].length, 3, "the document's margins, untouched");
    assert.match(text(plain.parts, "word/header1.xml"), /Ancien en-tête/);

    const { parts, result } = restyle({ include: ["page", "headers"] });
    const body = text(parts, "word/document.xml");
    const sections = [...body.matchAll(/<w:sectPr>[\s\S]*?<\/w:sectPr>(?=<\/w:pPr>|<\/w:body>)/g)].map((match) => match[0]);
    assert.equal(sections.length, 3);
    for (const section of sections) assert.match(section, /<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701"/);
    assert.match(sections[0], /<w:pgSz w:w="11906" w:h="16838"\/>/);
    assert.match(sections[1], /<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"\/>/, "the landscape section stays landscape");
    // Each section's old page setup is kept as a tracked change, last, as the schema orders it.
    for (const section of sections) assert.match(section, new RegExp(`<w:sectPrChange [^>]*w:author="${REVISION_AUTHOR}"[^>]*><w:sectPr><w:pgSz[^>]*/><w:pgMar w:top="1440"[\\s\\S]*</w:sectPrChange></w:sectPr>$`));
    // The template's header and footer, referenced by every section; the old header is gone.
    const rels = text(parts, "word/_rels/document.xml.rels");
    const headerTarget = /Type="[^"]*\/header" Target="([^"]+)"/.exec(rels)![1];
    const footerTarget = /Type="[^"]*\/footer" Target="([^"]+)"/.exec(rels)![1];
    assert.equal(text(parts, `word/${headerTarget}`), text(unzip(templateBytes), "word/header1.xml"));
    assert.equal(text(parts, `word/${footerTarget}`), text(unzip(templateBytes), "word/footer1.xml"));
    for (const section of sections) {
      assert.match(section, /^<w:sectPr><w:headerReference w:type="default" r:id="[^"]+"\/><w:footerReference w:type="default" r:id="[^"]+"\/>/);
    }
    assert.ok(!parts.has("word/header1.xml") || !text(parts, "word/header1.xml").includes("Ancien en-tête"), "the document's header is gone");
    assert.doesNotMatch(text(parts, "[Content_Types].xml"), /header1\.xml/);
    assert.match(result.report.join("\n"), /Page size and margins: the template's, in 3 section\(s\)[\s\S]*Headers and footers: the template's/);
  });

  test("AStyleTheTemplateLacksIsKept: carried with its definition, named in the answer", () => {
    const { parts, result } = restyle();
    assert.match(text(parts, "word/document.xml"), /<w:pStyle w:val="Encadre"\/><\/w:pPr><w:r>[\s\S]*?Un encadré maison/);
    // Its definition comes along, based on the template's Normal.
    assert.match(text(parts, "word/styles.xml"), /<w:style w:type="paragraph" w:customStyle="1" w:styleId="Encadre"><w:name w:val="Boxed text"\/><w:basedOn w:val="Normal"\/><w:pPr><w:pBdr>/);
    assert.deepEqual(result.missingStyles, [{ name: "Boxed text", uses: 1 }]);
    assert.match(result.report.join("\n"), /Styles the template does not have, kept as they were: "Boxed text" \(1 use\)/);
  });

  test("TheTextIsUnchanged: every text node of every story is the original's, and a difference stops the write", () => {
    for (const options of [{}, { trackChanges: false }, { include: ["page", "headers"] as const }]) {
      const { parts } = restyle({ ...options, include: options.include ? [...options.include] : undefined });
      const original = unzip(driftedBytes);
      for (const part of ["word/document.xml", "word/footnotes.xml", "word/comments.xml"]) {
        const words = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]);
        assert.deepEqual(words(text(parts, part)), words(text(original, part)), `${part} with ${JSON.stringify(options)}`);
      }
    }
    // The check itself: a single character is enough to refuse.
    assert.doesNotThrow(() => assertTextUnchanged("word/document.xml", "<w:t>abc</w:t>", '<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">abc</w:t>'));
    assert.throws(
      () => assertTextUnchanged("word/document.xml", "<w:t>abc</w:t>", "<w:t>abd</w:t>"),
      (error: unknown) => error instanceof WordTemplateError && /would have changed the text of word\/document\.xml; nothing was written/.test(error.message),
    );
  });

  test("RemovalsAreTrackedByDefault: each run keeps its old properties in a w:rPrChange by pi-outpost", () => {
    const { parts, result } = restyle();
    const body = text(parts, "word/document.xml");
    const pasted = runOf(body, "Texte collé d’un courriel");
    assert.match(
      pasted,
      new RegExp(
        `^<w:r><w:rPr><w:rPrChange w:id="\\d+" w:author="${REVISION_AUTHOR}" w:date="2026-03-01T00:00:00Z"><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="FF0000"/></w:rPr></w:rPrChange></w:rPr>`,
      ),
    );
    assert.match(runOf(body, " en gras"), /<w:rPr><w:b\/><w:rPrChange [^>]*><w:rPr><w:b\/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"\/><\/w:rPr><\/w:rPrChange><\/w:rPr>/);
    // Revision ids are unique across the stories they are written in.
    const ids = ["word/document.xml", "word/footnotes.xml", "word/header1.xml"].flatMap((part) => [...text(parts, part).matchAll(/<w:rPrChange w:id="(\d+)"/g)].map((match) => match[1]));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 17);
    assert.match(result.report.join("\n"), /as tracked formatting changes[\s\S]*not tracked changes: rejecting every change in Word brings back the hand-set formatting, not the old styles/);
    // A section untouched by `include` has nothing tracked.
    assert.doesNotMatch(body, /sectPrChange/);
  });

  test("PendingRevisionsAreRefused: an insertion nobody accepted stops the restyle", async () => {
    const tracked = await readFile(path.join(FIXTURES, "docx-drifted-tracked.docx"));
    assert.throws(
      () => restyle({}, tracked),
      (error: unknown) => error instanceof WordTemplateError && /holds tracked changes nobody has accepted or rejected yet; resolve them in Word first/.test(error.message),
    );
  });

  test("the result is a sound package: a body, every relationship resolved, nothing declared twice", () => {
    for (const include of [[], ["page", "headers"]] as const) {
      const { parts } = restyle({ include: [...include] });
      assert.ok(bodyLayout(text(parts, "word/document.xml")).sectPr !== undefined);
      const types = text(parts, "[Content_Types].xml");
      const declared = [...types.matchAll(/PartName="\/([^"]+)"/g)].map((match) => match[1].toLowerCase());
      assert.equal(new Set(declared).size, declared.length, "no part declared twice");
      for (const name of declared) assert.ok(parts.has(name) || [...parts.keys()].some((part) => part.toLowerCase() === name), `declared ${name} exists`);
      for (const [name, data] of parts) {
        if (!name.endsWith(".rels") || name === "_rels/.rels") continue;
        const base = name.replace(/_rels\/[^/]+\.rels$/, "");
        for (const match of data.toString("utf8").matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*\/>/g)) {
          if (/TargetMode="External"/.test(match[0])) continue;
          const segments: string[] = [];
          for (const segment of `${base}${match[1]}`.split("/")) {
            if (segment === "..") segments.pop();
            else if (segment !== "" && segment !== ".") segments.push(segment);
          }
          assert.ok(parts.has(segments.join("/")), `${name} → ${segments.join("/")}`);
        }
      }
    }
  });
});

describe("docx_restyle", () => {
  let root: string;
  let tool: ReturnType<typeof createDocxRestyleToolDefinition>;
  const call = async (params: Record<string, unknown>) =>
    (await (tool.execute as unknown as (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>)("call-1", params)).content[0].text;

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-docx-restyle-")));
    await writeFile(path.join(root, "old.docx"), driftedBytes);
    await writeFile(path.join(root, "house.dotx"), templateBytes);
    tool = createDocxRestyleToolDefinition({ cwd: root, allowedRoots: [root], writableRoot: root, maxBytes: 25 * 1024 * 1024, render: { renderer: "auto", timeoutMs: 1000 } });
  });

  test("TheOriginalIsKeptUnlessOverwriteIsAsked: the result goes to output_path, the original stays", async () => {
    const answer = await call({ path: "old.docx", template_path: "house.dotx", output_path: "new.docx" });
    assert.match(answer, /^Wrote `new\.docx` \(\d+ bytes\) in the styles of `house\.dotx`:/);
    assert.match(answer, /Removed hand-set formatting from 17 run\(s\)/);
    assert.match(answer, /Next: call docx_render with path "new\.docx"/);
    assert.ok((await readFile(path.join(root, "old.docx"))).equals(driftedBytes), "the original is unchanged");
    assert.match(unzip(await readFile(path.join(root, "new.docx"))).get("word/document.xml")!.toString("utf8"), /Titre1/);
    await assert.rejects(call({ path: "old.docx", template_path: "house.dotx" }), /Give output_path for the restyled document, or overwrite: true/);
    await assert.rejects(call({ path: "old.docx", template_path: "house.dotx", output_path: "new.docx" }), /already exists\. Pass overwrite: true/);
    assert.ok((await readFile(path.join(root, "old.docx"))).equals(driftedBytes));
    await call({ path: "old.docx", template_path: "house.dotx", overwrite: true, include: ["headers"], track_changes: false });
    assert.match(unzip(await readFile(path.join(root, "old.docx"))).get("word/document.xml")!.toString("utf8"), /Titre1/);
  });

  test("a refusal names the file and writes nothing", async () => {
    await writeFile(path.join(root, "pending.docx"), await readFile(path.join(FIXTURES, "docx-drifted-tracked.docx")));
    await assert.rejects(call({ path: "pending.docx", template_path: "house.dotx", output_path: "never.docx" }), /"pending\.docx": the document holds tracked changes/);
    assert.ok(!existsSync(path.join(root, "never.docx")));
  });
});
