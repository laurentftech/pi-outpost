/**
 * pptx_layouts, pptx_create and pptx_render as the agent calls them: what comes back,
 * where files land, and every path argument confined to its zone.
 *
 * The office application is replaced by an injected runner that hands back the real
 * LibreOffice rendering in `fixtures/pptx-rendered.pdf`, so the render tool is checked
 * end to end on CI — the text check, the pictures, the PDF it saves — without an
 * office suite installed.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { extractPptx } from "../src/pptx.ts";
import type { RenderEnvironment } from "../src/presentationRender.ts";
import {
  createPptxCreateToolDefinition,
  createPptxLayoutsToolDefinition,
  createPptxRenderToolDefinition,
  type PresentationToolOptions,
} from "../src/presentationTools.ts";
import { realResolve } from "../src/sandbox.ts";
import { readAllZipEntries } from "../src/zip.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Tool = ReturnType<typeof createPptxCreateToolDefinition>;

async function call(tool: Tool, params: Record<string, unknown>): Promise<Content[]> {
  const result = await (tool.execute as unknown as (id: string, params: unknown) => Promise<{ content: Content[] }>)("call-1", params);
  return result.content;
}
const firstText = (content: Content[]) => (content[0] as { text: string }).text;

/** A machine whose only office application is a LibreOffice that returns the fixture PDF. */
function fakeOffice(calls: string[] = []): RenderEnvironment {
  return {
    platform: "linux",
    env: { PATH: "/usr/bin" },
    isFile: async (file) => file === "/usr/bin/soffice",
    run: async (_file, args) => {
      calls.push(args[args.length - 1]);
      await copyFile(path.join(FIXTURES, "pptx-rendered.pdf"), path.join(args[args.indexOf("--outdir") + 1], "deck.pdf"));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    },
  };
}

const NO_OFFICE: RenderEnvironment = {
  platform: "linux",
  env: { PATH: "/usr/bin" },
  isFile: async () => false,
  run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false }),
};

describe("presentation tools", () => {
  let root: string;
  let outside: string;
  let options: PresentationToolOptions;

  before(async () => {
    const base = await mkdtemp(path.join(tmpdir(), "pi-presentation-tools-"));
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));
    await mkdir(path.join(root, "assets"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await copyFile(path.join(FIXTURES, "pptx-template.potx"), path.join(root, "brand.potx"));
    await copyFile(path.join(FIXTURES, "pptx-rendered.pptx"), path.join(root, "rendered.pptx"));
    await copyFile(path.join(FIXTURES, "pptx-template.potx"), path.join(outside, "secret.potx"));
    await writeFile(
      path.join(root, "assets", "diagram.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#2563EB"/></svg>',
    );
    await writeFile(path.join(root, "assets", "remote.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>');
    await writeFile(path.join(outside, "leak.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
    await writeFile(path.join(root, "notes.txt"), "not a picture");
    try {
      await symlink(path.join(outside, "secret.potx"), path.join(root, "linked.potx"));
    } catch {
      // Symlinks need privileges on Windows; the test that uses one checks for it.
    }
    options = {
      cwd: root,
      allowedRoots: [root],
      writableRoot: root,
      maxBytes: 25 * 1024 * 1024,
      render: { renderer: "auto", timeoutMs: 5_000 },
      environment: fakeOffice(),
    };
  });

  describe("pptx_layouts", () => {
    test("lists the template's layouts for the model", async () => {
      const tool = createPptxLayoutsToolDefinition(options);
      assert.equal(tool.name, "pptx_layouts");
      const text = firstText(await call(tool, { path: "brand.potx" }));
      assert.match(text, /\| 2 \| Title and Content \| obj \| title, content \|/);
      assert.match(text, /leaves them out/);
    });

    test("refuses a template outside the sandbox, through a symlink too", async () => {
      const tool = createPptxLayoutsToolDefinition(options);
      await assert.rejects(() => call(tool, { path: path.join(outside, "secret.potx") }), /outside the sandbox/);
      if (existsSync(path.join(root, "linked.potx"))) {
        await assert.rejects(() => call(tool, { path: "linked.potx" }), /outside the sandbox/);
      }
    });

    test("names the file when it is not a template", async () => {
      await assert.rejects(() => call(createPptxLayoutsToolDefinition(options), { path: "notes.txt" }), /"notes\.txt": the template cannot be read/);
      await assert.rejects(() => call(createPptxLayoutsToolDefinition(options), { path: "missing.potx" }), /No such file: missing\.potx/);
      await assert.rejects(
        () => call(createPptxLayoutsToolDefinition({ ...options, maxBytes: 1000 }), { path: "brand.potx" }),
        /larger than the 1 KB template limit/,
      );
    });
  });

  describe("pptx_create", () => {
    test("writes a deck from the template and tells the model to render it next", async () => {
      const tool = createPptxCreateToolDefinition(options);
      const text = firstText(
        await call(tool, {
          template_path: "brand.potx",
          output_path: "deck.pptx",
          slides: [
            { title: "Quarterly review", subtitle: "September" },
            { layout: "Two Content", title: "Architecture", bullets: ["Server", "  Runtime"], image: { path: "assets/diagram.svg", alt: "Diagram" } },
          ],
        }),
      );
      assert.match(text, /^Wrote 2 slide\(s\) to `deck\.pptx`/);
      assert.match(text, /- Slide 1: Title Slide\n- Slide 2: Two Content/);
      assert.match(text, /Next: call pptx_render with path "deck\.pptx"/);
      const extraction = await extractPptx(await readFile(path.join(root, "deck.pptx")), { full: true });
      assert.match(extraction.markdown, /Quarterly review[\s\S]*September[\s\S]*Architecture[\s\S]*Server\nRuntime/);
    });

    test("builds native tables and charts from the tool's parameters", async () => {
      const tool = createPptxCreateToolDefinition(options);
      const text = firstText(
        await call(tool, {
          template_path: "brand.potx",
          output_path: "visuals.pptx",
          slides: [
            { title: "Results", table: { rows: [["Region", "Revenue"], ["EMEA", "4.2"]] } },
            {
              title: "Share",
              chart: { type: "pie", categories: ["EMEA", "APAC"], series: [{ name: "Share", values: [0.6, 0.4] }], number_format: "0%", show_values: true },
            },
          ],
        }),
      );
      assert.match(text, /Wrote 2 slide\(s\)/);
      const deck = await readFile(path.join(root, "visuals.pptx"));
      assert.match((await extractPptx(deck)).markdown, /\| EMEA \| 4\.2 \|/);
      const chart = readAllZipEntries(deck, { maxEntries: 500, maxInflatedBytes: 1e7, maxTotalBytes: 1e8 }).get("ppt/charts/chart1.xml")!.toString("utf8");
      assert.match(chart, /<c:pieChart>/);
      assert.match(chart, /<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"\/>/);
      await assert.rejects(
        () => call(tool, { template_path: "brand.potx", output_path: "bad.pptx", slides: [{ title: "x", chart: { type: "pie", categories: ["a"], series: [{ name: "s", values: [-1] }] } }] }),
        /slide 1: a pie chart cannot show negative values/,
      );
    });

    test("refuses to overwrite unless asked, then replaces the deck whole", async () => {
      const tool = createPptxCreateToolDefinition(options);
      const params = { template_path: "brand.potx", output_path: "again.pptx", slides: [{ title: "First version" }] };
      await call(tool, params);
      await assert.rejects(() => call(tool, params), /"again\.pptx" already exists\. Pass overwrite: true/);
      await call(tool, { ...params, slides: [{ title: "Second version" }], overwrite: true });
      const markdown = (await extractPptx(await readFile(path.join(root, "again.pptx")))).markdown;
      assert.match(markdown, /Second version/);
      assert.doesNotMatch(markdown, /First version/);
    });

    test("writes only a .pptx, and only inside the writable zone", async () => {
      const tool = createPptxCreateToolDefinition(options);
      const slides = [{ title: "x" }];
      await assert.rejects(() => call(tool, { template_path: "brand.potx", output_path: "deck.potx", slides }), /must end in \.pptx/);
      await assert.rejects(
        () => call(tool, { template_path: "brand.potx", output_path: path.join(outside, "deck.pptx"), slides }),
        /outside the writable zone/,
      );
      assert.ok(!existsSync(path.join(outside, "deck.pptx")));
      const readOnly = createPptxCreateToolDefinition({ ...options, writableRoot: null });
      await assert.rejects(() => call(readOnly, { template_path: "brand.potx", output_path: "ro.pptx", slides }), /read-only/);
      await assert.rejects(() => call(tool, { template_path: "brand.potx", output_path: path.join("no-such-dir", "deck.pptx"), slides }), /folder .* does not exist/);
    });

    test("reads the template and every picture only from inside the sandbox", async () => {
      const tool = createPptxCreateToolDefinition(options);
      await assert.rejects(
        () => call(tool, { template_path: path.join(outside, "secret.potx"), output_path: "a.pptx", slides: [{ title: "x" }] }),
        /outside the sandbox/,
      );
      await assert.rejects(
        () => call(tool, { template_path: "brand.potx", output_path: "b.pptx", slides: [{ title: "x", image: { path: path.join(outside, "leak.svg") } }] }),
        /outside the sandbox/,
      );
      if (existsSync(path.join(root, "linked.potx"))) {
        await assert.rejects(
          () => call(tool, { template_path: "linked.potx", output_path: "f.pptx", slides: [{ title: "x" }] }),
          /outside the sandbox/,
        );
      }
      assert.ok(!existsSync(path.join(root, "a.pptx")) && !existsSync(path.join(root, "b.pptx")) && !existsSync(path.join(root, "f.pptx")));
    });

    test("names the slide whose picture it cannot use", async () => {
      const tool = createPptxCreateToolDefinition(options);
      await assert.rejects(
        () => call(tool, { template_path: "brand.potx", output_path: "c.pptx", slides: [{ title: "ok" }, { title: "x", image: { path: "notes.txt" } }] }),
        /Slide 2: "notes\.txt" is not a PNG, JPEG, GIF or SVG image/,
      );
      await assert.rejects(
        () => call(tool, { template_path: "brand.potx", output_path: "d.pptx", slides: [{ title: "x", image: { path: "assets/remote.svg" } }] }),
        /Slide 1: .*outside itself/,
      );
    });

    test("passes on the builder's refusals as the model's to fix", async () => {
      const tool = createPptxCreateToolDefinition(options);
      await assert.rejects(
        () => call(tool, { template_path: "brand.potx", output_path: "e.pptx", slides: [{ layout: "Agenda", title: "x" }] }),
        /no layout named "Agenda". Its layouts are: "Title Slide"/,
      );
    });
  });

  describe("pptx_render", () => {
    test("returns a picture of each slide, with the overflow it found named", async () => {
      const soffice: string[] = [];
      const tool = createPptxRenderToolDefinition({ ...options, environment: fakeOffice(soffice) });
      assert.equal(tool.name, "pptx_render");
      const content = await call(tool, { path: "rendered.pptx" });
      const header = firstText(content);
      assert.match(header, /^Rendered `rendered\.pptx` with LibreOffice: 4 page\(s\) for 4 slide\(s\)\./);
      assert.match(header, /substitutes fonts/);
      assert.match(header, /- Slide 3: 11 paragraph\(s\) not fully visible \(overflow or clipping\): "Paragraph 6 is long enough/);
      assert.doesNotMatch(header, /Slide [124]:/);
      const images = content.filter((item) => item.type === "image");
      assert.equal(images.length, 4);
      assert.deepEqual(
        content.filter((item) => item.type === "text").slice(1).map((item) => (item as { text: string }).text),
        ["Slide 1:", "Slide 2:", "Slide 3:", "Slide 4:"],
      );
      assert.equal(Buffer.from((images[0] as { data: string }).data, "base64").subarray(1, 4).toString("latin1"), "PNG");
      // The converter got a copy, never the workspace file.
      assert.notEqual(soffice[0], path.join(root, "rendered.pptx"));
    });

    test("pictures only the slides asked for, and says the text check is clean for them", async () => {
      const content = await call(createPptxRenderToolDefinition(options), { path: "rendered.pptx", slides: "1-2" });
      assert.match(firstText(content), /Text check: every paragraph of slides 1-2 is visible on the rendered page\./);
      assert.equal(content.filter((item) => item.type === "image").length, 2);
    });

    test("saves the PDF where asked, never over an existing file, never outside the writable zone", async () => {
      const tool = createPptxRenderToolDefinition(options);
      const content = await call(tool, { path: "rendered.pptx", slides: "1", pdf_path: "rendered.pdf" });
      assert.match(firstText(content), /Saved the PDF to `rendered\.pdf`\./);
      assert.ok((await readFile(path.join(root, "rendered.pdf"))).equals(await readFile(path.join(FIXTURES, "pptx-rendered.pdf"))));
      await assert.rejects(() => call(tool, { path: "rendered.pptx", pdf_path: "rendered.pdf" }), /already exists/);
      await assert.rejects(() => call(tool, { path: "rendered.pptx", pdf_path: path.join(outside, "x.pdf") }), /outside the writable zone/);
      await assert.rejects(() => call(tool, { path: "rendered.pptx", pdf_path: "x.png" }), /must end in \.pdf/);
      await assert.rejects(() => call(createPptxRenderToolDefinition({ ...options, writableRoot: null }), { path: "rendered.pptx", pdf_path: "y.pdf" }), /read-only/);
    });

    test("refuses a deck outside the sandbox", async () => {
      await assert.rejects(() => call(createPptxRenderToolDefinition(options), { path: path.join(outside, "secret.potx") }), /outside the sandbox/);
    });

    test("says what to install when no office application can render", async () => {
      await assert.rejects(
        () => call(createPptxRenderToolDefinition({ ...options, environment: NO_OFFICE }), { path: "rendered.pptx" }),
        /No office application could render the presentation:[\s\S]*libreoffice: LibreOffice is not installed[\s\S]*Install LibreOffice/,
      );
    });

    test("is run one call at a time: office applications do not share well", () => {
      assert.equal(createPptxRenderToolDefinition(options).executionMode, "sequential");
    });
  });
});
