/**
 * The XML scanner and the zip reader — the two primitives this repository writes
 * itself rather than depending on, because the deployments it serves are
 * air-gapped and every package is something a security team vendors.
 *
 * Writing them means owning their failure modes, so these are the tests that
 * would otherwise be someone else's: an attribute holding a `>`, a comment
 * mistaken for content, an archive that ends mid-record, and the DOCTYPE that
 * makes entity expansion unreachable.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeEntities, scanXml, XmlError, type XmlEvent } from "../src/xml.ts";
import { readZipEntry, ZipError } from "../src/zip.ts";

/** Every event the scanner emits for this document. */
function events(source: string): XmlEvent[] {
  const collected: XmlEvent[] = [];
  scanXml(source, (event) => {
    collected.push(event);
  });
  return collected;
}

/** Just the text, as a caller building a document would concatenate it. */
function textOf(source: string): string {
  return events(source)
    .filter((event): event is Extract<XmlEvent, { kind: "text" }> => event.kind === "text")
    .map((event) => event.text)
    .join("");
}

describe("scanXml", () => {
  test("reports open, text and close in document order", () => {
    assert.deepEqual(events("<a><b>hi</b></a>"), [
      { kind: "open", name: "a", attributes: {}, selfClosing: false },
      { kind: "open", name: "b", attributes: {}, selfClosing: false },
      { kind: "text", text: "hi" },
      { kind: "close", name: "b" },
      { kind: "close", name: "a" },
    ]);
  });

  test("marks a self-closing tag rather than inventing a close", () => {
    const [open] = events("<w:br/>");
    assert.deepEqual(open, { kind: "open", name: "w:br", attributes: {}, selfClosing: true });
  });

  test("reads attributes, including one that contains a greater-than", () => {
    const [open] = events(`<w:t w:val="a > b" xml:space='preserve'>x</w:t>`);
    assert.equal(open.kind === "open" && open.attributes["w:val"], "a > b");
    assert.equal(open.kind === "open" && open.attributes["xml:space"], "preserve");
  });

  test("refuses a DOCTYPE, which is what makes entity expansion unreachable", () => {
    // The billion-laughs shape: without an internal subset there is nowhere to
    // declare the entities it needs.
    const bomb = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><a>&lol2;</a>`;
    assert.throws(() => events(bomb), XmlError);
    assert.throws(() => events(`<?xml version="1.0"?><!doctype x><a/>`), /DOCTYPE/);
  });

  test("decodes the predefined entities and numeric references", () => {
    assert.equal(textOf("<a>a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;</a>"), `a & b < c > d "e" 'f'`);
    assert.equal(textOf("<a>&#233;t&#xe9;</a>"), "été");
  });

  test("keeps an entity it cannot resolve rather than dropping it", () => {
    // Silence would be a lie about the document's content
    assert.equal(textOf("<a>&unknown; &#0; &#xZZ;</a>"), "&unknown; &#0; &#xZZ;");
  });

  test("does not mistake a comment or a processing instruction for content", () => {
    assert.equal(textOf(`<?xml version="1.0"?><a><!-- hidden -->shown</a>`), "shown");
  });

  test("passes CDATA through verbatim, entities and all", () => {
    assert.equal(textOf("<a><![CDATA[ raw & <not-a-tag> ]]></a>"), " raw & <not-a-tag> ");
  });

  test("stops when the caller says so", () => {
    const seen: string[] = [];
    scanXml("<a><b/><c/><d/></a>", (event) => {
      if (event.kind === "open") seen.push(event.name);
      return seen.length < 2; // the cap a truncating reader applies
    });
    assert.deepEqual(seen, ["a", "b"]);
  });

  test("refuses damage rather than guessing at it", () => {
    assert.throws(() => events("<a"), /unterminated tag/);
    assert.throws(() => events("<a><![CDATA[ oops"), /unterminated CDATA/);
    assert.throws(() => events("< >"), /no name/);
  });

  test("an unterminated comment ends the document instead of hanging", () => {
    assert.deepEqual(events("<a>text<!-- never closed"), [
      { kind: "open", name: "a", attributes: {}, selfClosing: false },
      { kind: "text", text: "text" },
    ]);
  });
});

describe("decodeEntities", () => {
  test("leaves text with no entity untouched", () => {
    assert.equal(decodeEntities("plain text"), "plain text");
  });
});

describe("readZipEntry", () => {
  const limits = { maxEntries: 8, maxInflatedBytes: 1024 };

  test("refuses anything that is not a zip", () => {
    assert.throws(() => readZipEntry(Buffer.from("not a zip at all"), "x", limits), ZipError);
    assert.throws(() => readZipEntry(Buffer.alloc(4), "x", limits), /too short/);
  });

  test("refuses an archive that ends inside a record", () => {
    // A well-formed end-of-central-directory pointing at a directory that is not there
    const truncated = Buffer.alloc(22);
    truncated.writeUInt32LE(0x06054b50, 0);
    truncated.writeUInt16LE(1, 10); // one entry declared
    truncated.writeUInt32LE(9999, 16); // directory offset past the end
    assert.throws(() => readZipEntry(truncated, "word/document.xml", limits), /ends in the middle|malformed/);
  });

  test("refuses an archive declaring more entries than the limit", () => {
    const many = Buffer.alloc(22);
    many.writeUInt32LE(0x06054b50, 0);
    many.writeUInt16LE(9999, 10);
    const error = assertThrows(() => readZipEntry(many, "x", limits));
    assert.equal(error.reason, "too-many-entries");
  });
});

function assertThrows(run: () => unknown): ZipError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ZipError, `expected a ZipError, got ${String(error)}`);
    return error;
  }
  throw new Error("expected the call to be refused, but it resolved");
}
