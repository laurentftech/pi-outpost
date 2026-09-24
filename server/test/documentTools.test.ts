/**
 * Which extractors a prompt calls for. The four schemas are some 8 000 characters —
 * around a quarter of a session's prompt floor — so what this decides is whether every
 * later request in the conversation carries them.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DOCUMENT_TOOLS, documentToolsFor, documentToolsForToolCall, PRESENTATION_TOOLS } from "../src/documentTools.ts";

describe("documentToolsFor", () => {
  test("a named document publishes its own extractor and no other", () => {
    assert.deepEqual(documentToolsFor("Read report.pdf and summarise it"), ["pdf_extract"]);
    assert.deepEqual(documentToolsFor("What does notes.docx say?"), ["docx_extract"]);
    assert.deepEqual(documentToolsFor("Open budget.xlsx"), ["xlsx_extract"]);
    // A deck may be read or be the template of a new one, so it brings the presentation tools.
    assert.deepEqual(documentToolsFor("Check deck.pptx"), ["pptx_extract", ...PRESENTATION_TOOLS]);
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
    assert.deepEqual(documentToolsFor("see notes.docx and slides.pptx"), ["docx_extract", "pptx_extract", ...PRESENTATION_TOOLS]);
    assert.deepEqual(documentToolsFor("a.pdf, b.docx."), ["pdf_extract", "docx_extract"]);
  });

  test("the same document twice publishes one tool", () => {
    assert.deepEqual(documentToolsFor("compare a.pdf with b.pdf"), ["pdf_extract"]);
  });

  test("the exported set is what the server withholds and republishes", () => {
    // A tool added to one list and not the other would be published to everyone
    // forever, or withheld from everyone forever.
    assert.deepEqual(DOCUMENT_TOOLS, ["pdf_extract", "docx_extract", "xlsx_extract", "pptx_extract", "pptx_layouts", "pptx_create", "pptx_render"]);
    for (const extension of ["pdf", "docx", "xlsx"]) {
      assert.deepEqual(documentToolsFor(`file.${extension}`), [`${extension}_extract`], extension);
    }
  });
});

describe("presentation tools", () => {
  test("a template publishes the tools that build from it, and not the extractor", () => {
    assert.deepEqual(documentToolsFor("Make a deck from brand.potx"), PRESENTATION_TOOLS);
    assert.deepEqual(documentToolsFor("@C:\\Templates\\Corporate.POTX"), PRESENTATION_TOOLS);
  });

  test("invoking the skill by name publishes them before any file is named", () => {
    assert.deepEqual(documentToolsFor("/skill:pptx-from-template turn notes.md into slides"), PRESENTATION_TOOLS);
    assert.deepEqual(documentToolsFor("please /skill:pptx-from-template"), PRESENTATION_TOOLS);
  });

  test("talking about presentations publishes nothing", () => {
    for (const text of ["make me a presentation", "the powerpoint template is nice", "/skill:pptx-from-templates", "potx files"]) {
      assert.deepEqual(documentToolsFor(text), [], text);
    }
  });

  test("reading the skill's SKILL.md publishes them inside the turn", () => {
    assert.deepEqual(documentToolsForToolCall("read", { path: "/opt/pi-outpost/skills/pptx-from-template/SKILL.md" }), PRESENTATION_TOOLS);
    assert.deepEqual(documentToolsForToolCall("read", { path: "C:\\pi\\skills\\pptx-from-template\\SKILL.md" }), PRESENTATION_TOOLS);
    // Another skill, or the same file reached by another tool, is not loading it.
    assert.deepEqual(documentToolsForToolCall("read", { path: "/skills/structured-exchange/SKILL.md" }), []);
    assert.deepEqual(documentToolsForToolCall("grep", { path: "/skills/pptx-from-template/SKILL.md" }), []);
  });

  test("a tool call reaching a deck or a template publishes the presentation tools, never the extractor", () => {
    assert.deepEqual(documentToolsForToolCall("ls", { path: "templates/brand.potx" }), PRESENTATION_TOOLS);
    // The extractor stays the user's to bring back by naming the document.
    assert.deepEqual(documentToolsForToolCall("read", { path: "deck.PPTX" }), PRESENTATION_TOOLS);
    assert.deepEqual(documentToolsForToolCall("read", { path: "notes.md" }), []);
    assert.deepEqual(documentToolsForToolCall("bash", { command: "ls *.potx" }), []);
    assert.deepEqual(documentToolsForToolCall("read", null), []);
  });
});
