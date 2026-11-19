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
import { createDocument, MAX_MARKDOWN_CHARS } from "@pi-outpost/office/docxBuild.ts";
import { readWordPackage, WordTemplateError } from "@pi-outpost/office/docxTemplate.ts";
import { updateDocument, REVISION_AUTHOR, type DocxEdit } from "@pi-outpost/office/docxUpdate.ts";
import { bodyLayout, headingLevelOf, paragraphText } from "@pi-outpost/office/wordml.ts";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";

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

  test("TypedHeadingNumbersAreRemovedOnUpdate: a new section's typed number is removed where the document numbers its headings", async () => {
    const updated = await updateDocument(report(), [{ action: "insert_after", section: "Périmètre", markdown: "# 3. Budget\n\n## 3.1 Chiffres\n\nDes chiffres." }], {
      trackChanges: false,
    });
    const headings = outline(updated.bytes);
    assert.ok(headings.includes("1 Budget") && headings.includes("2 Chiffres"), headings.join("\n"));
    assert.ok(updated.warnings.some((warning) => /typed number was removed from 2 heading/.test(warning)), updated.warnings.join("\n"));
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

/**
 * The report with its body replaced by `inner`, its section properties kept unless told not to:
 * a document holding exactly the shapes a test needs.
 */
function withBody(inner: string, { sectPr = true } = {}) {
  const pkg = report();
  const layout = bodyLayout(pkg.documentXml);
  const last = layout.children.at(-1)!;
  pkg.documentXml = pkg.documentXml.slice(0, layout.innerStart) + inner + (sectPr ? last.xml : "") + pkg.documentXml.slice(layout.innerEnd);
  return pkg;
}
const heading = (text: string, level = 1) => `<w:p><w:pPr><w:pStyle w:val="Titre${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe("docx_update: what a tracked deletion marks", () => {
  /** The section "Cible", deleted with tracking on: its elements as they come out. */
  async function deleted(inner: string): Promise<string[]> {
    const pkg = withBody(heading("Avant") + para("garde") + heading("Cible") + inner + heading("Après") + para("garde"));
    const updated = await updateDocument(pkg, [{ action: "delete", section: "Cible" }], { date: DATE });
    const after = body(updated.bytes);
    // Avant, its paragraph, then Cible's heading — deleted, so its text is no longer text.
    assert.match(after[2]!, /<w:delText>Cible<\/w:delText>/);
    return after.slice(3, index(after, "Après"));
  }

  test("every run of every shape of paragraph is marked deleted, and every paragraph mark with it", async () => {
    const section = await deleted(
      [
        // No properties at all: a mark is added, in properties of its own.
        `<w:p/>`,
        // Properties without run properties: the mark goes at their end.
        `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:hyperlink r:id="rIdLink"><w:r><w:t>lien</w:t></w:r></w:hyperlink><w:proofErr w:type="spellStart"/></w:p>`,
        // Empty run properties: opened to take the mark.
        `<w:p><w:pPr><w:rPr/></w:pPr><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r></w:p>`,
        // Run properties already there: the mark goes first among them.
        `<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:fldSimple w:instr="DATE"><w:r><w:t>1er</w:t></w:r></w:fldSimple></w:p>`,
        // Empty properties.
        `<w:p><w:pPr/><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>contrôle</w:t></w:r></w:sdtContent></w:sdt><w:customXml/></w:p>`,
        // Properties ending with a section break: the mark goes before it, as the schema orders them.
        `<w:p><w:pPr><w:jc w:val="left"/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr><w:r><w:t>fin de section</w:t></w:r></w:p>`,
      ].join(""),
    );
    const [empty, link, field, simple, control, sectionBreak] = section;
    assert.match(empty!, /^<w:p><w:pPr><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr><\/w:p>$/);
    assert.match(link!, /<w:pPr><w:jc w:val="left"\/><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr>/);
    assert.match(link!, /<w:hyperlink r:id="rIdLink"><w:del [^>]*><w:r><w:delText>lien<\/w:delText><\/w:r><\/w:del><\/w:hyperlink>/);
    assert.match(link!, /<w:proofErr w:type="spellStart"\/>/, "what is not a run is left as it is");
    assert.match(field!, /<w:pPr><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr>/);
    assert.match(field!, /<w:delInstrText xml:space="preserve"> PAGE <\/w:delInstrText>/);
    assert.match(simple!, /<w:pPr><w:rPr><w:del [^>]*\/><w:b\/><\/w:rPr><\/w:pPr>/);
    assert.match(simple!, /<w:fldSimple w:instr="DATE"><w:del [^>]*><w:r><w:delText>1er<\/w:delText>/);
    assert.match(control!, /<w:pPr><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr>/);
    assert.match(control!, /<w:sdtPr\/><w:sdtContent><w:del [^>]*><w:r><w:delText>contrôle<\/w:delText>/);
    assert.match(control!, /<w:customXml\/>/);
    assert.match(sectionBreak!, /<w:jc w:val="left"\/><w:rPr><w:del [^>]*\/><\/w:rPr><w:sectPr>/);
    // Nothing of the section is left as live text.
    assert.ok(section.every((xml) => !/<w:t>|<w:instrText/.test(xml)), section.join("\n"));
  });

  test("a table's rows are each marked deleted, whatever properties they had, and so is their text", async () => {
    const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const [table] = await deleted(
      `<w:tbl><w:tblPr/><w:tr><w:trPr><w:cantSplit/></w:trPr>${cell("a")}</w:tr><w:tr><w:trPr/>${cell("b")}</w:tr><w:tr>${cell("c")}<w:tc><w:p/></w:tc></w:tr></w:tbl>`,
    );
    const rows = [...table!.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map((match) => match[0]);
    assert.equal(rows.length, 3);
    assert.match(rows[0]!, /^<w:tr><w:trPr><w:cantSplit\/><w:del [^>]*\/><\/w:trPr>/);
    assert.match(rows[1]!, /^<w:tr><w:trPr><w:del [^>]*\/><\/w:trPr>/);
    assert.match(rows[2]!, /^<w:tr><w:trPr><w:del [^>]*\/><\/w:trPr><w:tc>/, "a row without properties is given them, once");
    assert.equal((rows[2]!.match(/<w:trPr>/g) ?? []).length, 1);
    for (const [row, text] of rows.map((row, i) => [row, "abc"[i]] as const)) assert.match(row, new RegExp(`<w:delText>${text}</w:delText>`));
    assert.match(table!, /^<w:tbl><w:tblPr\/>/, "the table's own properties stay");
  });

  test("a block content control's paragraphs are marked; a bookmark between blocks is left as it is", async () => {
    const [control, bookmark] = await deleted(`<w:sdt><w:sdtPr/><w:sdtContent>${para("dans le contrôle")}</w:sdtContent></w:sdt><w:bookmarkStart w:id="90" w:name="b"/>`);
    assert.match(control!, /<w:sdtContent><w:p><w:pPr><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr><w:del [^>]*><w:r><w:delText>dans le contrôle<\/w:delText>/);
    assert.equal(bookmark, `<w:bookmarkStart w:id="90" w:name="b"/>`);
  });

  test("revision ids follow the highest id already in the document", async () => {
    const section = await deleted(`<w:p><w:bookmarkStart w:id="700" w:name="x"/>${"<w:r><w:t>t</w:t></w:r>"}</w:p>`);
    const ids = [...section.join("").matchAll(/<w:del w:id="(\d+)"/g)].map((match) => Number(match[1]));
    assert.ok(ids.length > 0 && ids.every((id) => id > 700), ids.join(", "));
  });
});

describe("docx_update: what is refused before anything is changed", () => {
  const refused = (pkg: ReturnType<typeof report>, edits: DocxEdit[], message: RegExp) =>
    assert.rejects(updateDocument(pkg, edits), (error: unknown) => error instanceof WordTemplateError && message.test(error.message));

  test("no edits, too many, or content that is empty or too long", async () => {
    await refused(report(), [], /^no edits were given$/);
    const many = Array.from({ length: 51 }, () => ({ action: "append" as const, markdown: "x" }));
    await refused(report(), many, /^at most 50 edits in one call \(got 51\)$/);
    await refused(report(), [{ action: "append", markdown: " \n " }], /^edit 1: there is no content to write$/);
    await refused(report(), [{ action: "delete", section: "Conclusion" }, { action: "replace", section: "Risques", markdown: "x".repeat(MAX_MARKDOWN_CHARS + 1) }], /^edit 2: the content is longer than \d+ characters$/);
    await refused(report(), [{ action: "rename", section: "Risques" } as unknown as DocxEdit], /^edit 1: unknown action$/);
  });

  test("an empty path, or a part not under its parent, names where it looked", async () => {
    await refused(report(), [{ action: "delete", section: " > " }], /^the section path is empty\.\nThe document's headings:/);
    await refused(report(), [{ action: "delete", section: "Périmètre > Risques" }], /^no section "Risques" under "Périmètre"\./);
  });

  test("a document without headings says so", async () => {
    await refused(withBody(para("Rien que du texte.")), [{ action: "delete", section: "Budget" }], /\nThe document has no headings\.$/);
  });

  test("an empty heading is not a section", async () => {
    const pkg = withBody(heading("") + para("sous un titre vide") + heading("Plein") + para("x"));
    await refused(pkg, [{ action: "delete", section: "" }], /^the section path is empty\.\nThe document's headings:\n- Plein$/);
  });

  test("two edits of the same part, or an insertion inside a deleted section, must be combined", async () => {
    await refused(
      report(),
      [
        { action: "replace", section: "Périmètre", markdown: "x" },
        { action: "delete", section: "Périmètre > Inclus" },
      ],
      /^edits 1 and 2 touch the same part of the document; combine them into one$/,
    );
    await refused(
      report(),
      [
        { action: "delete", section: "Périmètre" },
        { action: "insert_after", section: "Inclus", markdown: "x" },
      ],
      /^edits 1 and 2 touch the same part/,
    );
  });
});

describe("docx_update: appending", () => {
  test("appended content goes before the final section properties, and to the very end without them", async () => {
    const withSect = await updateDocument(report(), [{ action: "append", markdown: "Annexe." }], { trackChanges: false });
    const after = body(withSect.bytes);
    assert.equal(paragraphText(after.at(-2)!).trim(), "Annexe.");
    assert.match(after.at(-1)!, /^<w:sectPr\b/);
    assert.deepEqual(withSect.report, ["1. appended at the end"]);

    const bare = await updateDocument(withBody(heading("Seul") + para("x"), { sectPr: false }), [{ action: "append", markdown: "Annexe." }], { trackChanges: false });
    assert.equal(paragraphText(body(bare.bytes).at(-1)!).trim(), "Annexe.");
  });
});
