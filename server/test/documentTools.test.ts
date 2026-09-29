/**
 * Which extractors a prompt calls for. The four schemas are some 8 000 characters —
 * around a quarter of a session's prompt floor — so what this decides is whether every
 * later request in the conversation carries them.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DOCUMENT_TOOLS,
  documentToolsFor,
  documentToolsForToolCall,
  documentToolsForWrittenPaths,
  PRESENTATION_TOOLS,
  WORD_TOOLS,
} from "../src/documentTools.ts";

describe("documentToolsFor", () => {
  test("a named document publishes its own extractor and no other", () => {
    // pdf_render travels with the extractor: a page carrying neither text nor an image
    // tells the caller to draw it, and that advice is worthless if the tool it names was
    // never offered. Registering a tool is not publishing it — this was found by driving
    // the real server, where the tool existed, worked, and never reached the model.
    assert.deepEqual(documentToolsFor("Read report.pdf and summarise it"), ["pdf_extract", "pdf_render"]);
    // A Word document may be read, updated or written from, so it brings the Word tools.
    assert.deepEqual(documentToolsFor("What does notes.docx say?"), ["docx_extract", ...WORD_TOOLS]);
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
      assert.deepEqual(documentToolsFor(text), ["pdf_extract", "pdf_render"], text);
    }
  });

  test("case does not matter: a Windows share shouts", () => {
    assert.deepEqual(documentToolsFor("@/mnt/share/Q3.XLSX please"), ["xlsx_extract"]);
    assert.deepEqual(documentToolsFor("REPORT.PDF"), ["pdf_extract", "pdf_render"]);
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
    assert.deepEqual(documentToolsFor("see notes.docx and slides.pptx"), ["docx_extract", ...WORD_TOOLS, "pptx_extract", ...PRESENTATION_TOOLS]);
    assert.deepEqual(documentToolsFor("a.pdf, b.docx."), ["pdf_extract", "pdf_render", "docx_extract", ...WORD_TOOLS]);
  });

  test("the same document twice publishes one tool", () => {
    assert.deepEqual(documentToolsFor("compare a.pdf with b.pdf"), ["pdf_extract", "pdf_render"]);
  });

  test("the exported set is what the server withholds and republishes", () => {
    // A tool added to one list and not the other would be published to everyone
    // forever, or withheld from everyone forever.
    assert.deepEqual(DOCUMENT_TOOLS, [
      "pdf_extract",
      "pdf_render",
      "docx_extract",
      "docx_styles",
      "docx_create",
      "docx_update",
      "docx_restyle",
      "docx_render",
      "xlsx_extract",
      "pptx_extract",
      "pptx_layouts",
      "pptx_create",
      "pptx_update",
      "pptx_render",
      "mail_extract",
    ]);
    // Not generated from the extension any more: a PDF brings its renderer as well as
    // its extractor, so the one-tool-per-kind shortcut no longer describes the map.
    assert.deepEqual(documentToolsFor("file.xlsx"), ["xlsx_extract"]);
    assert.deepEqual(documentToolsFor("file.pdf"), ["pdf_extract", "pdf_render"]);
  });
});

describe("Word tools", () => {
  test("NamingAWordTemplatePublishesTheTools: a .dotx publishes the Word tools, and not the extractor", () => {
    assert.deepEqual(documentToolsFor("Write the report from house.dotx"), ["docx_styles", "docx_create", "docx_update", "docx_restyle", "docx_render"]);
    assert.deepEqual(documentToolsFor("@C:\\Templates\\Corporate.DOTX"), WORD_TOOLS);
  });

  test("invoking the Word skill by name publishes them before any file is named", () => {
    assert.deepEqual(documentToolsFor("/skill:docx-from-template turn notes.md into a report"), WORD_TOOLS);
  });

  test("ReadingTheSkillPublishesTheToolsWithinTheTurn: reading the skill, or a Word path in a call, calls for them", () => {
    assert.deepEqual(documentToolsForToolCall("read", { path: "/opt/skills/docx-from-template/SKILL.md" }), WORD_TOOLS);
    assert.deepEqual(documentToolsForToolCall("find", { path: "templates/house.dotx" }), WORD_TOOLS);
    assert.deepEqual(documentToolsForToolCall("read", { path: "C:\\docs\\Report.DOCX" }), WORD_TOOLS);
    // The extractor stays the user's to bring back by naming a document.
    assert.ok(!documentToolsForToolCall("read", { path: "report.docx" }).includes("docx_extract"));
  });
});

describe("mail tools", () => {
  test("a named message publishes the mail extractor and nothing else", () => {
    for (const text of [
      "read Bienvenue.msg",
      "@uploads/dossier.eml",
      "what does /Users/laurent/Library/Mail/message.emlx say?",
      'open "Réunion de mardi.msg"',
      "C:\\\\Users\\\\laurent\\\\Bienvenue.MSG",
    ]) {
      assert.deepEqual(documentToolsFor(text), ["mail_extract"], text);
    }
  });

  test("talking about email publishes nothing", () => {
    // A `.msg` says nothing about what it carries, so naming one must not publish the
    // extractors for the formats it might hold either.
    for (const text of [
      "forward me the mail",
      "can you read my outlook messages?",
      "we support msg and eml",
      "refactor src/mail.ts",
      "the .eml format is MIME",
    ]) {
      assert.deepEqual(documentToolsFor(text), [], text);
    }
  });

  test("a message alongside a document publishes both, in registration order", () => {
    assert.deepEqual(documentToolsFor("compare report.pdf with Bienvenue.msg"), ["pdf_extract", "pdf_render", "mail_extract"]);
  });

  test("WrittenAttachmentPublishesItsExtractor: a document this system wrote publishes its reader", () => {
    assert.deepEqual(documentToolsForWrittenPaths(["uploads/m.msg.attachments/1-deck.pptx"]), ["pptx_extract"]);
    assert.deepEqual(documentToolsForWrittenPaths(["uploads/m.eml.attachments/2-rapport.pdf"]), ["pdf_extract", "pdf_render"]);
    assert.deepEqual(documentToolsForWrittenPaths(["a.docx"]), ["docx_extract"]);
    assert.deepEqual(documentToolsForWrittenPaths(["b.xlsx"]), ["xlsx_extract"]);
    // A message carried inside a message is read by the same tool.
    assert.deepEqual(documentToolsForWrittenPaths(["fwd.eml"]), ["mail_extract"]);
  });

  test("only the extractor: unpacking a deck is not a reason to start writing one", () => {
    // The authoring tools travel with the extractor when a *template* is named. An
    // attachment is not a template, and publishing five tools for a file the agent
    // wants to read would cost the rest of the session.
    const published = documentToolsForWrittenPaths(["1-deck.pptx", "2-notes.docx"]);
    assert.deepEqual(published, ["docx_extract", "pptx_extract"]);
    for (const tool of [...PRESENTATION_TOOLS, ...WORD_TOOLS]) {
      assert.ok(!published.includes(tool), `${tool} must not be published by a write`);
    }
  });

  test("only the kinds actually written", () => {
    assert.deepEqual(documentToolsForWrittenPaths(["1-rapport.pdf"]), ["pdf_extract", "pdf_render"]);
    assert.ok(!documentToolsForWrittenPaths(["1-rapport.pdf"]).includes("pptx_extract"));
  });

  test("a path the agent merely names publishes nothing", () => {
    // Listing a directory that holds a spreadsheet, or reading a PDF by path, is not a
    // write: the extractor stays the user's to bring back by naming the document. Only
    // a document this system wrote reaches documentToolsForWrittenPaths.
    assert.deepEqual(documentToolsForToolCall("ls", { path: "reports/budget.xlsx" }), []);
    assert.deepEqual(documentToolsForToolCall("read", { path: "reports/annual.pdf" }), []);
    assert.deepEqual(documentToolsForToolCall("find", { path: "inbox/Bienvenue.msg" }), []);
  });

  test("a path with no document extension publishes nothing", () => {
    assert.deepEqual(documentToolsForWrittenPaths(["1-notes.txt", "2-image001.png", "3-nameless"]), []);
    assert.deepEqual(documentToolsForWrittenPaths([]), []);
  });

  test("a Windows path is understood, and case does not matter", () => {
    assert.deepEqual(documentToolsForWrittenPaths(["uploads\\m.msg.attachments\\1-DECK.PPTX"]), ["pptx_extract"]);
  });
});

describe("presentation tools", () => {
  test("UpdateComesWithTheOtherPresentationTools: a .pptx brings pptx_update with the layouts, create and render tools", () => {
    // Spelled out, not read back from the constant: a tool dropped from the list must fail here.
    assert.deepEqual(documentToolsFor("Revise deck.pptx"), ["pptx_extract", "pptx_layouts", "pptx_create", "pptx_update", "pptx_render"]);
  });

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
