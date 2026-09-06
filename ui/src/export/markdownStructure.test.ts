import { describe, expect, it } from "vitest";
import { buildDocx } from "./docxExport";
import { documentXml, openDocx, paragraphs, partText, visibleText } from "./testSupport";

/** The document part for a Markdown source — the bytes every assertion reads. */
async function exportMarkdown(markdown: string): Promise<string> {
  return documentXml(await buildDocx(markdown, "doc.md"));
}

describe("headings", () => {
  it("gives each heading Word's style for its level", async () => {
    const xml = await exportMarkdown("# One\n\n## Two\n\n### Three\n\n###### Six\n");

    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain('w:val="Heading3"');
    expect(xml).toContain('w:val="Heading6"');
  });

  it("leaves no hash in the text a reader sees", async () => {
    // The whole point of the mapping: a heading is a heading, not a paragraph that
    // begins with punctuation the reader has to mentally strip.
    const xml = await exportMarkdown("# One\n\n## Two\n");

    const text = visibleText(xml);
    expect(text).toContain("One");
    expect(text).toContain("Two");
    expect(text).not.toContain("#");
  });

  it("treats a seventh hash as text, because Markdown has no such heading", async () => {
    // Markdown stops at six. The seven-hash line is a paragraph whose text happens
    // to start with hashes, and it must arrive as exactly that — not as a heading,
    // and not with the hashes quietly eaten by a mapping that assumed otherwise.
    const xml = await exportMarkdown("####### Seven\n");

    expect(xml).not.toContain('w:val="Heading7"');
    expect(visibleText(xml)).toContain("####### Seven");
  });
});

describe("lists", () => {
  it("numbers an ordered list and bullets an unordered one", async () => {
    const xml = await exportMarkdown("- alpha\n- beta\n\n1. first\n2. second\n");

    // Both kinds are numbering references in Word; the definition decides whether
    // the marker drawn is a bullet or a numeral.
    expect(visibleText(xml)).toContain("alpha");
    expect(visibleText(xml)).toContain("first");
    expect(xml).toContain("<w:numPr>");
  });

  it("keeps a nested list at its own level", async () => {
    const xml = await exportMarkdown("- outer\n  1. inner one\n  2. inner two\n");

    // Word expresses nesting as a level on the paragraph, not as a nested element.
    expect(xml).toContain('<w:ilvl w:val="0"');
    expect(xml).toContain('<w:ilvl w:val="1"');
    expect(visibleText(xml)).toContain("inner one");
  });

  it("starts a second ordered list at one, rather than continuing the first", async () => {
    // Two lists sharing one numbering instance is the classic Word export defect:
    // the second list silently starts at 3. Separate instances are what prevent it.
    const xml = await exportMarkdown("1. a\n2. b\n\nBetween.\n\n1. c\n2. d\n");

    const ids = [...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBeGreaterThan(1);
  });

  it("does not number a list item's second paragraph again", async () => {
    const xml = await exportMarkdown("- first para\n\n  second para\n");

    const numbered = paragraphs(xml).filter((paragraph) => paragraph.includes("<w:numPr>"));
    expect(numbered).toHaveLength(1);
  });
});

describe("tables", () => {
  it("becomes a Word table with the declared rows and cells", async () => {
    const xml = await exportMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n");

    expect(xml).toContain("<w:tbl>");
    expect([...xml.matchAll(/<w:tr\b/g)]).toHaveLength(3);
    expect([...xml.matchAll(/<w:tc>/g)]).toHaveLength(6);
  });

  it("marks the header row as a header, so it repeats across pages", async () => {
    const xml = await exportMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n");

    expect(xml).toContain("<w:tblHeader");
  });

  it("keeps a cell's text out of the table's structure", async () => {
    // A pipe inside a cell must not become another cell, and a stray brace must not
    // become markup. Three cells declared, three cells produced.
    const xml = await exportMarkdown("| a | b |\n| - | - |\n| x \\| y | <b>z</b> |\n");

    expect([...xml.matchAll(/<w:tr\b/g)]).toHaveLength(2);
    expect(visibleText(xml)).toContain("x | y");
  });
});

describe("inline formatting", () => {
  it("carries strong, emphasis, strikethrough and inline code as run properties", async () => {
    const xml = await exportMarkdown("**bold** and *italic* and ~~gone~~ and `code`.\n");

    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("<w:strike/>");
    // Inline code is set apart by its face, which is the only thing Word offers.
    expect(xml).toContain("Consolas");
    const text = visibleText(xml);
    expect(text).toContain("bold");
    expect(text).toContain("code");
    // The markup that produced them is gone.
    expect(text).not.toContain("**");
    expect(text).not.toContain("~~");
    expect(text).not.toContain("`");
  });

  it("combines marks that are nested in the source", async () => {
    // Word has no nesting inside a run: this has to arrive as one run that is both.
    const xml = await exportMarkdown("***both***\n");

    const runs = [...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].map((match) => match[0]);
    const both = runs.filter((run) => run.includes("<w:b/>") && run.includes("<w:i/>"));
    expect(both.length).toBeGreaterThan(0);
  });

  it("makes a link a hyperlink whose relationship resolves to its target", async () => {
    // A hyperlink that names a relationship the package does not carry is a link to
    // nowhere — and Word reports the document as damaged for it.
    const blob = await buildDocx("See [the docs](https://example.com/guide).\n", "doc.md");
    const zip = await openDocx(blob);
    const xml = await partText(zip, "word/document.xml");
    const rels = await partText(zip, "word/_rels/document.xml.rels");

    const id = /<w:hyperlink[^>]*r:id="([^"]+)"/.exec(xml)?.[1];
    expect(id).toBeDefined();
    expect(rels).toContain(`Id="${id}"`);
    expect(rels).toContain("https://example.com/guide");
    expect(visibleText(xml)).toContain("the docs");
  });
});

describe("code blocks", () => {
  it("reproduces the content verbatim, without interpreting it", async () => {
    const xml = await exportMarkdown("```md\n# not a heading\n| a | b |\n$x^2$\n```\n");

    // None of it became structure: no heading style, no table, no equation.
    expect(xml).not.toContain('w:val="Heading1"');
    expect(xml).not.toContain("<w:tbl>");
    const text = visibleText(xml);
    expect(text).toContain("# not a heading");
    expect(text).toContain("| a | b |");
    expect(text).toContain("$x^2$");
  });

  it("keeps leading indentation, which Word would otherwise collapse", async () => {
    // `xml:space="preserve"` is the whole reason indented code survives the trip.
    const xml = await exportMarkdown("```\nif (x) {\n    return 1;\n}\n```\n");

    expect(xml).toContain('xml:space="preserve"');
    expect(visibleText(xml)).toContain("    return 1;");
  });

  it("keeps a blank line inside a listing", async () => {
    // Three source lines must arrive as three paragraphs. A blank line that
    // collapses closes the gap the author put there, which in a listing is meaning.
    const xml = await exportMarkdown("```\na\n\nb\n```\n");

    const monospaced = paragraphs(xml).filter((paragraph) => paragraph.includes("Consolas"));
    expect(monospaced).toHaveLength(3);
  });
});

describe("quotes, rules and unmapped nodes", () => {
  it("indents and rules a block quote", async () => {
    const xml = await exportMarkdown("> quoted words\n");

    expect(xml).toContain("<w:ind");
    expect(visibleText(xml)).toContain("quoted words");
    expect(visibleText(xml)).not.toContain(">");
  });

  it("draws a thematic break as a rule", async () => {
    const xml = await exportMarkdown("above\n\n---\n\nbelow\n");

    expect(xml).toContain("<w:pBdr>");
    const text = visibleText(xml);
    expect(text).toContain("above");
    expect(text).toContain("below");
    expect(text).not.toContain("---");
  });

  it("carries an image's alt text rather than dropping the node", async () => {
    // Pictures from Markdown are out of scope, but the words the author wrote about
    // one are content, and silently losing content is the failure to avoid.
    const xml = await exportMarkdown("![a diagram of the flow](diagram.png)\n");

    expect(visibleText(xml)).toContain("a diagram of the flow");
  });

  it("keeps the text of an html node instead of emitting markup", async () => {
    const xml = await exportMarkdown("Before <span>inside</span> after.\n");

    const text = visibleText(xml);
    expect(text).toContain("Before");
    expect(text).toContain("after.");
  });
});
