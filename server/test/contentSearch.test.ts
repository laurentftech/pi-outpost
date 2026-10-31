/**
 * Content search (Files → Search in files): what is found, what is passed over, and
 * that nothing outside the browser root is ever read — a link out of it included.
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { EXCERPT_CHARS, excerptAround, searchContent } from "../src/contentSearch.ts";
import { realResolve } from "../src/sandbox.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("searchContent", () => {
  let root: string;
  let outside: string;
  /** Windows refuses symlink creation without a privilege CI does not have. */
  let symlinksAvailable = false;

  function write(relPath: string, content: string | Buffer) {
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  before(async () => {
    // Resolved by the production resolver, for the reason fileBrowser.test.ts gives.
    const base = mkdtempSync(path.join(tmpdir(), "pi-cs-"));
    mkdirSync(path.join(base, "root"), { recursive: true });
    mkdirSync(path.join(base, "outside"), { recursive: true });
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));

    writeFileSync(path.join(outside, "secret.txt"), "the needle lives outside\n");
    write("readme.md", "# Title\r\nnothing here\r\nA Needle in CRLF text\r\n");
    write("src/main.ts", "const a = 1;\n// needle one\nconst b = 2;\n// NEEDLE two\n");
    write("node_modules/pkg/index.js", "needle in a dependency\n");
    write("dist/out.js", "needle in a build\n");
    write(".hidden/notes.txt", "needle in a dot directory\n");
    write("image.bin", Buffer.concat([Buffer.from("needle"), Buffer.from([0x00, 0x01])]));
    write("many.txt", Array.from({ length: 30 }, (_, i) => `needle ${i}`).join("\n"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
    copyFileSync(path.join(FIXTURES, "pdf-text.pdf"), path.join(root, "docs", "report.pdf"));
    copyFileSync(path.join(FIXTURES, "pdf-mixed-scan.pdf"), path.join(root, "docs", "scan.pdf"));
    copyFileSync(path.join(FIXTURES, "pdf-corrupt.pdf"), path.join(root, "docs", "broken.pdf"));

    try {
      symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape-link.txt"));
      symlinkSync(outside, path.join(root, "escape-dir"), "dir");
      symlinksAvailable = true;
    } catch {
      symlinksAvailable = false;
    }
  });

  after(() => {
    rmSync(path.dirname(root), { recursive: true, force: true });
  });

  test("SearchAcrossWorkspaceFiles: matching paths and lines, with excerpts holding the match", async () => {
    const { hits, truncated } = await searchContent(root, "needle", { limits: { maxHitsPerFile: 50 } });
    const lines = hits.filter((hit) => hit.kind === "line" && hit.path !== "many.txt");

    assert.deepEqual(
      lines.map((hit) => hit.kind === "line" && [hit.path, hit.line, hit.column]),
      [
        ["readme.md", 3, 2],
        ["src/main.ts", 2, 3],
        ["src/main.ts", 4, 3],
      ],
    );
    for (const hit of lines) assert.match(hit.excerpt, /needle/i);
    // CRLF does not leak into the excerpt.
    assert.equal(lines[0].excerpt, "A Needle in CRLF text");
    assert.equal(truncated, false);
  });

  test("SearchPdfPagesAcrossTheWholeDocument: the page number and an excerpt", async () => {
    const { hits } = await searchContent(root, "supply chain");

    assert.deepEqual(hits, [
      { path: "docs/report.pdf", kind: "pdf-page", page: 2, excerpt: "Outlook The second half depends on the supply chain." },
    ]);
  });

  test("EmptyContentSearch: an empty or whitespace query finds nothing", async () => {
    for (const query of ["", "   ", "\t\n"]) {
      assert.deepEqual(await searchContent(root, query), { hits: [], truncated: false, skipped: 0 });
    }
  });

  test("NoContentMatches: a query nothing holds gives no hits", async () => {
    const result = await searchContent(root, "zzz-absent-everywhere");
    assert.deepEqual(result.hits, []);
    assert.equal(result.truncated, false);
  });

  test("SearchSkipsIgnoredDirectoriesAndBinaryFiles: only the searchable text file answers", async () => {
    const { hits } = await searchContent(root, "needle in a");
    assert.deepEqual(hits, []);

    const all = await searchContent(root, "needle", { limits: { maxHitsPerFile: 50 } });
    const paths = new Set(all.hits.map((hit) => hit.path));
    assert.deepEqual([...paths].sort(), ["many.txt", "readme.md", "src/main.ts"]);
  });

  test("ScannedPdfPageHasNoTextMatches: a page with no text layer gives nothing and no error", async () => {
    const { hits, skipped } = await searchContent(root, "cover page");

    assert.deepEqual(hits, [{ path: "docs/scan.pdf", kind: "pdf-page", page: 1, excerpt: "Cover page with real text" }]);
    // The corrupt PDF is the only one skipped; the scanned page is not an extraction error.
    assert.equal(skipped, 1);
  });

  test("SearchDoesNotFollowLinksOutsideRoot: a linked file outside the root is not read", async (t) => {
    if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
    const { hits } = await searchContent(root, "lives outside");
    assert.deepEqual(hits, []);
  });

  test("a file's hits stop at the per-file cap and say so", async () => {
    const { hits, truncated } = await searchContent(root, "needle", { limits: { maxHitsPerFile: 5 } });
    assert.equal(hits.filter((hit) => hit.path === "many.txt").length, 5);
    assert.equal(truncated, true);
  });

  test("the total cap stops the search and says so", async () => {
    const { hits, truncated } = await searchContent(root, "needle", { limits: { maxHits: 2 } });
    assert.equal(hits.length, 2);
    assert.equal(truncated, true);
  });

  test("a spent deadline stops the search and says so", async () => {
    const { hits, truncated } = await searchContent(root, "needle", { limits: { deadlineMs: 0 } });
    assert.deepEqual(hits, []);
    assert.equal(truncated, true);
  });

  test("an aborted search rejects rather than answering", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(searchContent(root, "needle", { signal: controller.signal }));
  });
});

describe("excerptAround", () => {
  test("a short line comes back whole, trimmed", () => {
    assert.equal(excerptAround("   find me here  ", 8, 2), "find me here");
  });

  test("a long line is cut around the match", () => {
    const line = `${"a".repeat(500)}NEEDLE${"b".repeat(500)}`;
    const excerpt = excerptAround(line, 500, 6);
    assert.match(excerpt, /^…a+NEEDLEb+…$/);
    assert.ok(excerpt.length <= EXCERPT_CHARS + 2);
  });

  test("a match near the end keeps the excerpt full-length", () => {
    const line = `${"a".repeat(500)}END`;
    const excerpt = excerptAround(line, 500, 3);
    assert.match(excerpt, /^…a+END$/);
    assert.equal(excerpt.length, EXCERPT_CHARS + 1);
  });
});
