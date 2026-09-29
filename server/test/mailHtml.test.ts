/**
 * Reducing a mail body's HTML to markdown: what survives, what is dropped, and what
 * must never happen (a fetch, a script, a lost sentence).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeHtmlEntities, reduceHtmlToMarkdown, scanHtml } from "../src/mailHtml.ts";

describe("scanHtml", () => {
  test("tolerates what mail actually contains", () => {
    // Every one of these makes scanXml throw, which is why this scanner exists.
    const events: string[] = [];
    scanHtml('<!DOCTYPE html><!--c--><p>a < b</p><img src="x"><b>bold', (event) => {
      events.push(event.kind === "text" ? `text:${event.text}` : `${event.kind}:${event.name}`);
    });
    assert.deepEqual(events, [
      "open:p",
      "text:a ",
      "text:<",
      "text: b",
      "close:p",
      "open:img",
      "open:b",
      "text:bold",
    ]);
  });

  test("reads a script's content as text rather than as markup", () => {
    const events: string[] = [];
    scanHtml("<script>if (a<b) { x }</script><p>after</p>", (event) => {
      events.push(event.kind === "text" ? `text:${event.text}` : `${event.kind}:${event.name}`);
    });
    assert.deepEqual(events, ["open:script", "text:if (a<b) { x }", "close:script", "open:p", "text:after", "close:p"]);
  });

  test("an unterminated tag at the end is text, not a failure", () => {
    const events: string[] = [];
    scanHtml("<p>done</p><span class=", (event) => {
      events.push(event.kind);
    });
    assert.deepEqual(events, ["open", "text", "close", "text"]);
  });

  test("reads attributes quoted, single-quoted and bare", () => {
    let attributes: Record<string, string> = {};
    scanHtml(`<a href="x.test" title='t' target=_blank>`, (event) => {
      if (event.kind === "open") attributes = event.attributes;
    });
    assert.deepEqual(attributes, { href: "x.test", title: "t", target: "_blank" });
  });
});

describe("decodeHtmlEntities", () => {
  test("decodes the accented named entities French mail arrives with", () => {
    assert.equal(decodeHtmlEntities("R&eacute;union pr&egrave;s d&rsquo;ici"), "Réunion près d’ici");
    assert.equal(decodeHtmlEntities("&Eacute;t&eacute;"), "Été");
  });

  test("decodes numeric references and the non-breaking space", () => {
    assert.equal(decodeHtmlEntities("caf&#233; &#xE9; a&nbsp;b"), "café é a b");
  });

  test("leaves an unknown entity as written rather than dropping it", () => {
    assert.equal(decodeHtmlEntities("a &notanentity; b"), "a &notanentity; b");
  });
});

describe("reduceHtmlToMarkdown", () => {
  test("keeps headings, lists, emphasis and links", () => {
    const markdown = reduceHtmlToMarkdown(
      `<h2>Ordre du jour</h2><ul><li>Budget</li><li><b>Planning</b></li></ul>` +
        `<p>Voir <a href="https://example.test/doc">le dossier</a>.</p><ol><li>un</li><li>deux</li></ol>`,
    );
    assert.match(markdown, /^## Ordre du jour$/m);
    assert.match(markdown, /^- Budget$/m);
    assert.match(markdown, /^- \*\*Planning\*\*$/m);
    assert.match(markdown, /\[le dossier\]\(https:\/\/example\.test\/doc\)/);
    assert.match(markdown, /^1\. un$/m);
    assert.match(markdown, /^2\. deux$/m);
  });

  test("renders a data table and unwraps a layout table", () => {
    const data = reduceHtmlToMarkdown(
      "<table><tr><th>Région</th><th>Unités</th></tr><tr><td>Nord</td><td>12</td></tr></table>",
    );
    assert.match(data, /\| Région \| Unités \|/);
    assert.match(data, /\| Nord \| 12 \|/);

    // One row, one cell: a page frame. Its text is the message.
    const layout = reduceHtmlToMarkdown("<table><tr><td><p>Bonjour</p><p>Merci</p></td></tr></table>");
    assert.doesNotMatch(layout, /\|/);
    assert.match(layout, /Bonjour/);
    assert.match(layout, /Merci/);
  });

  test("a table nested in a table is layout, and keeps its text", () => {
    const markdown = reduceHtmlToMarkdown(
      "<table><tr><td>a</td><td>b</td></tr><tr><td><table><tr><td>inner</td><td>cell</td></tr><tr><td>x</td><td>y</td></tr></table></td><td>d</td></tr></table>",
    );
    assert.match(markdown, /inner/);
    assert.match(markdown, /cell/);
  });

  test("marks a quoted reply as quoted", () => {
    const markdown = reduceHtmlToMarkdown("<p>Ma réponse</p><blockquote><p>Le message d'origine</p></blockquote>");
    assert.match(markdown, /^Ma réponse$/m);
    assert.match(markdown, /^> Le message d'origine$/m);
  });

  test("drops scripts, styles and head without dropping the body", () => {
    const markdown = reduceHtmlToMarkdown(
      `<html><head><title>T</title><style>p{color:red}</style></head><body><script>alert(1)</script><p>Texte</p></body></html>`,
    );
    assert.equal(markdown, "Texte");
    assert.doesNotMatch(markdown, /alert|color:red|^T$/);
  });

  test("reports an image reference instead of resolving it, and never fetches", () => {
    const original = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (() => {
      fetched++;
      throw new Error("the reducer must not fetch anything");
    }) as typeof fetch;
    try {
      const markdown = reduceHtmlToMarkdown(
        `<p>Logo <img src="cid:logo123" alt="logo"> and <img src="https://tracker.test/p.gif?u=1"></p>`,
      );
      assert.match(markdown, /\[image: logo — cid:logo123\]/);
      assert.match(markdown, /\[image: https:\/\/tracker\.test\/p\.gif\?u=1\]/);
      assert.equal(fetched, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("keeps the text of a Word body it has no rule for", () => {
    // Word emits `<o:p>`, conditional comments and span soup. None of it is known
    // here; all of its prose must survive anyway.
    const markdown = reduceHtmlToMarkdown(
      `<div class=WordSection1><p class=MsoNormal><span style='font-size:11.0pt'>Bonjour,<o:p></o:p></span></p>` +
        `<!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]-->` +
        `<p class=MsoNormal><span lang=FR>Voici <custom-tag>le point</custom-tag> de situation.</span></p></div>`,
    );
    assert.match(markdown, /Bonjour,/);
    assert.match(markdown, /Voici le point de situation\./);
    assert.doesNotMatch(markdown, /OfficeDocumentSettings/);
  });

  test("a link with no text of its own becomes its target", () => {
    assert.match(reduceHtmlToMarkdown(`<p><a href="https://x.test/a"></a></p>`), /https:\/\/x\.test\/a/);
    assert.equal(reduceHtmlToMarkdown(`<p><a href="https://x.test/a">https://x.test/a</a></p>`), "https://x.test/a");
  });

  test("keeps preformatted whitespace and collapses the rest", () => {
    assert.equal(reduceHtmlToMarkdown("<p>a     b\n\n\nc</p>"), "a b c");
    assert.match(reduceHtmlToMarkdown("<pre>a     b</pre>"), /a     b/);
  });

  test("the deadline can abandon a body", () => {
    // Many events, not merely many characters: the deadline is checked per event.
    const big = "<p>mot</p>".repeat(3000);
    assert.throws(
      () =>
        reduceHtmlToMarkdown(big, {
          deadline: () => {
            throw new Error("budget");
          },
        }),
      /budget/,
    );
  });
});
