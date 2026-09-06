import { describe, expect, it } from "vitest";
import { Math as MathEquation, Paragraph } from "docx";
import { latexToOmml, mathmlFor, UnsupportedMathError } from "./mathmlToOmml";
import { buildDocx } from "./docxExport";
import { documentXml, paragraphs, visibleText } from "./testSupport";

/**
 * The OMML a piece of LaTeX produces, as XML.
 *
 * Built through a real paragraph and a real package: the components are only
 * meaningful once the writer has serialised them, and asserting on the objects
 * would test that we constructed something rather than that Word receives it.
 */
async function ommlFor(latex: string, displayMode = false): Promise<string> {
  const source = displayMode ? `$$\n${latex}\n$$\n` : `a $${latex}$ b\n`;
  return documentXml(await buildDocx(source, "doc.md"));
}

describe("the MathML vocabulary KaTeX emits", () => {
  /**
   * The closed set this transform is written against.
   *
   * Recorded so that a KaTeX upgrade which starts emitting something new fails
   * here — loudly, in one place — rather than silently degrading every equation
   * that uses it to fallback text somewhere in a reader's document.
   */
  const KNOWN = new Set([
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mn",
    "mo",
    "mtext",
    "mstyle",
    "mspace",
    "mpadded",
    "mphantom",
    "mfrac",
    "msqrt",
    "mroot",
    "msub",
    "msup",
    "msubsup",
    "munder",
    "mover",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
  ]);

  const CORPUS = [
    "E = mc^2",
    "x_i^2",
    "\\frac{a}{b}",
    "\\sqrt{x}",
    "\\sqrt[3]{x}",
    "\\int_0^1 x \\, dx",
    "\\sum_{i=1}^{n} i",
    "\\lim_{x \\to 0} f(x)",
    "\\left( \\frac{a}{b} \\right)",
    "\\alpha + \\beta",
    "\\overline{x}",
    "\\text{hello}",
    "\\vec{v}",
    "a \\ne b \\le c",
  ];

  it("emits nothing outside the set this transform was written against", () => {
    const seen = new Set<string>();
    for (const latex of CORPUS) {
      const math = mathmlFor(latex, false);
      for (const element of [math, ...math.querySelectorAll("*")]) {
        seen.add(element.tagName.toLowerCase());
      }
    }

    expect([...seen].filter((name) => !KNOWN.has(name))).toEqual([]);
  });
});

describe("latexToOmml", () => {
  it("refuses what it cannot model, rather than guessing", () => {
    // The transform's contract: silence is the danger, so anything unmodelled must
    // raise. `\begin{matrix}` produces mtable, which has no OMML mapping here.
    expect(() => latexToOmml("\\begin{matrix} a & b \\\\ c & d \\end{matrix}", false)).toThrow(UnsupportedMathError);
  });

  it("refuses a formula KaTeX itself could not parse", () => {
    // KaTeX with throwOnError:false returns error markup, which would otherwise
    // convert into a well-formed equation reading the broken source.
    expect(() => latexToOmml("\\frac{a}{", false)).toThrow(UnsupportedMathError);
  });

  it("builds components a paragraph will accept", () => {
    // The components have to be the writer's own types, or the paragraph refuses
    // them at construction and the failure surfaces far from here.
    expect(() => new Paragraph({ children: [new MathEquation({ children: latexToOmml("x^2", false) })] })).not.toThrow();
  });
});

describe("equations in an exported document", () => {
  it("writes a native Word equation, not an image and not text", async () => {
    const xml = await ommlFor("E = mc^2");

    // `m:oMath` is the equation element itself: its presence is what makes Word
    // treat this as an equation object rather than as characters that look like one.
    expect(xml).toContain("<m:oMath>");
    expect(xml).toContain("<m:r>");
    expect(xml).not.toContain("$");
  });

  it("keeps an inline equation inside its paragraph, with the sentence unbroken", async () => {
    const xml = await ommlFor("x_i");

    const withMath = paragraphs(xml).filter((paragraph) => paragraph.includes("<m:oMath>"));
    expect(withMath).toHaveLength(1);
    // The words either side are in the same paragraph as the equation — an inline
    // equation that split its sentence into three would read as three paragraphs.
    expect(visibleText(withMath[0])).toContain("a");
    expect(visibleText(withMath[0])).toContain("b");
  });

  it("gives a display equation a block of its own", async () => {
    const xml = await documentXml(await buildDocx("Before.\n\n$$\n\\frac{a}{b}\n$$\n\nAfter.\n", "doc.md"));

    const withMath = paragraphs(xml).filter((paragraph) => paragraph.includes("<m:oMath>"));
    expect(withMath).toHaveLength(1);
    // Its own block: the surrounding prose is not in it.
    expect(visibleText(withMath[0])).not.toContain("Before.");
    expect(visibleText(withMath[0])).not.toContain("After.");
  });

  it("builds a fraction as a fraction", async () => {
    const xml = await ommlFor("\\frac{a}{b}", true);

    expect(xml).toContain("<m:f>");
    expect(xml).toContain("<m:num>");
    expect(xml).toContain("<m:den>");
  });

  it("builds a root, with and without a degree", async () => {
    expect(await ommlFor("\\sqrt{x}", true)).toContain("<m:rad>");
    expect(await ommlFor("\\sqrt[3]{x}", true)).toContain("<m:deg>");
  });

  it("builds subscripts and superscripts as scripts", async () => {
    expect(await ommlFor("x^2", true)).toContain("<m:sSup>");
    expect(await ommlFor("x_i", true)).toContain("<m:sSub>");
    expect(await ommlFor("x_i^2", true)).toContain("<m:sSubSup>");
  });

  it("builds a sum as Word's n-ary object, not a character with scripts", async () => {
    // A sum written as `∑` with a subscript renders at text size with its bounds on
    // the shoulder; Word's n-ary object grows the sign and puts them under and over.
    const xml = await ommlFor("\\sum_{i=1}^{n} i", true);

    expect(xml).toContain("<m:nary>");
  });

  it("builds an integral as an n-ary object too", async () => {
    expect(await ommlFor("\\int_0^1 x \\, dx", true)).toContain("<m:nary>");
  });

  it("gives the n-ary operator the thing it operates on", async () => {
    /*
     * MathML writes the sign and its operand as siblings; Word's n-ary object
     * contains both, and its operand slot is not optional. Left empty, Word hides
     * it — and every other reader draws an empty-slot placeholder, so the document
     * reads "Σ □ xᵢ". Found by opening a real export in LibreOffice.
     */
    const xml = await ommlFor("\\sum_{i=1}^{n} x_i", true);

    const nary = /<m:nary>[\s\S]*?<\/m:nary>/.exec(xml)?.[0] ?? "";
    const operand = /<m:e>([\s\S]*?)<\/m:e>/.exec(nary)?.[1] ?? "";
    expect(operand).not.toBe("");
    // The operand is the term itself, so its letter is inside the n-ary.
    expect(operand).toContain("<m:t>x</m:t>");
  });

  it("falls back to the source for an equation it cannot model", async () => {
    const xml = await documentXml(
      await buildDocx("Before.\n\n$$\n\\begin{matrix} a & b \\\\ c & d \\end{matrix}\n$$\n\nAfter.\n", "doc.md"),
    );

    // No equation object, and the LaTeX is readable rather than lost.
    expect(xml).not.toContain("<m:oMath>");
    expect(visibleText(xml)).toContain("\\begin{matrix}");
    // The rest of the document is untouched by the one formula that failed.
    expect(visibleText(xml)).toContain("Before.");
    expect(visibleText(xml)).toContain("After.");
  });

  it("keeps the document exportable when one equation of several fails", async () => {
    const xml = await documentXml(
      await buildDocx("$x^2$ and $\\begin{matrix} a \\end{matrix}$ and $y_1$.\n", "doc.md"),
    );

    // Two good equations still became equations; the bad one became its source.
    expect([...xml.matchAll(/<m:oMath>/g)]).toHaveLength(2);
    expect(visibleText(xml)).toContain("\\begin{matrix}");
  });
});
