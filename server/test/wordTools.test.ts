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
import { createDocument } from "../src/docxBuild.ts";
import { readWordPackage } from "../src/docxTemplate.ts";
import { loadCanvas, WORD_SCRIPT, type ProcessResult, type RenderEnvironment } from "../src/presentationRender.ts";
import { realResolve } from "../src/sandbox.ts";
import { createDocxCreateToolDefinition, createDocxRenderToolDefinition, type WordToolOptions } from "../src/wordTools.ts";

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
    // PDF (17), with the headings as bookmarks (CreateBookmarks = 1) and the markup shown (Item = 7).
    assert.match(WORD_SCRIPT, /ExportAsFixedFormat\(\$env:PI_OUTPOST_RENDER_OUTPUT, 17, \$false, 0, 0, 1, 1, 7, \$true, \$true, 1\)/);
    // Closed without saving (wdDoNotSaveChanges = 0); Word quits only when nothing else is open.
    assert.match(WORD_SCRIPT, /\$doc\.Close\(0\)/);
    assert.match(WORD_SCRIPT, /if \(\$app -ne \$null -and \$app\.Documents\.Count -eq 0\) \{ \$app\.Quit\(0\) \}/);
    assert.doesNotMatch(WORD_SCRIPT, /Visible\s*=\s*\$true|\.Save\(/);
  });
});
