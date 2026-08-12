import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ChatItem, TurnUsage } from "@pi-outpost/shared";
import { SessionAnalysisPanel } from "./SessionAnalysis";
import { analyzeSession } from "../util/sessionAnalysis";

const user = (text: string): ChatItem => ({ kind: "user", text });

const turn = (usage: Partial<TurnUsage> = {}): ChatItem => ({
  kind: "assistant",
  blocks: [],
  usage: { input: 1000, output: 200, cacheRead: 50, cacheWrite: 10, totalTokens: 1260, ...usage },
});

const tool = (overrides: Partial<Extract<ChatItem, { kind: "tool" }>> = {}): ChatItem => ({
  kind: "tool",
  toolCallId: "call-1",
  toolName: "read",
  args: { path: "a.ts" },
  output: "x".repeat(50),
  ...overrides,
});

/** Scopes a query to one section of the panel, where labels repeat. */
function section(title: string) {
  const heading = screen.getByText(title, { selector: "h3" });
  const element = heading.closest("section");
  if (!element) throw new Error(`no section titled ${title}`);
  return within(element);
}

function renderPanel(items: ChatItem[], onJump = vi.fn(), onClose = vi.fn()) {
  render(<SessionAnalysisPanel analysis={analyzeSession(items)} onJump={onJump} onClose={onClose} />);
  return { onJump, onClose };
}

describe("SessionAnalysisPanel", () => {
  it("reports token totals split by kind", () => {
    renderPanel([user("go"), turn(), turn()]);
    const tokens = section("tokens");
    expect(tokens.getByLabelText("total: 3k")).toBeTruthy(); // two turns of 1260, compacted
    expect(tokens.getByLabelText("fresh input: 2k")).toBeTruthy();
    expect(tokens.getByLabelText("output: 400")).toBeTruthy();
    expect(tokens.getByLabelText("cache read: 100")).toBeTruthy();
    expect(tokens.getByLabelText("cache write: 20")).toBeTruthy();
  });

  it("states the absence of pricing instead of plotting zero", () => {
    renderPanel([user("go"), turn(), turn()]);
    expect(screen.getByText(/No turn was priced — this provider reports tokens only/)).toBeTruthy();
    expect(screen.getByText(/no cost to plot/)).toBeTruthy();
  });

  it("reports cost statistics over the priced turns only", () => {
    renderPanel([user("go"), turn({ cost: 0.1 }), turn(), turn({ cost: 0.3 })]);
    const cost = section("cost");
    expect(cost.getByLabelText("total: $0.40")).toBeTruthy();
    expect(cost.getByLabelText("average turn: $0.20")).toBeTruthy();
    expect(cost.getByLabelText("median turn: $0.20")).toBeTruthy();
    expect(cost.getByText(/over 2 priced turns, 1 unpriced/)).toBeTruthy();
  });

  it("leaves unpriced turns out of the cost chart instead of plotting them at zero", () => {
    renderPanel([user("go"), turn({ cost: 0.1 }), turn(), turn({ cost: 0.3 })]);
    const chart = section("cost per turn");
    // Turn 2 is unpriced: it has no point, and its absence is stated.
    expect(chart.getAllByRole("button", { name: /^Turn/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      expect.stringContaining("Turn 1: $0.10"),
      expect.stringContaining("Turn 3: $0.30"),
    ]);
    expect(chart.getByText(/1 unpriced turn left out/)).toBeTruthy();
  });

  it("jumps to the turn behind a chart point", () => {
    const { onJump } = renderPanel([user("go"), turn(), turn()]);
    fireEvent.click(screen.getByRole("button", { name: /Turn 2:/ }));
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("ranks tool calls by the chosen criterion", () => {
    const { onJump } = renderPanel([
      user("go"),
      turn(),
      tool({ toolCallId: "small", output: "a", args: { path: "a/very/long/path/to/a/file.ts" } }),
      tool({ toolCallId: "big", toolName: "bash", output: "y".repeat(900), args: {} }),
    ]);
    const byOutput = screen.getAllByRole("button", { name: /Jump to the .* call/ });
    expect(byOutput[0].getAttribute("aria-label")).toContain("bash");

    fireEvent.change(screen.getByLabelText("rank by"), { target: { value: "input" } });
    const byInput = screen.getAllByRole("button", { name: /Jump to the .* call/ });
    expect(byInput[0].getAttribute("aria-label")).toContain("read");

    fireEvent.click(byInput[0]);
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("puts failures first when ranking by failure and marks them", () => {
    renderPanel([
      user("go"),
      turn(),
      tool({ toolCallId: "ok", output: "z".repeat(500) }),
      tool({ toolCallId: "bad", toolName: "bash", output: "boom", isError: true }),
    ]);
    fireEvent.change(screen.getByLabelText("rank by"), { target: { value: "failure" } });
    const ranked = section("costliest tool calls");
    const rows = ranked.getAllByRole("button", { name: /Jump to the .* call/ });
    expect(rows[0].getAttribute("aria-label")).toContain("bash");
    expect(ranked.getByText("failed")).toBeTruthy();
  });

  it("summarises tools by name with their failures", () => {
    renderPanel([
      user("go"),
      turn(),
      tool({ toolCallId: "a" }),
      tool({ toolCallId: "b", isError: true }),
      tool({ toolCallId: "c", toolName: "bash" }),
    ]);
    const tools = section("tools");
    const readRow = tools.getByText("read").closest("tr");
    expect(readRow?.textContent).toContain("2"); // two calls
    expect(readRow?.textContent).toContain("1"); // one of them failed
    expect(tools.getByText("bash")).toBeTruthy();
  });

  it("ranks requests by consumption and jumps to the user message", () => {
    const { onJump } = renderPanel([
      user("light one"),
      turn({ totalTokens: 10 }),
      user("heavy one"),
      turn({ totalTokens: 5000 }),
    ]);
    const rows = screen.getAllByRole("button", { name: /Jump to the request/ });
    expect(rows[0].getAttribute("aria-label")).toContain("heavy one");
    fireEvent.click(rows[0]);
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("names what is missing rather than showing zeroes", () => {
    renderPanel([user("go"), turn()]);
    expect(screen.getAllByText(/No tool call recorded in this session/).length).toBeGreaterThan(0);
  });

  it("explains an empty session instead of claiming figures", () => {
    renderPanel([user("go")]);
    expect(screen.getByText(/Nothing to analyse yet/)).toBeTruthy();
    expect(screen.queryByText("tokens")).toBeNull();
  });

  it("reflects a turn that completed while it was open", () => {
    const items = [user("go"), turn({ totalTokens: 1000 })];
    const { rerender } = render(
      <SessionAnalysisPanel analysis={analyzeSession(items)} onJump={() => {}} onClose={() => {}} />,
    );
    expect(section("tokens").getByLabelText("total: 1k")).toBeTruthy();

    rerender(
      <SessionAnalysisPanel
        analysis={analyzeSession([...items, turn({ totalTokens: 2000 })])}
        onJump={() => {}}
        onClose={() => {}}
      />,
    );
    expect(section("tokens").getByLabelText("total: 3k")).toBeTruthy();
  });
});

describe("SessionAnalysisPanel — narrow screens", () => {
  const wide = window.innerWidth;

  function resize(width: number) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  }

  afterEach(() => resize(wide));

  it("closes itself on a jump when it covers the conversation", () => {
    // Below the breakpoint the drawer is full-width: landing behind it would
    // show the user nothing.
    resize(500);
    const { onJump, onClose } = renderPanel([user("go"), turn(), turn()]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Turn 1:/ })[0]);
    expect(onJump).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open on a jump when the conversation is beside it", () => {
    resize(1400);
    const { onJump, onClose } = renderPanel([user("go"), turn(), turn()]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Turn 1:/ })[0]);
    expect(onJump).toHaveBeenCalledWith(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SessionAnalysisPanel — chart geometry", () => {
  /** y of the plotted point for a series, read off the rendered SVG. */
  function pointYs(className: string) {
    return [...document.querySelectorAll(`circle.${className}`)].map((c) => Number(c.getAttribute("cy")));
  }

  it("plots a heavier turn above a lighter one", () => {
    renderPanel([user("go"), turn({ input: 100, totalTokens: 100 }), turn({ input: 5000, totalTokens: 5000 })]);
    const [light, heavy] = pointYs("text-emerald-500");
    // SVG y grows downward: the heavier turn sits at the smaller coordinate.
    expect(heavy).toBeLessThan(light);
  });

  it("keeps every point on the plot when a turn consumed nothing", () => {
    // A zero maximum would divide by zero and put the line off the chart.
    renderPanel([
      user("go"),
      turn({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }),
      turn({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }),
    ]);
    for (const y of pointYs("text-emerald-500")) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThan(0);
    }
  });

  it("scales the chart to fit however many turns it has", () => {
    renderPanel([user("go"), ...Array.from({ length: 40 }, () => turn())]);
    const chart = section("tokens per turn").getByRole("group", { name: "Per-turn chart" });
    // Fixed spacing per turn: a long session scrolls rather than collapsing.
    expect(Number(chart.getAttribute("width"))).toBeGreaterThan(40 * 20);
  });
});
