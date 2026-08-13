/**
 * Word extraction: what comes out of a document's own markup.
 *
 * The fixtures are built by `test/fixtures/make-docx.mjs`, which writes the
 * markup by hand — a tracked deletion that really is a `<w:del>`, a table that
 * really declares three columns. Those are the things being asserted, so they
 * have to be the input under our control.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { DocxError, extractDocx, parseBlockRange, parseBody, renderBlock } from "../src/docx.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, `${name}.docx`)));
}

/** The failure the call produced, or a message saying it produced none. */
async function failureOf(bytes: Uint8Array, options = {}): Promise<DocxError> {
  try {
    const result = await extractDocx(bytes, options);
    assert.fail(`expected a failure, got: ${result.markdown.slice(0, 120)}`);
  } catch (error) {
    assert.ok(error instanceof DocxError, `expected a DocxError, got ${String(error)}`);
    return error;
  }
}

describe("extractDocx", () => {
  test("turns heading paragraphs into markdown headings", async () => {
    const { markdown, blockCount } = await extractDocx(await fixture("docx-text"));

    assert.equal(blockCount, 4);
    assert.match(markdown, /^# Quarterly Report$/m);
    assert.match(markdown, /^## Outlook$/m);
    assert.match(markdown, /^Revenue grew in every region this quarter\.$/m);
  });

  test("renders a table with the shape the document declares", async () => {
    const { markdown } = await extractDocx(await fixture("docx-table"));

    assert.match(markdown, /\| Region \| Units \| Revenue \|/);
    assert.match(markdown, /\| --- \| --- \| --- \|/);
    assert.match(markdown, /\| North \| 1200 \| 48000 \|/);
    for (const row of markdown.split("\n")) {
      assert.equal(row.split(" | ").length, 3, `every row keeps three columns: ${row}`);
    }
  });

  test("keeps a mixed document in reading order", async () => {
    const { markdown } = await extractDocx(await fixture("docx-mixed"));

    const heading = markdown.indexOf("# Sales by region");
    const intro = markdown.indexOf("The table below");
    const table = markdown.indexOf("| Region |");
    const tail = markdown.indexOf("Figures are provisional");
    assert.ok(heading < intro && intro < table && table < tail, markdown);
  });

  test("reads only the blocks asked for", async () => {
    const result = await extractDocx(await fixture("docx-text"), { blocks: "3-4" });

    assert.deepEqual(result.blocks, [3, 4]);
    assert.doesNotMatch(result.markdown, /Quarterly Report/);
    assert.match(result.markdown, /## Outlook/);
  });

  test("mode filters what is rendered, not what is counted", async () => {
    const tables = await extractDocx(await fixture("docx-mixed"), { mode: "tables" });
    assert.match(tables.markdown, /\| Region \|/);
    assert.doesNotMatch(tables.markdown, /Sales by region/);

    const text = await extractDocx(await fixture("docx-mixed"), { mode: "text" });
    assert.match(text.markdown, /Sales by region/);
    assert.doesNotMatch(text.markdown, /\| --- \|/);
    // A table is still content in text mode: its cells come through as lines
    assert.match(text.markdown, /Region — Units — Revenue/);
  });

  test("decodes entities and escapes what would break a table", async () => {
    const { markdown } = await extractDocx(await fixture("docx-escapes"));

    assert.match(markdown, /a & b < c été/);
    assert.match(markdown, /# Greater > than/);
    assert.match(markdown, /\| a \\\| b \| back\\\\slash \|/);
    const rows = markdown.split("\n").filter((line) => line.startsWith("|"));
    for (const row of rows) assert.equal(row.split(" | ").length, 2, row);
  });
});

describe("extractDocx and tracked changes", () => {
  test("keeps an insertion and drops a deletion", async () => {
    const { markdown } = await extractDocx(await fixture("docx-tracked"));

    assert.match(markdown, /The rate is fifteen percent\./);
    assert.doesNotMatch(markdown, /SEVENTY-NINE/);
    assert.doesNotMatch(markdown, /DELETED PARAGRAPH/);
  });

  test("drops it in every mode, because deletion is a property of the walk", async () => {
    // The assertion that matters most here: there is no mode, flag or path by
    // which text the author removed reaches the caller.
    for (const mode of ["text", "tables", "both"] as const) {
      const { markdown } = await extractDocx(await fixture("docx-tracked"), { mode });
      assert.doesNotMatch(markdown, /SEVENTY-NINE/, `mode ${mode} leaked a deletion`);
      assert.doesNotMatch(markdown, /DELETED PARAGRAPH/, `mode ${mode} leaked a deleted paragraph`);
    }
  });
});

describe("extractDocx failures", () => {
  test("a package that is not a Word document is refused as unreadable", async () => {
    const error = await failureOf(await fixture("docx-not-office"));
    assert.equal(error.reason, "unreadable");
    assert.match(error.message, /Office package/);
  });

  test("a file that is not a zip is refused as unreadable", async () => {
    assert.equal((await failureOf(await fixture("docx-corrupt"))).reason, "unreadable");
  });

  test("an encrypted document says so instead of reporting damage", async () => {
    const error = await failureOf(await fixture("docx-encrypted"));
    assert.equal(error.reason, "encrypted");
    assert.match(error.message, /password-protected/);
  });

  test("a part that expands past the budget stops while it expands", async () => {
    const error = await failureOf(await fixture("docx-bomb"));
    assert.equal(error.reason, "too-large");
  });

  test("a parse that outruns its budget fails instead of hanging", async () => {
    // -1, not 0: with a zero budget the whole parse can finish inside the same
    // millisecond on a fast machine, and the test would pass or fail by luck.
    const error = await failureOf(await fixture("docx-long"), { timeoutMs: -1 });
    assert.equal(error.reason, "budget");
  });
});

describe("extractDocx caps", () => {
  test("stops at the block cap and names the next block", async () => {
    const result = await extractDocx(await fixture("docx-long"), { maxBlocks: 5 });

    assert.deepEqual(result.blocks, [1, 2, 3, 4, 5]);
    assert.equal(result.nextBlock, 6);
    assert.equal(result.blockCount, 60);
    assert.match(result.markdown, /Truncated: blocks 1-5 of 60/);
    assert.match(result.markdown, /blocks="6-60"/);
  });

  test("stops at the character cap too", async () => {
    const result = await extractDocx(await fixture("docx-long"), { maxChars: 100 });

    assert.ok(result.blocks.length < 60, `expected truncation, covered ${result.blocks.length}`);
    assert.match(result.markdown, /Truncated/);
  });

  test("covers every block across successive calls", async () => {
    const bytes = await fixture("docx-long");
    const seen: number[] = [];
    let next: number | undefined = 1;
    let calls = 0;
    while (next !== undefined && calls < 30) {
      const result: Awaited<ReturnType<typeof extractDocx>> = await extractDocx(bytes, {
        blocks: `${next}-999`,
        maxBlocks: 20,
      });
      seen.push(...result.blocks);
      next = result.nextBlock;
      calls++;
    }

    assert.equal(seen.length, 60);
    assert.deepEqual(seen[0], 1);
    assert.deepEqual(seen[59], 60);
    assert.equal(calls, 3);
  });
});

describe("extractDocx with nothing to read", () => {
  test("says the body is empty and names what it does not read", async () => {
    const result = await extractDocx(await fixture("docx-header-only"));

    assert.equal(result.blockCount, 0);
    assert.match(result.markdown, /no extractable body content/i);
    assert.match(result.markdown, /Headers, footers, footnotes, comments/);
  });

  test("says so rather than returning silence when a mode renders nothing", async () => {
    const result = await extractDocx(await fixture("docx-text"), { mode: "tables" });

    assert.match(result.markdown, /No table was found/);
    assert.notEqual(result.markdown.trim(), "");
  });
});

describe("parseBlockRange", () => {
  test("reads single blocks, ranges and lists", () => {
    assert.deepEqual(parseBlockRange("3", 10), [3]);
    assert.deepEqual(parseBlockRange("2-4", 10), [2, 3, 4]);
    assert.deepEqual(parseBlockRange("8,2-3", 10), [2, 3, 8]);
    assert.deepEqual(parseBlockRange("8-99", 10), [8, 9, 10]);
  });

  test("refuses a range that names nothing readable", () => {
    assert.throws(() => parseBlockRange("nope", 10), /not a block or a block range/);
    assert.throws(() => parseBlockRange("5-2", 10), /not a usable block range/);
    assert.throws(() => parseBlockRange("40-50", 10), /no block of this 10-block document/);
  });
});

describe("parseBody", () => {
  const wrap = (body: string) =>
    `<w:document xmlns:w="http://x"><w:body>${body}</w:body></w:document>`;

  test("takes a heading level from an outline level when there is no style", () => {
    const blocks = parseBody(
      wrap(`<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>Second level</w:t></w:r></w:p>`),
    );

    assert.deepEqual(blocks, [{ kind: "paragraph", text: "Second level", heading: 2 }]);
  });

  test("drops a paragraph that holds no text", () => {
    assert.deepEqual(parseBody(wrap(`<w:p/><w:p><w:r><w:t>  </w:t></w:r></w:p>`)), []);
  });

  test("reads a single-cell table as text, because that is layout", () => {
    // A cover page or a callout box: one cell, no tabular meaning. Real documents
    // do this constantly — the Descartes edition this was found on wraps its whole
    // title page in one.
    const blocks = parseBody(
      wrap(`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Title page</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`),
    );

    assert.deepEqual(blocks, [{ kind: "paragraph", text: "Title page" }]);
  });

  test("keeps a table's declared shape even when a cell is empty", () => {
    const blocks = parseBody(
      wrap(`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc/></w:tr></w:tbl>`),
    );

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind === "table" && blocks[0].rows[0].length, 2);
  });
});

describe("renderBlock", () => {
  test("emits a headerless table when the first row does not fill every column", () => {
    const markdown = renderBlock({ kind: "table", rows: [["a", ""], ["b", "c"]] }, "both");

    const [header, separator] = markdown.split("\n");
    assert.equal(header, "|  |  |");
    assert.equal(separator, "| --- | --- |");
  });
});
