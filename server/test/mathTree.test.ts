import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMathNode, hasClass, MathMarkupError, parseMathMarkup } from "../../shared/src/docx/mathTree.ts";

describe("parseMathMarkup", () => {
  it("parses nested elements, attributes, self-closing tags and decoded descendant text", () => {
    const [math] = parseMathMarkup('<math display="block"><mrow class="katex base"><mi>x&amp;y&#x21;</mi><mspace width="1em"/></mrow></math>');
    assert.equal(math?.tagName, "math");
    assert.equal(math?.attributes.get("display"), "block");
    assert.equal(math?.children[0]?.children[0]?.textContent, "x&y!");
    assert.equal(math?.children[0]?.children[1]?.attributes.get("width"), "1em");
    assert.equal(math?.textContent, "x&y!");
  });

  it("rejects malformed, mismatched and unclosed markup", () => {
    for (const markup of ["<1bad/>", "</math>", "<math><mi></math>", "<math>"]) {
      assert.throws(() => parseMathMarkup(markup), MathMarkupError, markup);
    }
    assert.equal(new MathMarkupError("bad").name, "MathMarkupError");
  });
});

describe("findMathNode", () => {
  it("returns the first depth-first match, or undefined when there is none", () => {
    const nodes = parseMathMarkup('<math><mrow><mi class="target">first</mi></mrow><mi class="target">second</mi></math>');
    assert.equal(findMathNode(nodes, (node) => node.tagName === "mi")?.textContent, "first");
    assert.equal(findMathNode(nodes, (node) => node.tagName === "none"), undefined);
  });
});

describe("hasClass", () => {
  it("matches a whole class token and handles a node without a class", () => {
    const [withClass, withoutClass] = parseMathMarkup('<mi class="katex-error base"/><mn/>');
    assert.equal(hasClass(withClass!, "katex-error"), true);
    assert.equal(hasClass(withClass!, "katex"), false);
    assert.equal(hasClass(withoutClass!, "katex-error"), false);
  });
});
