/**
 * Taking the conversation away.
 *
 * What is asserted here is the promise the file's name makes: it holds the whole
 * conversation, or there is no file. The document itself is covered next door.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatItem } from "@pi-outpost/shared";
import { HistoryError } from "../conversationHistory";
import {
  buildConversationHtml,
  conversationFileName,
  ConversationExportError,
  exportConversation,
} from "./conversationExport";

const save = vi.fn();
vi.mock("../util/download", () => ({ save: (...args: unknown[]) => save(...args) }));

// Mermaid is not loaded in this suite: no diagram appears in these conversations, and
// importing it into jsdom costs seconds for nothing.
vi.mock("./mermaidToImage", () => ({
  renderDiagram: vi.fn(async () => ({ svg: "<svg></svg>", png: new Uint8Array(), width: 1, height: 1 })),
  svgDimensions: () => ({ width: 1, height: 1 }),
  withExplicitSize: (svg: string) => svg,
  inlineStyles: (svg: string) => svg,
}));

const meta = { session: "A long conversation", model: "anthropic/claude-opus-5", exportedAt: new Date("2026-09-25T09:00:00Z") };
const connection = { serverUrl: "", token: null };

const kept: ChatItem[] = [
  { kind: "user", text: "the prompt still in context", entryId: "e9" },
  { kind: "assistant", blocks: [{ type: "text", text: "the reply still in context" }] },
];

beforeEach(() => {
  save.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) })));
});

describe("the export carries the whole conversation", () => {
  it("collects what the transcript never showed", async () => {
    const fetchOlderItems = vi.fn(async (have: number) =>
      have === 0
        ? { items: [{ kind: "user", text: "the very first prompt" } as ChatItem], remaining: 1 }
        : { items: [{ kind: "user", text: "an even earlier prompt" } as ChatItem], remaining: 0 },
    );

    const html = await buildConversationHtml({ items: kept, olderItems: 2, fetchOlderItems, connection, meta });

    expect(fetchOlderItems).toHaveBeenCalledTimes(2);
    expect(html).toContain("an even earlier prompt");
    expect(html).toContain("the very first prompt");
    expect(html).toContain("the prompt still in context");
    // Oldest first: the walk goes backwards, the document must not.
    expect(html.indexOf("an even earlier prompt")).toBeLessThan(html.indexOf("the very first prompt"));
    expect(html.indexOf("the very first prompt")).toBeLessThan(html.indexOf("the prompt still in context"));
  });

  it("asks for nothing when the conversation was never compacted", async () => {
    const fetchOlderItems = vi.fn();
    const html = await buildConversationHtml({ items: kept, olderItems: 0, fetchOlderItems, connection, meta });
    expect(fetchOlderItems).not.toHaveBeenCalled();
    expect(html).toContain("the prompt still in context");
  });
});

describe("the export refuses rather than truncating", () => {
  it("refuses when the runtime cannot read back what compaction removed", async () => {
    await expect(
      buildConversationHtml({ items: kept, olderItems: 30, fetchOlderItems: undefined, connection, meta }),
    ).rejects.toThrow(/cannot be exported in full/);
  });

  it("refuses when a chunk fails, and hands over no file", async () => {
    const fetchOlderItems = vi.fn(async () => {
      throw new HistoryError("the older messages did not arrive", "failed");
    });
    await expect(
      exportConversation({ items: kept, olderItems: 30, fetchOlderItems, connection, meta }),
    ).rejects.toThrow(ConversationExportError);
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses an empty conversation", async () => {
    await expect(buildConversationHtml({ items: [], olderItems: 0, connection, meta })).rejects.toThrow(
      /no conversation to export/,
    );
  });

  it("stops rather than dropping images past the budget", async () => {
    const png = new Uint8Array(600_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: async () => png.buffer,
      })),
    );
    const items: ChatItem[] = [
      { kind: "assistant", blocks: [{ type: "text", text: "![a](a.png)\n\n![b](b.png)" }] },
    ];
    await expect(
      exportConversation({ items, olderItems: 0, connection, meta, budgetBytes: 1_000_000 }),
    ).rejects.toThrow(/over the/);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("the download", () => {
  it("is named after the session and the day", () => {
    expect(conversationFileName("A long conversation", new Date("2026-09-25T09:00:00Z"))).toBe(
      "A-long-conversation-2026-09-25.html",
    );
  });

  it("drops what a filesystem would refuse, and never produces an empty name", () => {
    expect(conversationFileName("../../etc/passwd", new Date("2026-09-25T00:00:00Z"))).toBe("etcpasswd-2026-09-25.html");
    expect(conversationFileName("///", new Date("2026-09-25T00:00:00Z"))).toBe("conversation-2026-09-25.html");
  });

  it("hands the browser one html file", async () => {
    await exportConversation({ items: kept, olderItems: 0, connection, meta });
    expect(save).toHaveBeenCalledTimes(1);
    const [blob, name] = save.mock.calls[0] as [Blob, string];
    expect(name).toBe("A-long-conversation-2026-09-25.html");
    expect(blob.type).toContain("text/html");
    expect(await blob.text()).toContain("the reply still in context");
  });

  it("reports progress through both stages", async () => {
    const onProgress = vi.fn();
    const fetchOlderItems = vi.fn(async () => ({
      items: [{ kind: "user", text: "earlier" } as ChatItem],
      remaining: 0,
    }));
    await buildConversationHtml({ items: kept, olderItems: 1, fetchOlderItems, connection, meta, onProgress });
    expect(onProgress).toHaveBeenCalledWith("collecting", 1, 1);
    expect(onProgress).toHaveBeenCalledWith("rendering", 3, 3);
  });
});
