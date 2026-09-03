/**
 * Which extractors a prompt calls for. The four schemas are some 8 000 characters —
 * around a quarter of a session's prompt floor — so what this decides is whether every
 * later request in the conversation carries them.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DOCUMENT_TOOLS, documentToolsFor } from "../src/documentTools.ts";

describe("documentToolsFor", () => {
  test("a named document publishes its own extractor and no other", () => {
    assert.deepEqual(documentToolsFor("Read report.pdf and summarise it"), ["pdf_extract"]);
    assert.deepEqual(documentToolsFor("What does notes.docx say?"), ["docx_extract"]);
    assert.deepEqual(documentToolsFor("Open budget.xlsx"), ["xlsx_extract"]);
    assert.deepEqual(documentToolsFor("Check deck.pptx"), ["pptx_extract"]);
  });

  test("a mention is matched wherever a path can appear", () => {
    // `@path` is what the composer appends for an attachment, absolute after the server
    // resolves it; quotes and Windows separators are what users paste.
    for (const text of [
      "@/srv/projects/acme/report.pdf",
      'open "my report.pdf"',
      "C:\\\\Users\\\\laurent\\\\report.pdf",
      "see ./docs/report.pdf, then tell me",
      "read report.pdf.",
    ]) {
      assert.deepEqual(documentToolsFor(text), ["pdf_extract"], text);
    }
  });

  test("case does not matter: a Windows share shouts", () => {
    assert.deepEqual(documentToolsFor("@/mnt/share/Q3.XLSX please"), ["xlsx_extract"]);
    assert.deepEqual(documentToolsFor("REPORT.PDF"), ["pdf_extract"]);
  });

  test("the word is not the path", () => {
    // The whole point of the trigger. Publishing on the bare word would put all four
    // back into every conversation that merely discusses documents.
    for (const text of [
      "convert this to PDF",
      "the pdf spec is long",
      "refactor src/pdf.ts",
      "docx handling is a mess",
      "we support pdf, docx, xlsx and pptx",
    ]) {
      assert.deepEqual(documentToolsFor(text), [], text);
    }
  });

  test("two kinds in one prompt publish two tools, in registration order", () => {
    assert.deepEqual(documentToolsFor("see notes.docx and slides.pptx"), ["docx_extract", "pptx_extract"]);
    assert.deepEqual(documentToolsFor("a.pdf, b.docx."), ["pdf_extract", "docx_extract"]);
  });

  test("the same document twice publishes one tool", () => {
    assert.deepEqual(documentToolsFor("compare a.pdf with b.pdf"), ["pdf_extract"]);
  });

  test("the exported set is what the server withholds and republishes", () => {
    // A fifth extractor added to one list and not the other would be published to
    // everyone forever, or withheld from everyone forever.
    assert.deepEqual(DOCUMENT_TOOLS, ["pdf_extract", "docx_extract", "xlsx_extract", "pptx_extract"]);
    for (const tool of DOCUMENT_TOOLS) {
      const extension = tool.replace("_extract", "");
      assert.deepEqual(documentToolsFor(`file.${extension}`), [tool], tool);
    }
  });
});
