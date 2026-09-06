import { describe, expect, it } from "vitest";
import { mml2omml } from "mathml2omml";
import { buildDocx } from "./docxExport";
import { mathmlFor } from "./mathmlToOmml";
import { documentXml } from "./testSupport";

/**
 * A second opinion on the equation transform.
 *
 * The risk this file exists for is the one the design named as most likely to reach
 * a reader unnoticed: an OMML coverage gap is *silent*, because a mis-transformed
 * equation still looks like an equation. Element-by-element unit tests prove each
 * construct in isolation; they cannot tell us that the construct chosen was the
 * right one. An independent implementation can.
 *
 * `mathml2omml` is LGPL-3.0-or-later, so it is a development dependency used to
 * check our output and nothing more — none of its code is imported by the
 * application or bundled into the export chunk. See design.md D3.
 *
 * The comparison is on the *sequence of OMML elements*, not on the XML text.
 * Attribute order, namespace prefixes and the `ctrlPr` formatting wrappers differ
 * between any two writers without meaning anything, and diffing raw strings would
 * produce noise that buries the one difference that matters.
 */

/**
 * Structural OMML elements — the shape of the equation, without the decoration.
 *
 * Property blocks (`m:fPr`, `m:radPr`, `m:naryPr`, …) are removed whole rather than
 * filtered by name: they hold presentation settings like `m:type` and `m:degHide`
 * whose names look structural but describe how a construct is drawn, not which
 * construct it is. Runs and their text go too — this asks what the equation is
 * built from, and the characters are already checked elsewhere.
 */
function structure(omml: string): string[] {
  const withoutProperties = omml.replace(/<m:[a-zA-Z]+Pr>[\s\S]*?<\/m:[a-zA-Z]+Pr>|<m:[a-zA-Z]+Pr\s*\/>/g, "");
  return [...withoutProperties.matchAll(/<m:([a-zA-Z]+)[\s/>]/g)]
    .map((match) => match[1])
    .filter((name) => name !== "t" && name !== "r");
}

/** What our transform produces for a formula, taken from a real package. */
async function ours(latex: string): Promise<string[]> {
  const xml = await documentXml(await buildDocx(`$$\n${latex}\n$$\n`, "doc.md"));
  const math = /<m:oMath>[\s\S]*?<\/m:oMath>/.exec(xml)?.[0] ?? "";
  return structure(math);
}

/**
 * What the oracle produces for the same formula, from the same MathML.
 *
 * The TeX annotation KaTeX attaches is removed first: it is provenance rather than
 * content, our transform ignores it, and the oracle logs it as unsupported.
 */
function theirs(latex: string): string[] {
  const mathml = mathmlFor(latex, true).outerHTML.replace(/<annotation[\s\S]*?<\/annotation>/g, "");
  return structure(mml2omml(mathml));
}

/**
 * Formulas both implementations should agree on.
 *
 * Deliberately the ordinary ones — a document's equations are mostly fractions,
 * roots and scripts, and those are where a silent divergence would do the most
 * damage precisely because nobody would look twice at them.
 */
const AGREED = [
  "x^2",
  "x_i",
  "x_i^2",
  "\\frac{a}{b}",
  "\\sqrt{x}",
  "\\sqrt[3]{x}",
  "\\frac{\\sqrt{a}}{b^2}",
  "E = mc^2",
  "\\alpha + \\beta",
  // The n-ary operators were expected to be where the two implementations parted
  // company — a sum is defensible either as an n-ary object or as a sign wearing a
  // script. They do not: both build `m:nary`, limits under and over the sign.
  "\\sum_{i=1}^{n} i",
  "\\int_0^1 x \\, dx",
];

describe("agreement with an independent MathML to OMML implementation", () => {
  for (const latex of AGREED) {
    it(`agrees on the structure of ${latex}`, async () => {
      expect(await ours(latex)).toEqual(theirs(latex));
    });
  }
});

describe("divergences", () => {
  /**
   * There are none across this corpus, which is worth stating rather than leaving
   * as the absence of a test. The two implementations were written independently
   * from the same MathML and agree on every formula above, n-ary operators
   * included — so the constructs chosen are not merely self-consistent, they are
   * what a second reading of the same input produces.
   *
   * A divergence found later belongs here, with the reason it is deliberate, or
   * belongs fixed.
   */
  it("builds sums with Word's n-ary object, as the oracle independently does", async () => {
    expect(await ours("\\sum_{i=1}^{n} i")).toContain("nary");
    expect(theirs("\\sum_{i=1}^{n} i")).toContain("nary");
  });
});
