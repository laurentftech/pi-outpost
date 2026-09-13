/**
 * Taking a table away as Markdown, from the reader's side.
 *
 * What the Markdown says is decided and tested under Node, once. What is left for a
 * mounted component is that the control exists beside CSV and XLSX, and that pressing
 * it hands the browser exactly the Markdown the shared export produces for the rows
 * the reader is looking at.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatItem, StructuredTableData } from "@pi-outpost/shared";
import { tableMarkdown } from "@pi-outpost/shared/structured-exchange/table-export";
import { structuredExchangePresentation } from "./StructuredExchangeView";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const specification = {
  schema: "urn:structured-exchange:2",
  kind: "table",
  data: {
    columns: ["id", "requirement"],
    rows: [
      { heading: "1. Braking", depth: 1 },
      { id: "r1", kind: "requirement", cells: ["REQ-1", "Stop | within 40 m"] },
      { heading: "1.1 Sensing", depth: 2 },
      { id: "r2", kind: "requirement", cells: ["REQ-2", "Read wheel speed"] },
    ],
  },
};

const item: ToolItem = {
  kind: "tool",
  toolCallId: "t1",
  toolName: "present_structure",
  args: {},
  output: "presented",
  structured: JSON.stringify(specification),
};

function captureDownload() {
  const anchors: HTMLAnchorElement[] = [];
  const blobs: Blob[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, ...rest: unknown[]) => {
    const element = realCreate(tag, ...(rest as []));
    if (tag === "a") (element as HTMLAnchorElement).click = () => anchors.push(element as HTMLAnchorElement);
    return element;
  });
  vi.stubGlobal("URL", { ...URL, createObjectURL: (blob: Blob) => (blobs.push(blob), "blob:table"), revokeObjectURL: () => {} });
  return { anchors, blobs };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Markdown export control", () => {
  it("sits beside CSV and XLSX, and hands over the shared export's Markdown for the rows shown", async () => {
    // MarkdownExportRunsWithoutABrowser, from the reader's side: the same text the headless export writes.
    render(<structuredExchangePresentation.Expanded item={item} dispatch={vi.fn()} />);
    expect(screen.getByText(/download CSV/)).toBeTruthy();
    expect(screen.getByText(/download XLSX/)).toBeTruthy();
    const { anchors, blobs } = captureDownload();

    fireEvent.click(screen.getByText(/download Markdown/));

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("table-data.md");
    const text = await blobs[0].text();
    expect(text).toBe(tableMarkdown(specification.data as unknown as StructuredTableData));
    expect(text).toContain("### 1.1 Sensing");
    expect(text).toContain("Stop \\| within 40 m");
  });
});
