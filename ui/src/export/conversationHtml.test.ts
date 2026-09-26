/**
 * The exported document.
 *
 * Every assertion here is about what a stranger opening the file gets: the whole
 * exchange, nothing fetched, nothing that runs. The image loader and the diagram
 * renderer are injected, so what is tested is the document and not the network.
 */
import { describe, it, expect, vi } from "vitest";
import type { ChatItem } from "@pi-outpost/shared";
import {
  conversationToHtml,
  ExportBudgetError,
  type ConversationHtmlOptions,
  type InlineImage,
} from "./conversationHtml";

const meta = {
  project: "pi-outpost",
  session: "Reading back past compaction",
  model: "anthropic/claude-opus-5",
  exportedAt: new Date("2026-09-25T10:00:00Z"),
};

function options(overrides: Partial<ConversationHtmlOptions> = {}): ConversationHtmlOptions {
  return {
    meta,
    loadImage: async () => undefined,
    ...overrides,
  };
}

const image = (bytes = 1_000): InlineImage => ({ dataUrl: "data:image/png;base64,aW1n", bytes });

describe("the document says what it is", () => {
  it("names the project, session, model and date", async () => {
    const html = await conversationToHtml([{ kind: "user", text: "hello" }], options());
    expect(html).toContain("pi-outpost");
    expect(html).toContain("Reading back past compaction");
    expect(html).toContain("anthropic/claude-opus-5");
    expect(html).toContain("2026-09-25");
    expect(html).toContain("<title>Reading back past compaction — pi-outpost</title>");
  });

  it("attributes each message, in the order they were exchanged", async () => {
    const items: ChatItem[] = [
      { kind: "user", text: "first prompt" },
      { kind: "assistant", blocks: [{ type: "text", text: "first reply" }] },
      { kind: "user", text: "second prompt" },
    ];
    const html = await conversationToHtml(items, options());
    const order = [
      html.indexOf("first prompt"),
      html.indexOf("first reply"),
      html.indexOf("second prompt"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain(">You<");
    expect(html).toContain(">Agent<");
  });

  it("carries the compaction boundary and what the agent kept", async () => {
    const items: ChatItem[] = [{ kind: "compaction", summary: "the first hour, in three lines", tokensBefore: 120_000 }];
    const html = await conversationToHtml(items, options());
    expect(html).toContain("conversation compacted here");
    expect(html).toContain("120k tokens summarised");
    expect(html).toContain("the first hour, in three lines");
  });
});

describe("the document is self-contained", () => {
  it("needs no stylesheet, font or script of its own", async () => {
    const html = await conversationToHtml([{ kind: "user", text: "hello" }], options());
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\b/);
    expect(html).toContain("@media (prefers-color-scheme: dark)");
  });

  it("embeds a workspace image rather than pointing at it", async () => {
    const loadImage = vi.fn(async () => image());
    const items: ChatItem[] = [{ kind: "assistant", blocks: [{ type: "text", text: "![plot](plots/a.png)" }] }];
    const html = await conversationToHtml(items, options({ loadImage }));
    expect(loadImage).toHaveBeenCalledWith("plots/a.png");
    expect(html).toContain('src="data:image/png;base64,aW1n"');
    expect(html).not.toContain("plots/a.png");
  });

  it("embeds an attached image from a prompt", async () => {
    const items: ChatItem[] = [{ kind: "user", text: "look", images: [{ data: "aW1n", mimeType: "image/png" }] }];
    const html = await conversationToHtml(items, options());
    expect(html).toContain('src="data:image/png;base64,aW1n"');
  });

  it("leaves a note where a picture could not be had", async () => {
    const items: ChatItem[] = [{ kind: "assistant", blocks: [{ type: "text", text: "![the architecture](gone.png)" }] }];
    const html = await conversationToHtml(items, options({ loadImage: async () => undefined }));
    expect(html).toContain("[image: the architecture]");
    expect(html).not.toContain("<img");
  });

  it("draws a diagram inline as vector graphics", async () => {
    const renderDiagram = vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>');
    const items: ChatItem[] = [
      { kind: "assistant", blocks: [{ type: "text", text: "```mermaid\ngraph TD; a-->b;\n```" }] },
    ];
    const html = await conversationToHtml(items, options({ renderDiagram }));
    expect(renderDiagram).toHaveBeenCalledWith("graph TD; a-->b;\n", expect.stringContaining("pi-export-diagram"));
    expect(html).toContain("<svg");
    expect(html).toContain("<figure");
  });

  it("keeps a diagram's source when it cannot be drawn", async () => {
    const items: ChatItem[] = [
      { kind: "assistant", blocks: [{ type: "text", text: "```mermaid\nnot a diagram\n```" }] },
    ];
    const html = await conversationToHtml(items, options({ renderDiagram: async () => undefined }));
    expect(html).toContain("not a diagram");
    expect(html).not.toContain("<svg");
  });

  it("renders an equation as MathML, which needs nothing attached", async () => {
    const items: ChatItem[] = [{ kind: "assistant", blocks: [{ type: "text", text: "$e^{i\\pi} = -1$" }] }];
    const html = await conversationToHtml(items, options());
    expect(html).toContain("<math");
    // KaTeX's HTML output is what needs its stylesheet and four font files to be legible.
    expect(html).not.toContain("katex-html");
  });

  it("folds a tool call into a disclosure that needs no script", async () => {
    const items: ChatItem[] = [
      { kind: "tool", toolCallId: "t1", toolName: "read", args: { path: "a.txt" }, output: "file body" },
    ];
    const html = await conversationToHtml(items, options());
    expect(html).toContain("<details");
    expect(html).toContain("<summary>read</summary>");
    expect(html).toContain("file body");
    // No `open` attribute: a reader scrolling the conversation is not reading tool output.
    expect(html).not.toContain("<details class=\"tool\" open");
  });
});

describe("the document carries no active content", () => {
  const hostile = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)" />',
    "[click me](javascript:alert(1))",
    "<iframe src=\"https://example.com\"></iframe>",
    '<form action="https://example.com"><input name="password" /></form>',
    '<link rel="stylesheet" href="https://example.com/a.css" />',
    '<style>body { background: url(https://example.com/a.png) }</style>',
  ].join("\n\n");

  it("filters every way a reply could smuggle behaviour into the archive", async () => {
    const items: ChatItem[] = [{ kind: "assistant", blocks: [{ type: "text", text: hostile }] }];
    const html = await conversationToHtml(items, options({ loadImage: async () => undefined }));
    const body = html.slice(html.indexOf("</head>"));
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onerror");
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("<iframe");
    expect(body).not.toContain("<form");
    expect(body).not.toContain("<link");
    expect(body).not.toContain("example.com/a.css");
    // A `<style>` element is removed; its text survives as text, exactly as it does in
    // the transcript. Inert either way — what must not exist is a reference the opened
    // file would follow, so that is what is asserted rather than the absence of a string.
    expect(body).not.toMatch(/<style/);
    expect(body).not.toMatch(/(?:href|src)="[^"]*example\.com/);
  });

  it("does not let a reply escape into the document's own structure", async () => {
    const items: ChatItem[] = [
      {
        kind: "assistant",
        blocks: [{ type: "text", text: '</article></main><body onload="alert(1)"><h1>hijacked' }],
      },
    ];
    const html = await conversationToHtml(items, options());
    // One body, one main, and the reply's stray closers are gone: what a message says
    // stays inside the message.
    expect(html.match(/<body/g)?.length).toBe(1);
    expect(html.match(/<\/main>/g)?.length).toBe(1);
    expect(html).not.toContain("onload");
    expect(html).toContain("hijacked");
  });

  it("escapes tool output rather than rendering it", async () => {
    const items: ChatItem[] = [
      {
        kind: "tool",
        toolCallId: "t1",
        toolName: "grep",
        args: {},
        output: "<script>alert('tool')</script>",
      },
    ];
    const html = await conversationToHtml(items, options());
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the embedded content is bounded", () => {
  it("stops and names the size rather than dropping pictures", async () => {
    const items: ChatItem[] = [
      { kind: "assistant", blocks: [{ type: "text", text: "![a](a.png)\n\n![b](b.png)" }] },
    ];
    await expect(
      conversationToHtml(items, options({ loadImage: async () => image(900_000), budgetBytes: 1_000_000 })),
    ).rejects.toThrow(ExportBudgetError);
  });

  it("reports progress so a long export is not silent", async () => {
    const onProgress = vi.fn();
    const items: ChatItem[] = [
      { kind: "user", text: "one" },
      { kind: "user", text: "two" },
    ];
    await conversationToHtml(items, options({ onProgress }));
    expect(onProgress).toHaveBeenCalledWith(1, 2);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });
});
