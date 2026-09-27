/**
 * The template a deck is built on when the user named none.
 *
 * "Make me a deck on the default PowerPoint theme" used to have no answer at all:
 * `template_path` was required, nothing shipped a template, and the only .potx in the
 * repository are the fixtures beside this file. A model asked for exactly that went
 * looking for "template" in the codebase and found them — so the tests here pin both
 * halves: that the built-in template is a real, Office-themed one, and that the tools
 * reach it without a path while still confining every path they are given.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";
import { DEFAULT_TEMPLATE_NAME, defaultTemplateBytes } from "../src/defaultTemplate.ts";
import { describeTemplate, readTemplate } from "../src/pptxBuild.ts";
import {
  createPptxCreateToolDefinition,
  createPptxLayoutsToolDefinition,
  type PresentationToolOptions,
} from "../src/presentationTools.ts";
import { realResolve } from "../src/sandbox.ts";
import { readAllZipEntries, readZipEntry } from "../src/zip.ts";

type Content = { type: "text"; text: string };
type Tool = ReturnType<typeof createPptxCreateToolDefinition>;

async function call(tool: Tool, params: Record<string, unknown>): Promise<string> {
  const result = await (tool.execute as unknown as (id: string, params: unknown) => Promise<{ content: Content[] }>)("call-1", params);
  return result.content[0].text;
}

const LIMITS = { maxEntries: 500, maxInflatedBytes: 8 * 1024 * 1024 };
const entry = (name: string): string => {
  const bytes = readZipEntry(defaultTemplateBytes(), name, LIMITS);
  assert.notEqual(bytes, null, `${name} is in the package`);
  return bytes!.toString("utf8");
};

describe("the built-in template", () => {
  test("is the same bytes every time it is asked for", () => {
    // Callers cache nothing of their own; a deck built twice must not differ.
    assert.ok(defaultTemplateBytes().equals(defaultTemplateBytes()));
  });

  test("is a template the builder accepts, with the layouts the skill names", () => {
    const described = describeTemplate(readTemplate(defaultTemplateBytes()));
    for (const name of ["Title Slide", "Title and Content", "Two Content", "Picture with Caption", "Section Header", "Title Only", "Blank"]) {
      assert.match(described, new RegExp(`\\| ${name} \\|`), `${name} is offered`);
    }
  });

  test("carries no slides of its own", () => {
    // A template with sample slides would put them in every deck built on it.
    assert.match(entry("ppt/presentation.xml"), /<p:sldIdLst\/>/);
    const names = [...readAllZipEntries(defaultTemplateBytes(), { ...LIMITS, maxTotalBytes: 16 * 1024 * 1024 }).keys()];
    assert.deepEqual(names.filter((name) => name.startsWith("ppt/slides/")), []);
  });

  test("wears Office's own theme, not a made-up one", () => {
    const theme = entry("ppt/theme/theme1.xml");
    // The pair a blank PowerPoint deck uses, and Office's accent1. A model told the deck
    // is "the default theme" is entitled to have it look like one.
    assert.match(theme, /<a:latin typeface="Calibri Light"\/>/);
    assert.match(theme, /<a:latin typeface="Calibri"\/>/);
    assert.match(theme, /<a:accent1><a:srgbClr val="4472C4"\/><\/a:accent1>/);
  });

  test("gives the cover's subtitle no bullet", () => {
    // It inherits the master's body style otherwise, and a cover slide comes out with a
    // bullet in front of its subtitle — which no text check reports, only a render shows.
    const titleSlide = entry("ppt/slideLayouts/slideLayout1.xml");
    assert.match(titleSlide, /type="subTitle"[\s\S]*?<a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone\/>/);
  });

  test("is a .potx main part, so the builder turns it into a presentation", () => {
    assert.match(entry("[Content_Types].xml"), /presentationml\.template\.main\+xml/);
  });
});

describe("building with no template named", () => {
  let root: string;
  let options: PresentationToolOptions;

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-default-tmpl-")));
    await mkdir(path.join(root, "sub"), { recursive: true });
    options = { cwd: root, allowedRoots: [root], writableRoot: root, maxBytes: 25 * 1024 * 1024, render: { renderer: "auto", timeoutMs: 120_000 } };
  });

  test("pptx_layouts with no path describes the built-in template", async () => {
    const text = await call(createPptxLayoutsToolDefinition(options) as Tool, {});

    assert.match(text, new RegExp(DEFAULT_TEMPLATE_NAME));
    assert.match(text, /\| Title and Content \|/);
  });

  test("pptx_create with no template_path writes a deck on it", async () => {
    const text = await call(createPptxCreateToolDefinition(options), {
      output_path: "deck.pptx",
      slides: [{ title: "Architecture" }, { layout: "Title and Content", title: "Parts", bullets: ["server", "ui"] }],
    });

    assert.match(text, /Wrote 2 slide\(s\)/);
    const written = await readFile(path.join(root, "deck.pptx"));
    assert.ok(written.length > 0);
    // The deck wears the built-in theme, not something the builder invented.
    const theme = readZipEntry(written, "ppt/theme/theme1.xml", LIMITS)?.toString("utf8") ?? "";
    assert.match(theme, /Calibri Light/);
  });

  test("says which template it used, so a stock deck is never taken for a house style", async () => {
    const text = await call(createPptxCreateToolDefinition(options), {
      output_path: "named.pptx",
      slides: [{ title: "x" }],
    });

    assert.match(text, new RegExp(`on ${DEFAULT_TEMPLATE_NAME}`));
  });

  test("a named template is still read from the workspace, and still named back", async () => {
    await writeFile(path.join(root, "mine.potx"), defaultTemplateBytes());

    const text = await call(createPptxCreateToolDefinition(options), {
      output_path: "from-file.pptx",
      template_path: "mine.potx",
      slides: [{ title: "x" }],
    });

    assert.match(text, /on `mine\.potx`/);
    assert.doesNotMatch(text, new RegExp(DEFAULT_TEMPLATE_NAME));
  });

  test("an empty template_path means no template, not a file named nothing", async () => {
    // Watched live: a model that had just listed the built-in layouts sent
    // `template_path: ""` rather than leaving the key out, on every attempt. Read as a
    // path it resolves to the workspace directory, so every build failed with
    // "No such file: " and the model looped on a deck it never managed to write.
    const text = await call(createPptxCreateToolDefinition(options), {
      output_path: "empty-path.pptx",
      template_path: "",
      slides: [{ title: "x" }],
    });

    assert.match(text, new RegExp(`on ${DEFAULT_TEMPLATE_NAME}`));
    assert.ok((await readFile(path.join(root, "empty-path.pptx"))).length > 0);
  });

  test("pptx_layouts takes an empty path the same way", async () => {
    const text = await call(createPptxLayoutsToolDefinition(options) as Tool, { path: "   " });

    assert.match(text, new RegExp(DEFAULT_TEMPLATE_NAME));
  });

  test("a named template is still confined to the sandbox", async () => {
    // The fallback must not have opened a way to read a file outside the zone.
    await assert.rejects(
      () => call(createPptxCreateToolDefinition(options), { output_path: "no.pptx", template_path: "../outside.potx", slides: [{ title: "x" }] }),
      /Access denied/,
    );
  });

  test("a template that is not one is still refused by name", async () => {
    await writeFile(path.join(root, "notes.txt"), "not a template\n");

    await assert.rejects(
      () => call(createPptxLayoutsToolDefinition(options) as Tool, { path: "notes.txt" }),
      /"notes\.txt": the template cannot be read/,
    );
  });
});
