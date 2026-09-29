/**
 * A reviewed PDF's comments: the annotations outside its text layer.
 *
 * `fixtures/pdf-comments.pdf` is a contract whose review is entirely in annotations —
 * see `commentsDoc` in make-pdfs.mjs for what each one is and where it sits.
 * `pdf-comments-bare.pdf` is the same pages without them, and `pdf-comments-many.pdf`
 * a page with more notes than a page lists.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { extractPdf, loadPdfjs, pageAnnotations, PdfError, type TextPiece } from "../src/pdf.ts";
import { commentsNotice, commentsOf, MAX_REMARK_CHARS, pdfDate, renderComments, textUnder, wordAtCaret } from "../src/pdfComments.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, `${name}.pdf`)));
}

/** One page's section of the extraction: from its heading to the next page's. */
function pageSection(markdown: string, page: number): string {
  const start = markdown.indexOf(`## Page ${page}\n`);
  assert.ok(start >= 0, `page ${page} is in the extraction`);
  const next = markdown.indexOf("\n## Page ", start + 1);
  return markdown.slice(start, next === -1 ? undefined : next);
}

/** The comments block of a section, or "" when it has none. */
function commentsBlock(section: string): string {
  const at = section.indexOf("### Comments on page");
  return at === -1 ? "" : section.slice(at);
}

describe("pdf_extract and a document's review comments", () => {
  test("ANoteIsReturnedWithItsPage: page 2's note, with its author, date and remark, and on no other page", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-comments"), { mode: "text" });
    const page2 = commentsBlock(pageSection(markdown, 2));

    assert.match(page2, /^### Comments on page 2\n\n- \*\*Note\*\* — Paul Martin, 2026-09-14:\n {2}> Missing the annex reference\.$/m);
    assert.doesNotMatch(pageSection(markdown, 1), /Missing the annex reference/);
    // A text box is a comment too, and its words come back once: the page's text layer
    // does not carry them (checked in pdf.js 6.2.108), so only the comment does.
    assert.match(page2, /- \*\*Text box\*\* — Paul Martin, 2026-09-14:\n {2}> Check the totals\./);
    assert.equal(markdown.split("Check the totals.").length - 1, 1);
  });

  test("RepliesAndStatesFollowTheirComment: the reply and the Accepted state sit under the highlight, not beside it", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-comments"), { mode: "text" });
    const page1 = commentsBlock(pageSection(markdown, 1));

    assert.ok(
      page1.includes(
        [
          '- **Highlight** — Marie Dupont, 2026-09-12, on "the delivery date":',
          "  > To confirm with the client.",
          "  - **Reply** — Paul Martin, 2026-09-13:",
          "    > Confirmed by phone.",
          "  - State: **Accepted** — Paul Martin, 2026-09-14",
        ].join("\n"),
      ),
      page1,
    );
    // Neither the reply nor the state is a comment of its own, and the state's own
    // remark ("Accepted set by…") is what the state line already says.
    assert.equal(page1.match(/^- /gm)?.length, 5, page1);
    // Top of the page first. The fixture happens to list them in that order too;
    // "comments are listed in reading order…" below is what shows the sorting.
    assert.deepEqual(
      [...page1.matchAll(/^- \*\*([^*]+)\*\*.*?(?:on|before) "([^"]+)"|^- \*\*(Note)\*\* — (Mallory)/gm)].map((match) => match[2] ?? match[4]),
      ["the delivery date", "in any event", "lists", "the contract value", "Mallory"],
    );
    assert.doesNotMatch(page1, /Accepted set by/);
    // A reply on another page than its comment is kept, and says so.
    assert.match(
      commentsBlock(pageSection(markdown, 2)),
      /^- \*\*Reply\*\* \(to a comment not on this page\) — Marie Dupont, 2026-09-15:\n {2}> Still waiting on the client\.$/m,
    );
  });

  test("SuggestionsAreNamed: a strike-out and a caret without a remark are the reviewer's suggestions", async () => {
    const page1 = commentsBlock(pageSection((await extractPdf(await fixture("pdf-comments"), { mode: "text" })).markdown, 1));

    assert.match(page1, /^- \*\*Suggested deletion\*\* — Marie Dupont, 2026-09-12, on "in any event"$/m);
    assert.match(page1, /^- \*\*Suggested insertion\*\* — Marie Dupont, 2026-09-12, before "lists"$/m);
  });

  test("WhatIsNotACommentIsLeftOut: no link, form field, popup, bare shape or grouped annotation is listed", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-comments"), { mode: "text" });

    assert.doesNotMatch(markdown, /example\.com|buyer_name|Shape|grouped with the note/);
    // The popup repeats its highlight's remark; it is listed once, under the highlight.
    assert.equal(markdown.split("To confirm with the client.").length - 1, 1);
    // Page 2's note has a shape grouped with it, which pdf.js reports carrying the
    // note's own remark: listed as the note, once.
    assert.equal(markdown.split("Missing the annex reference.").length - 1, 1);
  });

  test("ARemarkCannotPassForStructure: a remark reading like a page heading and a note stays quoted", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-comments"), { mode: "text" });

    assert.match(markdown, /^- \*\*Note\*\* — Mallory, 2026:\n {2}> ## Page 9\n {2}> > Truncated$/m);
    assert.doesNotMatch(markdown, /^## Page 9/m);
    assert.doesNotMatch(markdown, /^> Truncated/m);
    assert.deepEqual([...markdown.matchAll(/^## Page (\d+)$/gm)].map((match) => match[1]), ["1", "2"]);
  });

  test("TablesModeLeavesCommentsOut: no block, but the notice counts them and says how to read them", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-comments"), { mode: "tables" });

    assert.doesNotMatch(markdown, /Comments on page|Confirmed by phone/);
    assert.match(markdown, /^> This document carries 9 review comments .*They are not returned in tables mode: call again with mode "text" to read them\./);
  });

  test("AHighlightQuotesItsPassage: the three highlighted words, not the sentence around them", async () => {
    const page1 = commentsBlock(pageSection((await extractPdf(await fixture("pdf-comments"), { mode: "text" })).markdown, 1));

    assert.match(page1, /on "the delivery date":/);
    assert.doesNotMatch(page1, /on "[^"]*supplier|on "[^"]*June/);
  });

  test("AHighlightAcrossTwoLines: the end of one line and the start of the next, in reading order", async () => {
    const page1 = commentsBlock(pageSection((await extractPdf(await fixture("pdf-comments"), { mode: "text" })).markdown, 1));

    assert.match(page1, /^- \*\*Highlight\*\* — Paul Martin, 2026-09-13, on "the contract value":\n {2}> Too low for this contract\.$/m);
  });

  test("AnchoringLeavesTheTextAlone: every page reads exactly as it does without its annotations", async () => {
    for (const mode of ["text", "both"] as const) {
      const annotated = (await extractPdf(await fixture("pdf-comments"), { mode })).markdown;
      const bare = (await extractPdf(await fixture("pdf-comments-bare"), { mode })).markdown;
      for (const page of [1, 2]) {
        const section = pageSection(annotated, page);
        const content = section.slice(0, section.indexOf("\n\n### Comments on page"));
        assert.equal(content, pageSection(bare, page).trimEnd(), `page ${page}, mode ${mode}`);
      }
    }
  });

  test("CommentsAreAnnounced: the count leads, before the first page's content", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-comments"), { mode: "both" });

    assert.match(markdown, /^> This document carries 9 review comments \(notes, highlights, suggested changes\), listed under "Comments on page N" after each page's content\./);
    assert.ok(markdown.indexOf("review comments") < markdown.indexOf("## Page 1"));
    // Only the pages extracted are counted: page 2 alone has three.
    assert.match((await extractPdf(await fixture("pdf-comments"), { pages: "2", mode: "text" })).markdown, /^> This document carries 3 review comments/);
  });

  test("NoCommentsAnnounceNothing: a document without annotations has no notice and no block", async () => {
    for (const name of ["pdf-comments-bare", "pdf-text", "pdf-strike"]) {
      const { markdown } = await extractPdf(await fixture(name), { mode: "both" });
      assert.doesNotMatch(markdown, /review comment|Comments on page/, name);
    }
  });

  test("ManyCommentsAreCapped: 50 listed, and the other 10 counted", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-comments-many"), { mode: "text" });

    assert.equal(markdown.match(/^- \*\*Note\*\*/gm)?.length, 50);
    assert.match(markdown, /> Note number 50\.\n- _10 more comments on this page not listed\._$/);
    assert.doesNotMatch(markdown, /Note number 51\./);
    assert.match(markdown, /^> This document carries 60 review comments/);
  });

  test("UnreadableAnnotationsDoNotFailThePage: pdf.js failing to read them costs the comments, not the text", async () => {
    // No fixture makes pdf.js fail here, so its own page method is made to, for the
    // length of one real extraction.
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: await fixture("pdf-comments-bare") });
    const prototype = Object.getPrototypeOf(await (await task.promise).getPage(1)) as { getAnnotations: (...args: unknown[]) => Promise<unknown[]> };
    await task.destroy();
    const original = prototype.getAnnotations;
    let calls = 0;
    prototype.getAnnotations = async function (this: unknown, ...args: unknown[]) {
      calls++;
      if (calls === 1) throw new Error("the annotation dictionary is damaged");
      return original.apply(this, args);
    };
    let markdown: string;
    try {
      ({ markdown } = await extractPdf(await fixture("pdf-comments"), { mode: "text" }));
    } finally {
      prototype.getAnnotations = original;
    }

    assert.equal(calls, 2);
    const page1 = pageSection(markdown, 1);
    assert.match(page1, /The supplier confirms the delivery date by June\./);
    assert.match(page1, /_The comments on this page could not be read\._/);
    assert.match(commentsBlock(pageSection(markdown, 2)), /Missing the annex reference\./);
  });

  test("CommentReadingIsBounded: an annotation read that outruns the budget fails the call like any other read", async () => {
    const page = { getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: [], argsArray: [] }), getAnnotations: () => new Promise<never>(() => {}) };

    await assert.rejects(
      () => pageAnnotations(page as never, 1, 1),
      (error: unknown) => error instanceof PdfError && error.reason === "budget",
    );
    assert.equal(await pageAnnotations({ ...page, getAnnotations: async () => { throw new Error("no"); } } as never, 1000, 1), null);
  });
});

describe("reading comments", () => {
  const piece = (text: string, x: number, y: number, width: number, height = 12): TextPiece => ({ text, x, y, width, height });

  test("pdfDate: as much of the date as the file states, and nothing for what does not parse", () => {
    assert.equal(pdfDate("D:20260912143000+02'00'"), "2026-09-12");
    assert.equal(pdfDate("D:20260912"), "2026-09-12");
    assert.equal(pdfDate("20260912"), "2026-09-12");
    assert.equal(pdfDate("D:202609"), "2026-09");
    assert.equal(pdfDate("D:2026"), "2026");
    assert.equal(pdfDate("D:20261340"), undefined);
    assert.equal(pdfDate("D:20260900"), undefined);
    assert.equal(pdfDate("yesterday"), undefined);
    assert.equal(pdfDate(""), undefined);
    assert.equal(pdfDate(null), undefined);
  });

  test("comments are listed in reading order, whatever order the file lists them in", () => {
    const note = (id: string, text: string, rect: number[]) => ({ subtype: "Text", id, contentsObj: { str: text }, rect });
    const page = commentsOf([note("1R", "bottom", [50, 100, 60, 110]), note("2R", "top right", [300, 700, 310, 710]), note("3R", "top left", [50, 700, 60, 710])], []);

    assert.deepEqual(page.comments.map((comment) => comment.remark), ["top left", "top right", "bottom"]);
  });

  test("an orphan state, a reply loop and an empty reply are neither lost nor invented", () => {
    const at = { rect: [0, 0, 10, 10] };
    const page = commentsOf(
      [
        { subtype: "Text", id: "1R", contentsObj: { str: "A" }, inReplyTo: "2R", replyType: "R", ...at },
        { subtype: "Text", id: "2R", contentsObj: { str: "B" }, inReplyTo: "1R", replyType: "R", ...at },
        { subtype: "Text", id: "3R", contentsObj: { str: "" }, inReplyTo: "1R", replyType: "R", ...at },
        { subtype: "Text", id: "4R", contentsObj: { str: "Rejected set by X" }, inReplyTo: "9R", replyType: "R", state: "Rejected", ...at },
        { subtype: "Text", id: "5R", contentsObj: { str: "" }, ...at },
      ],
      [],
    );
    const rendered = renderComments(1, page);

    assert.match(rendered, /> A/);
    assert.match(rendered, /> B/);
    assert.match(rendered, /^- \*\*Review state\*\*:\n {2}> Rejected$/m);
    assert.equal(page.count, 3, rendered);
  });

  test("control and bidi-override characters are removed; author names and anchors stay on one line", () => {
    const page = commentsOf(
      [{ subtype: "Text", id: "1R", contentsObj: { str: "safe‮txt.exe\u0007" }, titleObj: { str: "Eve\n## Page 3" }, rect: [0, 0, 10, 10] }],
      [],
    );
    const rendered = renderComments(1, page);

    assert.match(rendered, /^- \*\*Note\*\* — Eve ## Page 3:\n {2}> safetxt\.exe$/m);
    assert.doesNotMatch(rendered, /^## Page 3/m);
  });

  test("a remark past the limit is cut, and says so", () => {
    const page = commentsOf([{ subtype: "Text", id: "1R", contentsObj: { str: "x".repeat(MAX_REMARK_CHARS + 50) }, rect: [0, 0, 10, 10] }], []);
    const rendered = renderComments(1, page);

    assert.ok(!rendered.includes("x".repeat(MAX_REMARK_CHARS + 1)));
    assert.match(rendered, /> _\[remark cut at 2000 characters\]_$/);
  });

  test("textUnder: a partial word is widened to the whole word, and a region over no text quotes nothing", () => {
    // "confirms the delivery" drawn at x=100: the box starts inside "the".
    const line = piece("confirms the delivery", 100, 700, 110);
    assert.equal(textUnder([{ x0: 152, x1: 210, y0: 697, y1: 711 }], [line]), "the delivery");
    assert.equal(textUnder([{ x0: 300, x1: 400, y0: 697, y1: 711 }], [line]), undefined);
    // A box that only grazes the line above or below does not claim it.
    assert.equal(textUnder([{ x0: 100, x1: 210, y0: 708, y1: 730 }], [line]), undefined);
  });

  test("wordAtCaret: the word after the caret, or the last one when the caret ends the line", () => {
    const line = piece("the prices", 100, 700, 55);
    assert.deepEqual(wordAtCaret({ x0: 97, x1: 103, y0: 697, y1: 703 }, [line]), { text: "the", relation: "before" });
    assert.deepEqual(wordAtCaret({ x0: 152, x1: 158, y0: 697, y1: 703 }, [line]), { text: "prices", relation: "after" });
    assert.equal(wordAtCaret({ x0: 100, x1: 106, y0: 300, y1: 306 }, [line]), undefined);
  });

  test("commentsNotice: nothing without comments, and the singular for one", () => {
    assert.equal(commentsNotice(0, "text"), "");
    assert.match(commentsNotice(1, "text"), /carries 1 review comment \(/);
  });
});
