/**
 * Word extraction and the review layer: tracked changes and comments.
 *
 * Packages are built here, in the markup Word writes — `w:ins`/`w:del` with author
 * and date, moves linked by their range name, comments anchored by ranges, threads
 * and the resolved state in `commentsExtended.xml` — because those details are what
 * is being asserted. One fixture, edited in Office for the web, checks the same
 * reading against markup this file did not write.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { extractDocx } from "../src/docx.ts";
import { writeZip } from "@pi-outpost/office/zipWriter.ts";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

interface CommentSpec {
  id: number;
  author?: string;
  date?: string;
  text: string;
  paraId: string;
}

function docx(body: string, options: { comments?: CommentSpec[]; extended?: string } = {}): Uint8Array {
  const parts = [
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES) },
    { name: "word/document.xml", data: Buffer.from(`<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`) },
  ];
  if (options.comments !== undefined) {
    const comments = options.comments
      .map(
        (comment) =>
          `<w:comment w:id="${comment.id}"${comment.author ? ` w:author="${comment.author}"` : ""}${comment.date ? ` w:date="${comment.date}"` : ""}>` +
          `<w:p w14:paraId="${comment.paraId}"><w:r><w:annotationRef/></w:r><w:r><w:t>${comment.text}</w:t></w:r></w:p></w:comment>`,
      )
      .join("");
    parts.push({ name: "word/comments.xml", data: Buffer.from(`<?xml version="1.0"?><w:comments ${NS}>${comments}</w:comments>`) });
  }
  if (options.extended !== undefined) {
    parts.push({
      name: "word/commentsExtended.xml",
      data: Buffer.from(`<?xml version="1.0"?><w15:commentsEx ${NS}>${options.extended}</w15:commentsEx>`),
    });
  }
  return new Uint8Array(writeZip(parts));
}

const r = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const dr = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const p = (...inner: string[]) => `<w:p>${inner.join("")}</w:p>`;
const h = (level: number, text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>${r(text)}</w:p>`;
const by = (author: string, date: string, id: number) => `w:id="${id}" w:author="${author}" w:date="${date}"`;
const ins = (inner: string, attrs = by("J. Martin", "2026-10-12T09:30:00Z", 101)) => `<w:ins ${attrs}>${inner}</w:ins>`;
const del = (inner: string, attrs = by("J. Martin", "2026-10-12T09:30:00Z", 102)) => `<w:del ${attrs}>${inner}</w:del>`;
const cell = (...inner: string[]) => `<w:tc><w:p>${inner.join("")}</w:p></w:tc>`;

/** A sentence moved from the "Délais" section to "Annexes", the way Word writes a move. */
const MOVED = "Le délai court à réception.";
const moveFrom = (name = "move1") =>
  `<w:p><w:moveFromRangeStart w:id="201" w:name="${name}" w:author="A. Dupont" w:date="2026-10-13T08:00:00Z"/>` +
  `<w:moveFrom w:id="202" w:author="A. Dupont" w:date="2026-10-13T08:00:00Z">${r(MOVED)}</w:moveFrom>` +
  `<w:moveFromRangeEnd w:id="201"/></w:p>`;
const moveTo = (name = "move1") =>
  `<w:p><w:moveToRangeStart w:id="203" w:name="${name}" w:author="A. Dupont" w:date="2026-10-13T08:00:00Z"/>` +
  `<w:moveTo w:id="204" w:author="A. Dupont" w:date="2026-10-13T08:00:00Z">${r(MOVED)}</w:moveTo>` +
  `<w:moveToRangeEnd w:id="203"/></w:p>`;

const delayEdit = p(r("Le délai est de "), del(dr("30")), ins(r("45")), r(" jours."));

/** A cahier des charges in miniature, with every kind of mark the review reading reports. */
const SPEC = [
  h(1, "Exigences"),
  h(2, "Délais"),
  delayEdit,
  moveFrom(),
  h(2, "Performances"),
  p(r("Le temps de réponse est inférieur à "), ins(r("2 secondes"), by("P. Leroy", "2026-10-14T10:00:00Z", 103)), r(".")),
  h(1, "Annexes"),
  moveTo(),
].join("");

const review = (bytes: Uint8Array, options = {}) => extractDocx(bytes, { review: true, ...options });

describe("AcceptedTextOnly", () => {
  test("MovedTextAppearsOnce: the moved sentence is read at its destination only", async () => {
    const { markdown } = await extractDocx(docx(SPEC));

    assert.equal(markdown.split(MOVED).length - 1, 1, markdown);
    assert.ok(markdown.indexOf(MOVED) > markdown.indexOf("# Annexes"), "it sits under the section it was moved to");
  });

  test("DeletedTableRowIsDropped: no row of empty cells in its place", async () => {
    const body =
      `<w:tbl>` +
      `<w:tr>${cell(r("Exigence"))}${cell(r("Valeur"))}</w:tr>` +
      `<w:tr><w:trPr><w:del ${by("J. Martin", "2026-10-12T09:30:00Z", 110)}/></w:trPr>${cell(del(dr("E-12")))}${cell(del(dr("abandonnée")))}</w:tr>` +
      `<w:tr>${cell(r("E-13"))}${cell(r("10 ms"))}</w:tr>` +
      `</w:tbl>`;
    const { markdown } = await extractDocx(docx(body));

    const rows = markdown.split("\n").filter((line) => line.startsWith("|"));
    assert.deepEqual(rows, ["| Exigence | Valeur |", "| --- | --- |", "| E-13 | 10 ms |"]);
  });

  test("PreviousParagraphStyleIsNotRead: a heading restyled to body text reads as body text", async () => {
    const body =
      `<w:p><w:pPr><w:pStyle w:val="BodyText"/>` +
      `<w:pPrChange ${by("J. Martin", "2026-10-12T09:30:00Z", 120)}><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:pPrChange>` +
      `</w:pPr>${r("Ancien titre")}</w:p>`;

    for (const reading of [{}, { review: true }]) {
      const { markdown } = await extractDocx(docx(body), reading);
      assert.match(markdown, /^Ancien titre$/m, JSON.stringify(reading));
      assert.doesNotMatch(markdown, /# Ancien titre/);
    }
  });

  test("PreviousRunFormattingIsNotRead: strikethrough removed with tracking is not marked", async () => {
    const body = p(
      `<w:r><w:rPr><w:b w:val="0"/><w:rPrChange ${by("J. Martin", "2026-10-12T09:30:00Z", 121)}><w:rPr><w:strike/><w:b/></w:rPr></w:rPrChange></w:rPr>` +
        `<w:t>clause rétablie</w:t></w:r>`,
    );

    for (const reading of [{}, { review: true }]) {
      const { markdown } = await extractDocx(docx(body), reading);
      assert.match(markdown, /^clause rétablie$/m, JSON.stringify(reading));
      assert.doesNotMatch(markdown, /~~|\*\*/);
    }
  });
});

describe("ReviewReadingMarksRevisions", () => {
  test("InsertionAndDeletionAreMarkedInPlace", async () => {
    const { markdown } = await review(docx(delayEdit));

    assert.match(markdown, /^Le délai est de \{--30--\}\[r1\]\{\+\+45\+\+\}\[r2\] jours\.$/m);
  });

  test("MoveIsMarkedAtBothEnds: one shared [mN]", async () => {
    const { markdown } = await review(docx(SPEC));

    assert.match(markdown, new RegExp(`^\\{--${MOVED}--\\}\\[m1\\]$`, "m"));
    assert.match(markdown, new RegExp(`^\\{\\+\\+${MOVED}\\+\\+\\}\\[m1\\]$`, "m"));
    assert.doesNotMatch(markdown, /\[m2\]/);
  });

  test("AdjacentRunsOfOneRevisionBecomeOneMarker", async () => {
    const attrs = (id: number) => by("J. Martin", "2026-10-12T09:30:00Z", id);
    const body = p(r("Avant "), ins(r("trois "), attrs(1)), ins(r("runs "), attrs(2)), ins(r("insérés"), attrs(3)), r(" après."));
    const { markdown } = await review(docx(body));

    assert.match(markdown, /^Avant \{\+\+trois runs insérés\+\+\}\[r1\] après\.$/m);
  });

  test("two revisions by different authors stay two markers", async () => {
    const body = p(ins(r("un"), by("A", "2026-01-01T00:00:00Z", 1)), ins(r("deux"), by("B", "2026-01-01T00:00:00Z", 2)));
    const { markdown } = await review(docx(body));

    assert.match(markdown, /^\{\+\+un\+\+\}\[r1\]\{\+\+deux\+\+\}\[r2\]$/m);
  });

  test("FormattingChangeIsNotMarked: the run reads bold, with no revision marker", async () => {
    const body = p(
      r("Texte "),
      `<w:r><w:rPr><w:b/><w:rPrChange ${by("J. Martin", "2026-10-12T09:30:00Z", 130)}><w:rPr/></w:rPrChange></w:rPr><w:t>important</w:t></w:r>`,
    );
    const { markdown } = await review(docx(body));

    assert.match(markdown, /^Texte \*\*important\*\*$/m);
    assert.doesNotMatch(markdown, /\{\+\+|\{--|\[r\d/);
    assert.match(markdown, /holds no tracked change or comment/);
  });

  test("RevisionInATableCell: the cell shows the marker and the row keeps its columns", async () => {
    const body =
      `<w:tbl><w:tr>${cell(r("Exigence"))}${cell(r("Valeur"))}</w:tr>` +
      `<w:tr>${cell(r("E-1"))}${cell(ins(r("45 jours")))}</w:tr></w:tbl>`;
    const { markdown } = await review(docx(body));

    assert.match(markdown, /^\| E-1 \| \{\+\+45 jours\+\+\}\[r1\] \|$/m);
    for (const row of markdown.split("\n").filter((line) => line.startsWith("|"))) {
      assert.equal(row.split(" | ").length, 2, row);
    }
  });

  test("DeletedTableRowIsKeptInReview: its text in deletion markers, one change for the row", async () => {
    const body =
      `<w:tbl><w:tr>${cell(r("Exigence"))}${cell(r("Valeur"))}</w:tr>` +
      `<w:tr><w:trPr><w:del ${by("J. Martin", "2026-10-12T09:30:00Z", 110)}/></w:trPr>${cell(del(dr("E-12")))}${cell(del(dr("abandonnée")))}</w:tr>` +
      `</w:tbl>`;
    const { markdown } = await review(docx(body));

    assert.match(markdown, /^\| \{--E-12--\}\[r1\] \| \{--abandonnée--\}\[r1\] \|$/m);
    assert.match(markdown, /^- \[r1\] table row deletion — J\. Martin, 2026-10-12/m);
  });

  test("DefaultReadingIsUnchanged: no marker and no deleted text without review", async () => {
    const { markdown } = await extractDocx(docx(SPEC));

    assert.doesNotMatch(markdown, /\{\+\+|\{--|\{==|\[[rmc]\d+\]/);
    assert.doesNotMatch(markdown, /\b30\b/);
    assert.match(markdown, /^Le délai est de 45 jours\.$/m);
  });

  test("a revision of whitespace alone is neither marked nor numbered", async () => {
    const body = p(r("un"), ins(r(" "), by("A", "2026-01-01T00:00:00Z", 1)), r("deux "), ins(r("trois"), by("B", "2026-01-01T00:00:00Z", 2)));
    const { markdown } = await review(docx(body));

    assert.match(markdown, /^un deux \{\+\+trois\+\+\}\[r1\]$/m);
  });

  test("text inserted and then deleted reads as deleted", async () => {
    const body = p(r("Garde "), ins(del(dr("éphémère"), by("B", "2026-02-01T00:00:00Z", 2)), by("A", "2026-01-01T00:00:00Z", 1)));

    assert.doesNotMatch((await extractDocx(docx(body))).markdown, /éphémère/);
    const { markdown } = await review(docx(body));
    assert.match(markdown, /^Garde \{--éphémère--\}\[r1\]$/m);
    assert.match(markdown, /\[r1\] deletion — B, 2026-02-01/);
  });
});

describe("RunFormattingIsCarriedIntoMarkdown in the review reading", () => {
  test("StrikethroughIsNotATrackedDeletionInReview: two different markers", async () => {
    const body = p(r("Garde "), r("barre", "<w:strike/>"), del(dr("SUPPRIME")), r(" fin."));
    const { markdown } = await review(docx(body));

    assert.match(markdown, /^Garde ~~barre~~\{--SUPPRIME--\}\[r1\] fin\.$/m);
  });

  test("formatting markers nest inside revision markers", async () => {
    const { markdown } = await review(docx(p(ins(r("gras", "<w:b/>")))));

    assert.match(markdown, /^\{\+\+\*\*gras\*\*\+\+\}\[r1\]$/m);
  });
});

/** A comment with two replies, the thread resolved, anchored to "45 jours". */
const threadComments: CommentSpec[] = [
  { id: 0, author: "P. Leroy", date: "2026-10-14T11:00:00Z", text: "Pourquoi 45 ?", paraId: "1A2B3C4D" },
  { id: 1, author: "J. Martin", date: "2026-10-15T09:00:00Z", text: "Aligné sur le marché.", paraId: "1A2B3C4E" },
  { id: 2, author: "P. Leroy", date: "2026-10-15T10:00:00Z", text: "D'accord.", paraId: "1A2B3C4F" },
];
const threadExtended =
  `<w15:commentEx w15:paraId="1A2B3C4D" w15:done="1"/>` +
  `<w15:commentEx w15:paraId="1A2B3C4E" w15:paraIdParent="1A2B3C4D" w15:done="1"/>` +
  `<w15:commentEx w15:paraId="1A2B3C4F" w15:paraIdParent="1A2B3C4D" w15:done="1"/>`;
/** Word repeats the root's anchor for every reply. */
const anchored = (inner: string, ids = [0, 1, 2]) =>
  ids.map((id) => `<w:commentRangeStart w:id="${id}"/>`).join("") +
  inner +
  ids.map((id) => `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`).join("");

const commentedSpec = [h(1, "Exigences"), h(2, "Délais"), p(r("Le délai est de "), anchored(r("45 jours")), r("."))].join("");

describe("ReviewReadingAnchorsComments", () => {
  test("CommentIsMarkedOnItsText: one anchor and one reference, replies not marked", async () => {
    const { markdown } = await review(docx(commentedSpec, { comments: threadComments, extended: threadExtended }));

    assert.match(markdown, /^Le délai est de \{==45 jours==\}\[c1\]\.$/m);
    assert.doesNotMatch(markdown, /\[c2\]/);
  });

  test("a comment anchored to a point is marked by its reference alone", async () => {
    const body = p(r("Voir annexe."), `<w:r><w:commentReference w:id="0"/></w:r>`);
    const { markdown } = await review(docx(body, { comments: [threadComments[0]] }));

    assert.match(markdown, /^Voir annexe\.\[c1\]$/m);
  });

  test("CommentOverARevision: both markers and both references", async () => {
    const body = p(r("Le délai est de "), anchored(ins(r("45 jours")), [0]), r("."));
    const { markdown } = await review(docx(body, { comments: [threadComments[0]] }));

    assert.match(markdown, /^Le délai est de \{==\{\+\+45 jours\+\+\}\[r1\]==\}\[c1\]\.$/m);
  });

  test("a comment range across two paragraphs balances in each", async () => {
    const body =
      `<w:p>${r("Début ")}<w:commentRangeStart w:id="0"/>${r("premier")}</w:p>` +
      `<w:p>${r("second")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>${r(" fin")}</w:p>`;
    const { markdown } = await review(docx(body, { comments: [threadComments[0]] }));

    assert.match(markdown, /^Début \{==premier==\}$/m);
    assert.match(markdown, /^\{==second==\}\[c1\] fin$/m);
  });

  test("CommentsAreNotReadByDefault", async () => {
    const { markdown } = await extractDocx(docx(commentedSpec, { comments: threadComments, extended: threadExtended }));

    assert.doesNotMatch(markdown, /Pourquoi|\{==|\[c\d/);
    assert.match(markdown, /^Le délai est de 45 jours\.$/m);
  });
});

describe("ReviewReadingListsEveryReference", () => {
  test("RevisionEntryNamesAuthorDateAndSection", async () => {
    const { markdown } = await review(docx(SPEC));

    assert.match(markdown, /^- \[r3\] insertion — P\. Leroy, 2026-10-14 — Exigences > Performances$/m);
    assert.match(markdown, /^- \[r1\] deletion — J\. Martin, 2026-10-12 — Exigences > Délais$/m);
    assert.match(markdown, /^- \[m1\] moved — A\. Dupont, 2026-10-13 — from Exigences > Délais to Annexes$/m);
    // In document order, after the content
    const list = markdown.slice(markdown.indexOf("Review layer"));
    assert.ok(list.indexOf("[r1]") < list.indexOf("[r2]") && list.indexOf("[r2]") < list.indexOf("[m1]"), list);
    assert.ok(markdown.indexOf("Review layer") > markdown.indexOf("# Annexes"));
  });

  test("CommentEntryCarriesItsThread: text, replies in order, resolved", async () => {
    const { markdown } = await review(docx(commentedSpec, { comments: threadComments, extended: threadExtended }));

    assert.match(
      markdown,
      /^- \[c1\] comment, resolved — P\. Leroy, 2026-10-14 — Exigences > Délais: « Pourquoi 45 \? »\n {4}- reply — J\. Martin, 2026-10-15: « Aligné sur le marché\. »\n {4}- reply — P\. Leroy, 2026-10-15: « D'accord\. »$/m,
    );
  });

  test("an unresolved thread says open; no extended part says the state is not recorded", async () => {
    const open = await review(
      docx(commentedSpec, { comments: threadComments, extended: threadExtended.replace(/w15:done="1"/g, 'w15:done="0"') }),
    );
    assert.match(open.markdown, /\[c1\] comment, open —/);

    const flat = await review(docx(p(anchored(r("texte"), [0])), { comments: [threadComments[0]] }));
    assert.match(flat.markdown, /\[c1\] comment, resolved state not recorded —/);
  });

  test("MissingAuthorOrDateIsNotInvented", async () => {
    const { markdown } = await review(docx(p(`<w:ins w:id="1">${r("ajout")}</w:ins>`)));

    assert.match(markdown, /^- \[r1\] insertion — author not recorded, date not recorded — before the first heading$/m);
  });

  test("ReviewOfADocumentWithNoReviewLayer: accepted text, and it says so", async () => {
    const { markdown } = await review(docx(h(1, "Titre") + p(r("Rien n'a changé."))));

    assert.match(markdown, /^> Review reading: this document holds no tracked change or comment/m);
    assert.match(markdown, /^Rien n'a changé\.$/m);
    assert.doesNotMatch(markdown, /Review layer/);
  });
});

describe("ReviewReferencesAreStableAcrossCalls", () => {
  /** Forty paragraphs, a tracked insertion in every tenth. */
  const long = Array.from({ length: 40 }, (_, i) =>
    (i + 1) % 10 === 0 ? p(r(`Paragraphe ${i + 1} `), ins(r(`ajout ${i + 1}`), by("A", "2026-01-01T00:00:00Z", i))) : p(r(`Paragraphe ${i + 1}.`)),
  ).join("");

  test("SameReferenceInARangedCall", async () => {
    const whole = await review(docx(long));
    const ranged = await review(docx(long), { blocks: "30" });

    assert.match(whole.markdown, /^Paragraphe 30 \{\+\+ajout 30\+\+\}\[r3\]$/m);
    assert.match(ranged.markdown, /^Paragraphe 30 \{\+\+ajout 30\+\+\}\[r3\]$/m);
    assert.match(ranged.markdown, /^- \[r3\] insertion/m);
  });

  test("TruncatedReviewListsOnlyWhatItShows", async () => {
    const result = await review(docx(long), { maxBlocks: 25 });

    assert.equal(result.nextBlock, 26);
    assert.match(result.markdown, /^- \[r1\] insertion/m);
    assert.match(result.markdown, /^- \[r2\] insertion/m);
    assert.doesNotMatch(result.markdown, /\[r3\]|\[r4\]/);
    assert.match(result.markdown, /Truncated: blocks 1-25 of 40 shown/);
    assert.match(result.markdown, /^> Review reading: 2 tracked changes and 0 comments are marked below/m);
  });

  test("a range holding none of the document's revisions says the others hold them", async () => {
    const { markdown } = await review(docx(long), { blocks: "1-5" });

    assert.match(markdown, /the blocks shown hold no tracked change or comment; other blocks of this document do/);
  });
});

describe("ReviewMarkersCannotBeForged", () => {
  test("DocumentTextLookingLikeAMarker: escaped, and nothing reported for it", async () => {
    const { markdown } = await review(docx(p(r("{++approuvé++}[r1]"))));

    assert.match(markdown, /^\\\{\+\+approuvé\+\+\\\}\\\[r1\]$/m);
    assert.doesNotMatch(markdown, /Review layer/);
  });

  test("a marker split across runs is still escaped", async () => {
    const { markdown } = await review(docx(p(r("{"), r("--"), r("faux"), r("--"), r("}"))));

    assert.match(markdown, /^\\\{--faux--\\\}$/m);
  });

  test("the default reading's text is left exactly as it was", async () => {
    const { markdown } = await extractDocx(docx(p(r("{++approuvé++}[r1]"))));

    assert.equal(markdown, "{++approuvé++}[r1]");
  });
});

describe("ReviewReadingIsAnnouncedBeforeTheContent", () => {
  test("ReviewLegendLeads: counts and the meaning of every marker, before the text", async () => {
    const body = [h(1, "Exigences"), delayEdit, p(ins(r("nouveau"), by("B", "2026-01-01T00:00:00Z", 9))), p(anchored(r("45 jours"), [0]))].join("");
    const { markdown } = await review(docx(body, { comments: [threadComments[0]] }));

    const first = markdown.split("\n\n")[0];
    assert.match(first, /^> Review reading: 3 tracked changes and 1 comment are marked below\./);
    for (const marker of ["`{++text++}`", "`{--text--}`", "`{==text==}`", "`[rN]`", "`[mN]`", "`[cN]`"]) {
      assert.ok(first.includes(marker), `${marker} is explained`);
    }
    assert.ok(markdown.indexOf(first) < markdown.indexOf("# Exigences"));
  });
});

describe("DefaultReadingAnnouncesTheReviewLayer", () => {
  test("HintNamesTheParameter: whole-document counts, before the content", async () => {
    const body = SPEC + p(anchored(r("45 jours"), [0]));
    const { markdown } = await extractDocx(docx(body, { comments: [threadComments[0]] }), { blocks: "1" });

    assert.match(markdown, /^> This document holds 4 tracked changes and 1 comment that this reading does not show/);
    assert.match(markdown, /Pass review: true/);
  });

  test("NoReviewLayerNoHint: formatting changes alone announce nothing", async () => {
    const body = p(`<w:r><w:rPr><w:b/><w:rPrChange ${by("J. Martin", "2026-10-12T09:30:00Z", 130)}><w:rPr/></w:rPrChange></w:rPr><w:t>important</w:t></w:r>`);
    const { markdown } = await extractDocx(docx(body));

    assert.equal(markdown, "**important**");
  });
});

describe("ReportEmptyDocument and the review reading", () => {
  test("ContentOutsideTheBody: comments are named as unread only outside the review reading", async () => {
    const accepted = await extractDocx(docx(""));
    const reviewed = await review(docx(""));

    assert.match(accepted.markdown, /Headers, footers, footnotes, comments and text boxes are not read/);
    assert.match(reviewed.markdown, /Headers, footers, footnotes and text boxes are not read/);
  });
});

/**
 * A document edited in Office for the web, not built here: the one fixture whose
 * markup this reader did not write. It carries what hand-built packages miss —
 * a deleted row whose cells hold ordinary runs, an inserted row whose cells each
 * carry their own insertion, a comment on a localized heading style, `w16du`
 * dates with milliseconds.
 */
describe("a document reviewed in Office for the web", () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "docx-review-office-web.docx");
  const read = async () => new Uint8Array(await readFile(file));

  test("the accepted reading drops the deleted row and announces the review layer", async () => {
    const { markdown } = await extractDocx(await read());

    assert.match(markdown, /^> This document holds 6 tracked changes and 1 comment/);
    assert.doesNotMatch(markdown, /Routes|PowerPoint deck/);
    assert.match(markdown, /^\| Mermaid renderer \| Albert \| done \|$/m);
    assert.match(markdown, /^\| New package \| Arthur \| In progress \|$/m);
  });

  test("the review reading marks every change once, rows as one change each", async () => {
    const { markdown } = await extractDocx(await read(), { review: true });

    assert.match(markdown, /tool server \{\+\+and for Claude Desktop\+\+\}\[r1\] from one call/);
    assert.match(markdown, /^\{--a PowerPoint deck from slides;--\}\[r2\]$/m);
    assert.match(markdown, /^\| \{\+\+New package\+\+\}\[r3\] \| \{\+\+Arthur\+\+\}\[r3\] \| \{\+\+In progress\+\+\}\[r3\] \|$/m);
    assert.match(markdown, /^\| Mermaid renderer \| \{--Laurent--\}\[r4\]\{\+\+Albert\+\+\}\[r5\] \| done \|$/m);
    assert.match(markdown, /^\| \{--Routes--\}\[r6\] \| \{--Laurent--\}\[r6\] \| \{--next--\}\[r6\] \|$/m);
    assert.match(markdown, /^## \{==Who talks to whom==\}\[c1\]$/m);

    assert.match(markdown, /^- \[r3\] table row insertion — Laurent FRANCOISE, 2026-10-21 — Rollout of the office tools > What ships$/m);
    assert.match(markdown, /^- \[r6\] table row deletion — /m);
    assert.match(
      markdown,
      /^- \[c1\] comment, open — Laurent FRANCOISE, 2026-10-21 — Rollout of the office tools > Who talks to whom: « Not sure of this diagram\. We need to discuss about that\. »$/m,
    );
  });
});

/**
 * A document reviewed in desktop Word (`scripts/probes/make-docx-review-desktop.mts`):
 * what Office for the web cannot be relied on to record. A paragraph moved between
 * sections, as named move ranges; a heading restyled to body text, whose `w:pPrChange`
 * keeps the old localized style (`Titre2`); strikethrough removed, kept in `w:rPrChange`;
 * a comment with two replies, marked resolved in `commentsExtended.xml`. Four authors.
 */
describe("a document reviewed in desktop Word", () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "docx-review-desktop.docx");
  const read = async () => new Uint8Array(await readFile(file));

  test("the accepted reading: moved text once, the restyled heading as body text, no strike", async () => {
    const { markdown } = await extractDocx(await read());

    assert.match(markdown, /^> This document holds 1 tracked change and 1 comment /);
    assert.equal(markdown.split("Les factures sont archivées dix ans.").length - 1, 1);
    assert.match(markdown, /## Exploitation\n\nLe portail accepte le paiement par chèque et le virement\.\n\nLes factures sont archivées dix ans\.\n\nLes sauvegardes/);
    // The previous style is not read: no heading, no section named after it.
    assert.match(markdown, /^Contexte réglementaire$/m);
    assert.doesNotMatch(markdown, /#+ Contexte réglementaire/);
    assert.doesNotMatch(markdown, /~~/);
  });

  test("the review reading: the move at both ends with its sections, the resolved thread with its replies", async () => {
    const { markdown } = await extractDocx(await read(), { review: true });

    assert.match(markdown, /^## Exigences\n\nLe fournisseur dépose ses factures au format PDF\.\n\n\{--Les factures sont archivées dix ans\.--\}\[m1\]$/m);
    assert.match(markdown, /^\{\+\+Les factures sont archivées\+\+\}\[m1\] \{==\{\+\+dix ans\+\+\}\[m1\]==\}\[c1\]\{\+\+\.\+\+\}\[m1\]$/m);
    // Formatting changes are not marked, and their previous state is not read either.
    assert.match(markdown, /^Contexte réglementaire$/m);
    assert.match(markdown, /^Le portail accepte le paiement par chèque et le virement\.$/m);
    assert.doesNotMatch(markdown, /~~|\[r\d+\]/);

    assert.match(markdown, /^- \[m1\] moved — Alice Martin, 2026-10-22 — from Portail fournisseurs > Exigences to Portail fournisseurs > Exploitation$/m);
    assert.match(
      markdown,
      /^- \[c1\] comment, resolved — Chloé Durand, 2026-10-22 — Portail fournisseurs > Exploitation: « Dix ans, ou la durée légale \? »\n {4}- reply — Alice Martin, 2026-10-22: « Dix ans est la durée légale\. »\n {4}- reply — Bruno Petit, 2026-10-22: « D'accord, je clos\. »$/m,
    );
  });
});
