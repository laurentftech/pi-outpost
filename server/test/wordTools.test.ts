/**
 * docx_create and docx_render as the agent calls them.
 *
 * The office application is replaced by an injected machine that hands back the real
 * LibreOffice rendering in `fixtures/docx-rendered.pdf` (see make-docx-rendered.mts),
 * so the render is checked end to end on CI — chapters, text check, pictures — without
 * an office suite installed.
 */
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { createDocument } from "@pi-outpost/office/docxBuild.ts";
import { readWordPackage } from "@pi-outpost/office/docxTemplate.ts";
import { loadCanvas, WORD_SCRIPT, type ProcessResult, type RenderEnvironment } from "../src/presentationRender.ts";
import { realResolve } from "../src/sandbox.ts";
import { createDocxCreateToolDefinition, createDocxRenderToolDefinition, createDocxUpdateToolDefinition, type WordToolOptions } from "../src/wordTools.ts";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PDF = path.join(FIXTURES, "docx-rendered.pdf");
/** The paragraph make-docx-rendered.mts hides with `w:vanish`. */
const HIDDEN_TEXT = "This sentence is hidden text and appears on no page.";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Tool = ReturnType<typeof createDocxCreateToolDefinition>;

async function call(tool: Tool, params: Record<string, unknown>): Promise<Content[]> {
  const result = await (tool.execute as unknown as (id: string, params: unknown) => Promise<{ content: Content[] }>)("call-1", params);
  return result.content;
}
const firstText = (content: Content[]) => (content[0] as { text: string }).text;
const unzipDocx = (bytes: Buffer) => readAllZipEntries(bytes, { maxEntries: 1000, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });

interface Call {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  inputExisted: boolean;
}

/** A machine whose office application writes the fixture PDF where it was asked to. */
function machine(platform: NodeJS.Platform): { environment: RenderEnvironment; calls: Call[] } {
  const calls: Call[] = [];
  const run = async (file: string, args: string[], options: { env: NodeJS.ProcessEnv }): Promise<ProcessResult> => {
    const windows = /powershell/i.test(file);
    const input = windows ? options.env.PI_OUTPOST_RENDER_INPUT! : args[args.length - 1];
    const output = windows ? options.env.PI_OUTPOST_RENDER_OUTPUT! : path.join(args[args.indexOf("--outdir") + 1], `${path.basename(input).replace(/\.docx$/i, "")}.pdf`);
    calls.push({ file, args, env: options.env, inputExisted: await readFile(input).then(() => true, () => false) });
    await copyFile(PDF, output);
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  };
  const files = new Set(platform === "win32" ? [] : ["/usr/bin/soffice"]);
  const env = platform === "win32" ? { SystemRoot: "C:\\Windows", PATH: "C:\\Windows\\System32" } : { PATH: "/usr/bin" };
  return { environment: { platform, env, run, isFile: async (file) => files.has(file) }, calls };
}

describe("Word tools", () => {
  let root: string;
  let options: WordToolOptions;

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-word-tools-")));
    await copyFile(path.join(FIXTURES, "docx-template.dotx"), path.join(root, "brand.dotx"));
    await copyFile(path.join(FIXTURES, "docx-rendered.docx"), path.join(root, "hidden.docx"));
    // The rendered document without its hidden paragraph: every paragraph is on the page.
    const clean = await createDocument(
      readWordPackage(await readFile(path.join(FIXTURES, "docx-template.dotx"))),
      "# Findings\n\nThe first chapter.\n\n## Detail\n\nA section.\n\n# Next steps\n\nThe second chapter.\n",
    );
    await writeFile(path.join(root, "clean.docx"), clean.bytes);
    options = { cwd: root, allowedRoots: [root], writableRoot: root, maxBytes: 25 * 1024 * 1024, render: { renderer: "auto", timeoutMs: 1000 } };
  });

  test("AnExistingDocumentIsKeptUnlessOverwriteIsAsked: docx_create refuses to write over a file", async () => {
    const create = createDocxCreateToolDefinition(options);
    const existing = Buffer.from("the user's own report");
    await writeFile(path.join(root, "report.docx"), existing);
    await assert.rejects(call(create, { template_path: "brand.dotx", output_path: "report.docx", markdown: "# New" }), /already exists/);
    assert.ok((await readFile(path.join(root, "report.docx"))).equals(existing), "the file is unchanged");
    const answer = firstText(await call(create, { template_path: "brand.dotx", output_path: "report.docx", markdown: "# New", overwrite: true }));
    assert.match(answer, /report\.docx/);
    assert.equal(readWordPackage(await readFile(path.join(root, "report.docx")), "the result").isTemplate, false);
  });

  // openlore: scenario=AMermaidFenceBecomesAPicture spec=docx-templates
  test("AMermaidFenceBecomesAPicture: docx_create draws a ```mermaid fence in its place, with nothing to report", async () => {
    const create = createDocxCreateToolDefinition(options);
    const answer = firstText(
      await call(create, { template_path: "brand.dotx", output_path: "flow.docx", markdown: "Before.\n\n```mermaid\nflowchart LR\n  A[Ask] --> B[Write]\n```\n\nAfter.\n", overwrite: true }),
    );
    assert.doesNotMatch(answer, /Note:/, answer);
    const parts = unzipDocx(await readFile(path.join(root, "flow.docx")));
    const svgs = [...parts.keys()].filter((name) => name.startsWith("word/media/") && name.endsWith(".svg"));
    assert.equal(svgs.length, 1);
    assert.match(parts.get(svgs[0]!)!.toString("utf8").replace(/<[^>]+>/g, ""), /Ask[\s\S]*Write/);
    assert.equal([...parts.keys()].filter((name) => name.startsWith("word/media/") && name.endsWith(".png")).length, 1);
    const body = parts.get("word/document.xml")!.toString("utf8");
    assert.ok(body.indexOf("Before.") < body.indexOf("svgBlip") && body.indexOf("svgBlip") < body.indexOf("After."), "in its place");
    assert.doesNotMatch(body, /flowchart LR/, "not written as code");
  });

  // openlore: scenario=AnUndrawableMermaidIsNamed spec=docx-templates
  test("AnUndrawableMermaidIsNamed: a fence Mermaid cannot parse stays its source, and the answer says which and why", async () => {
    const create = createDocxCreateToolDefinition(options);
    const answer = firstText(await call(create, { template_path: "brand.dotx", output_path: "broken.docx", markdown: "```mermaid\nflowchart LR\n  A -->\n```\n", overwrite: true }));
    assert.match(answer, /- Note: mermaid diagram 1 could not be drawn \(Parse error[^)]*\); its source was written as code/);
    assert.match(unzipDocx(await readFile(path.join(root, "broken.docx"))).get("word/document.xml")!.toString("utf8"), /flowchart LR/);
  });

  // openlore: scenario=WithoutARendererTheSourceStays spec=docx-templates
  test("WithoutARendererTheSourceStays: an installation that cannot draw Mermaid writes the source and says so", async () => {
    const create = createDocxCreateToolDefinition({ ...options, mermaid: null });
    const answer = firstText(await call(create, { template_path: "brand.dotx", output_path: "plain.docx", markdown: "```mermaid\nflowchart LR\n  A --> B\n```\n", overwrite: true }));
    assert.match(answer, /- Note: 1 mermaid diagram\(s\) written as their source, as code: this installation cannot draw them/);
    assert.equal([...unzipDocx(await readFile(path.join(root, "plain.docx"))).keys()].filter((name) => name.startsWith("word/media/")).length, 0);
  });

  // openlore: scenario=AMermaidFenceBecomesAPicture spec=docx-templates
  test("docx_update draws a Mermaid fence it appends, through the same pictures", async () => {
    const update = createDocxUpdateToolDefinition(options);
    const answer = firstText(
      await call(update as unknown as Tool, {
        path: "clean.docx",
        output_path: "clean-flow.docx",
        overwrite: true,
        track_changes: false,
        edits: [{ action: "append", markdown: "# Flow\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```\n" }],
      }),
    );
    assert.doesNotMatch(answer, /could not be drawn|written as their source/, answer);
    const parts = unzipDocx(await readFile(path.join(root, "clean-flow.docx")));
    const svg = [...parts.keys()].find((name) => name.startsWith("word/media/") && name.endsWith(".svg"));
    assert.ok(svg, "the appended diagram is a picture");
    assert.match(parts.get(svg)!.toString("utf8"), /Hello/);
  });

  test("PagesHeadingsAndTextAreReported: page count, the two chapters as bookmarks, a clean text check, the pages", async () => {
    const render = createDocxRenderToolDefinition({ ...options, environment: machine("linux").environment });
    const content = await call(render, { path: "clean.docx" });
    const text = firstText(content);
    assert.match(text, /^Rendered `clean\.docx` with LibreOffice: 1 page\(s\)\./);
    assert.match(text, /Chapters \(the PDF's bookmarks\):\n- 1\. Findings\n {2}- 1\.1\. Detail\n- 2\. Next steps/);
    assert.match(text, /Text check: every paragraph of the body is on a page\./);
    if (loadCanvas() !== null) {
      assert.deepEqual(content.slice(1).map((item) => (item.type === "text" ? item.text : item.mimeType)), ["Page 1:", "image/png"]);
    } else {
      assert.match(text, /No page pictures/);
    }
  });

  test("MissingTextIsNamed: a paragraph on no page is named by the text check", async () => {
    const render = createDocxRenderToolDefinition({ ...options, environment: machine("linux").environment });
    const text = firstText(await call(render, { path: "hidden.docx" }));
    assert.match(text, /Text check — 1 paragraph\(s\) on no page: "This sentence is hidden text and appears on no page\."\./);
    assert.ok(text.includes(HIDDEN_TEXT));
  });

  test("WordIsDrivenWithoutDisturbingTheUser: a read-only private copy, invisible, closed unsaved, Word left running", async () => {
    const { environment, calls } = machine("win32");
    const render = createDocxRenderToolDefinition({ ...options, environment });
    const text = firstText(await call(render, { path: "clean.docx" }));
    assert.match(text, /with Word: 1 page\(s\)/);
    assert.doesNotMatch(text, /substitutes fonts/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WORD_SCRIPT]);
    // A private copy of the user's file, never the file itself.
    assert.notEqual(calls[0].env.PI_OUTPOST_RENDER_INPUT, path.join(root, "clean.docx"));
    assert.ok(!calls[0].env.PI_OUTPOST_RENDER_INPUT!.startsWith(root), "the copy is outside the workspace");
    assert.match(calls[0].env.PI_OUTPOST_RENDER_INPUT!, /\.docx$/);
    assert.ok(calls[0].inputExisted);
    assert.ok(!WORD_SCRIPT.includes(root));
    // Documents.Open(FileName, ConfirmConversions=false, ReadOnly=true, AddToRecentFiles=false, …, Format=0, …, Visible=false)
    assert.match(WORD_SCRIPT, /Documents\.Open\(\$env:PI_OUTPOST_RENDER_INPUT, \$false, \$true, \$false(, \$missing){5}, 0, \$missing, \$false\)/);
    // Each table of contents is refreshed first, and before the export: the exporter
    // draws a field's cached result, so a document written from a template rendered its
    // contents as "Error! Bookmark not defined." — the template's entries pointing at
    // bookmarks the new document does not have. A table that cannot refresh is swallowed,
    // because it is not a reason to return no pages at all.
    assert.match(WORD_SCRIPT, /for \(\$i = 1; \$i -le \$doc\.TablesOfContents\.Count; \$i\+\+\) \{ try \{ \$doc\.TablesOfContents\.Item\(\$i\)\.Update\(\) \} catch \{ \} \}/);
    assert.ok(
      WORD_SCRIPT.indexOf("TablesOfContents") < WORD_SCRIPT.indexOf("ExportAsFixedFormat"),
      "the tables are refreshed before the export, not after",
    );
    // PDF (17), with the headings as bookmarks (CreateBookmarks = 1) and the markup shown (Item = 7).
    assert.match(WORD_SCRIPT, /ExportAsFixedFormat\(\$env:PI_OUTPOST_RENDER_OUTPUT, 17, \$false, 0, 0, 1, 1, 7, \$true, \$true, 1\)/);
    // Closed without saving (wdDoNotSaveChanges = 0); Word quits only when nothing else is open.
    assert.match(WORD_SCRIPT, /\$doc\.Close\(0\)/);
    assert.match(WORD_SCRIPT, /if \(\$app -ne \$null -and \$app\.Documents\.Count -eq 0\) \{ \$app\.Quit\(\[ref\]0\) \}/);
    // Word declares Quit's arguments ByRef: a plain 0 makes PowerShell throw inside the
    // finally, so the PDF is written, the script exits non-zero, the conversion is thrown
    // away and the Word process is left running. Only [ref] gets an exit code of 0.
    assert.doesNotMatch(WORD_SCRIPT, /\$app\.Quit\(\s*0\s*\)/);
    assert.doesNotMatch(WORD_SCRIPT, /Visible\s*=\s*\$true|\.Save\(/);
  });
});
