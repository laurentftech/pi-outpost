/**
 * A structured-exchange document written straight into a reply, and the copy control
 * on a reply's code blocks — rendered through the real `AssistantMessage`.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { replyBlockKey } from "@pi-outpost/shared/structured-exchange/reply-blocks";
import { AssistantMessage } from "./AssistantMessage";
import { ReplyConformanceContext } from "./ReplyStructuredExchange";

const graph = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  data: {
    nodes: [
      { id: "parser", label: "Parser" },
      { id: "lexer", label: "Lexer" },
    ],
    edges: [{ from: "parser", to: "lexer", kind: "uses", label: "reads" }],
  },
};

function reply(text: string, statements: Record<string, never> | Record<string, unknown> = {}) {
  const item: Extract<ChatItem, { kind: "assistant" }> = { kind: "assistant", blocks: [{ type: "text", text }] };
  return render(
    <ReplyConformanceContext.Provider value={statements as never}>
      <AssistantMessage item={item} onOpenFile={vi.fn()} />
    </ReplyConformanceContext.Provider>,
  );
}

const fenced = (body: string, language = "json") => `Here it is:\n\n\`\`\`${language}\n${body}\n\`\`\`\n`;

describe("a structured-exchange block in a reply", () => {
  it("is drawn in place of the JSON, with its textual equivalent and its source", () => {
    // AValidBlockIsDrawn
    const body = JSON.stringify(graph, null, 2);
    reply(fenced(body));
    expect(screen.getByTestId("reply-structured-exchange")).toBeInTheDocument();
    expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/show text equivalent/));
    const text = screen.getByTestId("structured-text-equivalent").textContent ?? "";
    expect(text).toContain("Parser");
    expect(text).toContain("reads");

    fireEvent.click(screen.getByText(/show envelope/));
    expect(JSON.parse(screen.getByTestId("structured-envelope").textContent ?? "")).toEqual(graph);
  });

  it("leaves JSON that declares no structured-exchange schema as code", () => {
    // OrdinaryJsonStaysCode
    reply(fenced('{ "name": "pi-outpost", "version": "0.26.0" }'));
    expect(screen.queryByTestId("reply-structured-exchange")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reply-structured-exchange-refused")).not.toBeInTheDocument();
    expect(screen.getByTestId("code-block")).toHaveTextContent('"name": "pi-outpost"');
  });

  it("leaves a document in another fence language as code", () => {
    reply(fenced(JSON.stringify(graph), "ts"));
    expect(screen.queryByTestId("reply-structured-exchange")).not.toBeInTheDocument();
  });

  it("stays code while it is still arriving, and is drawn once it is whole", () => {
    // AStreamingBlockIsDrawnWhenComplete
    const whole = JSON.stringify(graph, null, 2);
    const partial = whole.slice(0, Math.floor(whole.length / 2));
    const view = reply(`Here it is:\n\n\`\`\`json\n${partial}`);
    expect(screen.queryByTestId("reply-structured-exchange")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reply-structured-exchange-refused")).not.toBeInTheDocument();
    expect(screen.getByTestId("code-block")).toBeInTheDocument();

    view.rerender(
      <AssistantMessage item={{ kind: "assistant", blocks: [{ type: "text", text: fenced(whole) }] }} onOpenFile={vi.fn()} />,
    );
    expect(screen.getByTestId("reply-structured-exchange")).toBeInTheDocument();
  });

  it("stays code under a line naming the first rule it breaks when it fails", () => {
    // AFailingBlockSaysWhy
    const broken = { ...graph, data: { ...graph.data, edges: [{ from: "parser", to: "ghost", kind: "uses" }] } };
    reply(fenced(JSON.stringify(broken)));
    const line = screen.getByTestId("reply-structured-exchange-refused");
    expect(line).toHaveTextContent(/could not be drawn/);
    expect(line).toHaveTextContent(/ghost|unresolved|reference/i);
    expect(screen.getByTestId("code-block")).toBeInTheDocument();
    expect(screen.queryByTestId("reply-structured-exchange")).not.toBeInTheDocument();
  });

  it("says a version it does not implement is why it is not drawn", () => {
    reply(fenced(JSON.stringify({ ...graph, schema: "urn:structured-exchange:99" })));
    expect(screen.getByTestId("reply-structured-exchange-refused")).toHaveTextContent(/urn:structured-exchange:99 is not a version/);
  });

  it("carries the server's profile statement for exactly that block, and none without one", () => {
    // AConformingBlockSaysSo, the drawing half; the server half is in server/test/replyStructuredConformance.test.mjs
    const body = JSON.stringify(graph);
    const view = reply(fenced(body), { [replyBlockKey(body)]: { profile: "acme/requirements", state: "conforms", openValues: 0 } });
    expect(screen.getByTestId("structured-conformance")).toHaveTextContent(/acme\/requirements/);
    view.unmount();

    // AProjectWithoutProfilesSaysNothing
    reply(fenced(body), {});
    expect(screen.getByTestId("reply-structured-exchange")).toBeInTheDocument();
    expect(screen.queryByTestId("structured-conformance")).not.toBeInTheDocument();
  });

  it("draws the block in a restored reply as it did live", () => {
    // ARestoredReplyIsDrawnToo — a restored reply is an assistant item like any other,
    // with no streaming flag: the block is drawn from its text alone.
    const item: Extract<ChatItem, { kind: "assistant" }> = {
      kind: "assistant",
      blocks: [{ type: "text", text: fenced(JSON.stringify(graph)) }],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 } as never,
    };
    render(<AssistantMessage item={item} onOpenFile={vi.fn()} />);
    expect(screen.getByTestId("reply-structured-exchange")).toBeInTheDocument();
  });
});

describe("copying a code block", () => {
  const writeText = vi.fn(async () => {});
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText } });
  });
  afterEach(() => writeText.mockClear());

  it("copies the block's content without its fence, and says it copied", async () => {
    // CopyingACodeBlock
    reply(fenced("const answer = 42;\nconsole.log(answer);", "ts"));
    const control = screen.getByRole("button", { name: "Copy code" });
    fireEvent.click(control);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const answer = 42;\nconsole.log(answer);"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
  });

  it("offers one on each code block", () => {
    reply(`${fenced("a", "ts")}\n${fenced("b", "py")}`);
    expect(screen.getAllByRole("button", { name: "Copy code" })).toHaveLength(2);
  });
});
