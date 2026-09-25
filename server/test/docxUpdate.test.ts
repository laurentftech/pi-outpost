/**
 * Changing an existing Word document by sections.
 *
 * `fixtures/docx-report.docx` has sections Introduction, Périmètre (with Inclus and
 * Exclus), Risques and Conclusion, under French heading ids (`Titre1`, `Titre2`), a
 * bulleted list, a table, a picture, a comment and a bookmark; `docx-report-tracked.docx`
 * is the same with an insertion nobody accepted under Inclus. See make-docx-template.mjs.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { createDocument } from "../src/docxBuild.ts";
import { readWordPackage, WordTemplateError } from "../src/docxTemplate.ts";
import { updateDocument, REVISION_AUTHOR, type DocxEdit } from "../src/docxUpdate.ts";
import { bodyLayout, headingLevelOf, paragraphText } from "../src/wordml.ts";
import { readAllZipEntries } from "../src/zip.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const reportBytes = await readFile(path.join(FIXTURES, "docx-report.docx"));
const trackedBytes = await readFile(path.join(FIXTURES, "docx-report-tracked.docx"));
const report = () => readWordPackage(reportBytes, "the document");
const DATE = new Date("2026-02-01T00:00:00Z");

function unzip(bytes: Uint8Array): Map<string, Buffer> {
  return readAllZipEntries(Buffer.from(bytes), { maxEntries: 4096, maxInflatedBytes: 1e8, maxTotalBytes: 1e9 });
}

/** The body's elements, as XML. */
function body(bytes: Uint8Array): string[] {
  const xml = unzip(bytes).get("word/document.xml")!.toString("utf8");
  return bodyLayout(xml).children.map((child) => child.xml);
}

/** The headings, in order, as `level text`. */
function outline(bytes: Uint8Array): string[] {
  const pkg = readWordPackage(bytes, "the result");
  return bodyLayout(pkg.documentXml)
    .children.filter((child) => child.local === "p")
    .flatMap((child) => {
      const level = headingLevelOf(child.xml, pkg.styles);
      return level === undefined ? [] : [`${level} ${paragraphText(child.xml).trim()}`];
    });
}

const index = (elements: string[], text: string) => elements.findIndex((xml) => paragraphText(xml).trim() === text);

describe("docx_update", () => {
  test("ASectionIsReplacedAndTheRestIsUntouched: new body under the old heading, everything else byte-identical", async () => {
    const updated = await updateDocument(report(), [{ action: "replace", section: "Périmètre", markdown: "Un périmètre **revu**." }], { trackChanges: false, date: DATE });
    const before = body(reportBytes);
    const after = body(updated.bytes);
    const heading = index(before, "Périmètre");
    const next = index(before, "Risques");
    // Section 1 and the heading of section 2: the same bytes.
    assert.deepEqual(after.slice(0, heading + 1), before.slice(0, heading + 1));
    // Section 2's body is the new paragraph alone — its subsections were its body.
    assert.equal(after.length - (before.length - (next - heading - 1)), 1);
    assert.equal(paragraphText(after[heading + 1]).trim(), "Un périmètre revu.");
    assert.match(after[heading + 1], /<w:b\/>/);
    // Sections 3 and 4, and the final section properties: the same bytes.
    assert.deepEqual(after.slice(heading + 2), before.slice(next));
    // A paragraph of plain text needs no other part: every one is copied as it was.
    const original = unzip(reportBytes);
    const result = unzip(updated.bytes);
    assert.deepEqual([...result.keys()].sort(), [...original.keys()].sort());
    const changed = [...original].filter(([name, data]) => !result.get(name)!.equals(data)).map(([name]) => name);
    assert.deepEqual(changed, ["word/document.xml"]);
    // What went with the section is counted: the comment anchored in it.
    assert.equal(updated.removed.comments, 1);
  });

  test("EditsAreTrackedChangesByDefault: the old text is deleted and the new inserted, by pi-outpost", async () => {
    const updated = await updateDocument(report(), [{ action: "replace", section: "Risques", markdown: "Un risque de coût." }], { date: DATE });
    const after = body(updated.bytes);
    const start = index(after, "Risques");
    const section = after.slice(start + 1, index(after, "Conclusion"));
    const deleted = section.filter((xml) => /<w:delText[^>]*>Un risque de délai\.<\/w:delText>/.test(xml));
    const inserted = section.filter((xml) => /<w:ins [^>]*><w:r><w:t[^>]*>Un risque de coût\.<\/w:t>/.test(xml));
    assert.equal(deleted.length, 1, "the old paragraph is kept, marked deleted");
    assert.equal(inserted.length, 1, "the new paragraph is marked inserted");
    // The paragraph marks are revisions too, or accepting leaves an empty paragraph behind.
    assert.match(deleted[0], /<w:pPr><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr>/);
    assert.match(inserted[0], /<w:pPr><w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr>/);
    // The picture that was in the section is deleted with it, not left standing.
    assert.ok(section.some((xml) => /<w:del [^>]*><w:r><w:drawing>/.test(xml)));
    // No text of the old section is left outside a deletion.
    assert.ok(section.every((xml) => !/<w:t[^>]*>Un risque de délai/.test(xml)));
    for (const revision of section.join("").matchAll(/<w:(?:ins|del) [^>]*>/g)) {
      assert.match(revision[0], new RegExp(`w:author="${REVISION_AUTHOR}"`));
      assert.match(revision[0], /w:date="2026-02-01T00:00:00Z"/);
    }
    assert.match(updated.report[0], /tracked/);
  });

  test("AnUnknownOrAmbiguousHeadingIsRefused: the call fails with the document's headings", async () => {
    await assert.rejects(
      updateDocument(report(), [{ action: "delete", section: "Budget" }]),
      (error: unknown) =>
        error instanceof WordTemplateError && /no section "Budget"/.test(error.message) && /- Introduction\n- Périmètre\n {2}- Inclus\n {2}- Exclus\n- Risques\n- Conclusion/.test(error.message),
    );
    // Two sections called "Détail": the name alone is refused, the path settles it.
    const twice = (await createDocument(readWordPackage(reportBytes), "# Lot A\n\n## Détail\n\nA.\n\n# Lot B\n\n## Détail\n\nB.")).bytes;
    const pkg = readWordPackage(twice, "the document");
    const documentBefore = pkg.documentXml;
    await assert.rejects(
      updateDocument(pkg, [{ action: "delete", section: "Détail" }]),
      (error: unknown) => error instanceof WordTemplateError && /names 2 sections/.test(error.message) && /- Lot A\n {2}- Détail\n- Lot B\n {2}- Détail/.test(error.message),
    );
    assert.equal(pkg.documentXml, documentBefore, "the document read is not changed by a refusal");
    const resolved = await updateDocument(pkg, [{ action: "delete", section: "Lot B > Détail" }], { trackChanges: false });
    assert.deepEqual(outline(resolved.bytes), ["1 Lot A", "2 Détail", "1 Lot B"]);
  });

  test("a heading named with the number copied from the page is found, and a hostile one is refused in linear time", async () => {
    for (const section of ["2. Périmètre > 2.1 Inclus", "2) Périmètre > 2.1. Inclus", "2 Périmètre > Inclus"]) {
      const updated = await updateDocument(report(), [{ action: "delete", section }], { trackChanges: false });
      assert.ok(!outline(updated.bytes).includes("2 Inclus"), section);
    }
    // The shape CodeQL named for the old pattern: a long run of one digit that never
    // becomes a heading number. It must be refused at once, not backtracked through.
    const started = performance.now();
    await assert.rejects(updateDocument(report(), [{ action: "delete", section: `${"0".repeat(50_000)}x` }]), WordTemplateError);
    assert.ok(performance.now() - started < 2_000, `took ${Math.round(performance.now() - started)} ms`);
  });

  test("InsertAndDeleteFollowTheOutline: a new section after all of Périmètre, and Risques gone with its body", async () => {
    const edits: DocxEdit[] = [
      { action: "insert_after", section: "Périmètre", markdown: "# Budget\n\nDes chiffres." },
      { action: "delete", section: "Risques" },
    ];
    const updated = await updateDocument(report(), edits, { trackChanges: false });
    assert.deepEqual(outline(updated.bytes), ["1 Introduction", "1 Périmètre", "2 Inclus", "2 Exclus", "1 Budget", "1 Conclusion"]);
    const after = body(updated.bytes);
    // The new section follows the table that ends Exclus, not the heading of Périmètre.
    assert.ok(/^<w:tbl\b/.test(after[index(after, "Budget") - 1]));
    assert.equal(paragraphText(after[index(after, "Budget") + 1]).trim(), "Des chiffres.");
    assert.ok(!after.join("").includes("Un risque de délai"));
    assert.ok(!after.join("").includes("rIdRisk"), "the picture went with its section");
  });

  test("PendingRevisionsAreNotEditedOver: a section holding someone's unaccepted change is refused", async () => {
    const tracked = () => readWordPackage(trackedBytes, "the document");
    for (const section of ["Inclus", "Périmètre"]) {
      await assert.rejects(
        updateDocument(tracked(), [{ action: "replace", section, markdown: "x" }]),
        (error: unknown) => error instanceof WordTemplateError && /tracked changes nobody has accepted or rejected yet; resolve them in Word first/.test(error.message),
        section,
      );
    }
    // Only the sections holding the change: the rest of the document can still be edited.
    const updated = await updateDocument(tracked(), [{ action: "replace", section: "Conclusion", markdown: "Fin." }], { date: DATE });
    assert.match(body(updated.bytes).join(""), /Ajout non accepté/);
  });

  test("NewContentWearsTheDocumentsStyles: a subheading takes Titre2 and a list the document's numbering", async () => {
    const updated = await updateDocument(report(), [{ action: "insert_after", section: "Conclusion", markdown: "# Annexe\n\n## Chiffres\n\n1. un\n2. deux" }], { trackChanges: false });
    const after = body(updated.bytes);
    assert.match(after[index(after, "Annexe")], /<w:pStyle w:val="Titre1"\/>/);
    assert.match(after[index(after, "Chiffres")], /<w:pStyle w:val="Titre2"\/>/);
    const items = [index(after, "un"), index(after, "deux")].map((at) => after[at]);
    const numIds = items.map((xml) => /<w:numId w:val="(\d+)"\/>/.exec(xml)?.[1]);
    assert.ok(numIds[0] !== undefined && numIds[0] === numIds[1], "both items are in one list");
    const numbering = unzip(updated.bytes).get("word/numbering.xml")!.toString("utf8");
    const num = new RegExp(`<w:num w:numId="${numIds[0]}"><w:abstractNumId w:val="(\\d+)"/>`).exec(numbering);
    assert.ok(num, "the list's numbering is defined in the document");
    assert.match(numbering, new RegExp(`<w:abstractNum w:abstractNumId="${num[1]}"[\\s\\S]*?<w:numFmt w:val="decimal"/>`));
    // The document's own lists keep theirs.
    assert.match(numbering, /<w:num w:numId="2"><w:abstractNumId w:val="1"\/><\/w:num>/);
    assert.notEqual(numIds[0], "2");
  });
});
