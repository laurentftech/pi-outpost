/**
 * The edges of reducing mail HTML: markup a sender's client left half-written, and a
 * consumer that stops reading early. The contract is the module's own — every piece of
 * text the body carried survives, and nothing throws.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeHtmlEntities, reduceHtmlToMarkdown, scanHtml, type HtmlEvent } from "../src/mailHtml.ts";

const label = (event: HtmlEvent) => (event.kind === "text" ? `text:${event.text}` : `${event.kind}:${event.name}`);

describe("scanHtml stops when told to", () => {
  // Every kind of event the scanner produces, each from a different place in it: text
  // before a tag, a tag, a close, a `<` that is prose, a raw-text element's content and
  // close, and an unterminated tag at the end.
  const document = "pre<b>in</b> 1 < 2 <script>s</script><i";
  const all: string[] = [];
  scanHtml(document, (event) => {
    all.push(label(event));
  });

  test("the document yields every kind of event", () => {
    assert.deepEqual(all, [
      "text:pre",
      "open:b",
      "text:in",
      "close:b",
      "text: 1 ",
      "text:<",
      "text: 2 ",
      "open:script",
      "text:s",
      "close:script",
      "text:<i",
    ]);
  });

  for (let stopAt = 1; stopAt < all.length; stopAt++) {
    test(`returning false on event ${stopAt} (${all[stopAt - 1]}) delivers nothing after it`, () => {
      const seen: string[] = [];
      scanHtml(document, (event) => {
        seen.push(label(event));
        return seen.length === stopAt ? false : undefined;
      });
      assert.deepEqual(seen, all.slice(0, stopAt));
    });
  }

  test("an unterminated comment or declaration swallows the rest, as a browser does", () => {
    for (const source of ["a<!-- never closed <b>x</b>", "a<!DOCTYPE never closed"]) {
      const seen: string[] = [];
      scanHtml(source, (event) => {
        seen.push(label(event));
      });
      assert.deepEqual(seen, ["text:a"], source);
    }
  });
});

describe("decodeHtmlEntities on references that name no character", () => {
  test("a zero or out-of-range code point is kept as written, not thrown on", () => {
    assert.equal(decodeHtmlEntities("&#0;"), "&#0;");
    assert.equal(decodeHtmlEntities("&#x110000;"), "&#x110000;");
    assert.equal(decodeHtmlEntities("&#65;&#x42;"), "AB");
  });
});

describe("reduceHtmlToMarkdown on half-written markup", () => {
  test("a line break and a rule end the line", () => {
    assert.equal(reduceHtmlToMarkdown("a<br>b"), "a\n\nb");
    assert.equal(reduceHtmlToMarkdown("a<hr>b"), "a\n\n---\n\nb");
  });

  test("a list item outside any list is still a bullet", () => {
    assert.equal(reduceHtmlToMarkdown("<li>item</li>"), "- item");
  });

  test("links: a stray close, no target, and one left open at the end", () => {
    assert.equal(reduceHtmlToMarkdown("x</a>y"), "xy");
    assert.equal(reduceHtmlToMarkdown("<a>text</a>"), "text");
    assert.equal(reduceHtmlToMarkdown('x <a href="u">tail'), "x [tail](u)");
    assert.equal(reduceHtmlToMarkdown("x <a>tail"), "x tail");
    assert.equal(reduceHtmlToMarkdown("x <a href=u>"), "x");
  });

  test("what is inside a skipped element is skipped whole, structure included", () => {
    assert.equal(reduceHtmlToMarkdown("<head><br><hr><a href=x>t</a><b>z</b></head>body"), "body");
  });

  test("a table close with no table open is ignored", () => {
    assert.equal(reduceHtmlToMarkdown("a</table>b"), "a\n\nb");
  });

  test("a table left open at the end is still rendered", () => {
    assert.equal(
      reduceHtmlToMarkdown("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr>"),
      "| a | b |\n| --- | --- |\n| c | d |",
    );
  });

  test("an empty cell of a layout table adds no block", () => {
    assert.equal(reduceHtmlToMarkdown("<table><tr><td></td><td>only</td></tr></table>"), "only");
  });
});

describe("reduceHtmlToMarkdown keeps the text of tables written loosely", () => {
  test("cells with no row around them keep their text", () => {
    // A browser supplies the row; the text was being dropped with it.
    assert.equal(reduceHtmlToMarkdown("<table><td>a</td><td>b</td></table>"), "a\n\nb");
  });

  test("a cell still open when its table ends keeps its text", () => {
    assert.equal(reduceHtmlToMarkdown("<table><tr><td>a</table>"), "a");
  });

  test("rows and cells whose close tags are left out, as HTML allows, are each kept", () => {
    assert.equal(
      reduceHtmlToMarkdown("<table><tr><td>a<td>b<tr><td>c<td>d</table>"),
      "| a | b |\n| --- | --- |\n| c | d |",
    );
  });

  test("a data table inside a layout frame keeps its lines", () => {
    // The common shape of a mailing: a one-cell frame around the message, a real table in it.
    assert.equal(
      reduceHtmlToMarkdown(
        "<table><tr><td><table><tr><td>h1</td><td>h2</td></tr><tr><td>1</td><td>2</td></tr></table></td></tr></table>",
      ),
      "| h1 | h2 |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  test("the cells of a nested layout table stay separate blocks", () => {
    assert.equal(
      reduceHtmlToMarkdown("<table><tr><td><table><tr><td>x</td></tr><tr><td>y</td></tr></table></td></tr></table>"),
      "x\n\ny",
    );
    assert.equal(
      reduceHtmlToMarkdown(
        "<table><tr><td><table><tr><td>inner</td><td> </td></tr></table></td><td>outer</td></tr></table>",
      ),
      "inner\n\nouter",
    );
  });

  test("a data table's cells are still one line each", () => {
    assert.equal(
      reduceHtmlToMarkdown("<table><tr><td>a\n  b</td><td>c</td></tr><tr><td>d</td><td><pre>e\nf</pre></td></tr></table>"),
      "| a b | c |\n| --- | --- |\n| d | e f |",
    );
  });
});
