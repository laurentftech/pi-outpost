import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelBar } from "./ModelBar";
import type { SessionUsage } from "../util/sessionUsage";

const NOTHING: SessionUsage = {
  cost: 0,
  unpriced: 0,
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
};

function renderBar(sessionUsage: SessionUsage) {
  return render(
    <ModelBar
      model="anthropic/claude-opus-5"
      models={[{ provider: "anthropic", id: "claude-opus-5" }]}
      thinkingLevel="off"
      modelSupportsReasoning={false}
      isStreaming={false}
      contextUsage={null}
      sessionUsage={sessionUsage}
      isCompacting={false}
      onSetModel={() => {}}
      onSetThinking={() => {}}
      onCompact={() => {}}
    />,
  );
}

describe("ModelBar usage indicator", () => {
  it("claims nothing when no turn has reported figures", () => {
    renderBar(NOTHING);
    expect(screen.queryByText(/tok/)).toBeNull();
  });

  it("shows tokens and cost once a turn reports both", () => {
    renderBar({ ...NOTHING, turns: 1, totalTokens: 12_400, cost: 0.42, input: 10_000, output: 2_400 });
    expect(screen.getByText("12k tok")).toBeTruthy();
    expect(screen.getByText("$0.42")).toBeTruthy();
  });

  it("shows tokens and no amount against a provider that prices nothing", () => {
    // The self-hosted case: counters exist, no price does. Tokens must still show.
    renderBar({ ...NOTHING, turns: 3, unpriced: 3, totalTokens: 50_000 });
    expect(screen.getByText("50k tok")).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("marks an amount that covers only some of the turns", () => {
    renderBar({ ...NOTHING, turns: 4, unpriced: 2, totalTokens: 9_000, cost: 0.1 });
    expect(screen.getByText(/\$0\.10\*/)).toBeTruthy();
  });

  it("puts the breakdown in the title", () => {
    renderBar({ ...NOTHING, turns: 2, totalTokens: 100, input: 60, output: 30, cacheRead: 8, cacheWrite: 2 });
    const title = screen.getByTitle(/2 turns/);
    expect(title.getAttribute("title")).toContain("input 60");
    expect(title.getAttribute("title")).toContain("cache write 2");
  });

  it("reflects a completed turn without a reload", () => {
    const { rerender } = renderBar({ ...NOTHING, turns: 1, totalTokens: 1_000, cost: 0.01 });
    expect(screen.getByText("1k tok")).toBeTruthy();

    rerender(
      <ModelBar
        model="anthropic/claude-opus-5"
        models={[{ provider: "anthropic", id: "claude-opus-5" }]}
        thinkingLevel="off"
        modelSupportsReasoning={false}
        isStreaming={false}
        contextUsage={null}
        sessionUsage={{ ...NOTHING, turns: 2, totalTokens: 3_000, cost: 0.03 }}
        isCompacting={false}
        onSetModel={() => {}}
        onSetThinking={() => {}}
        onCompact={() => {}}
      />,
    );
    expect(screen.getByText("3k tok")).toBeTruthy();
    expect(screen.getByText("$0.03")).toBeTruthy();
  });
});
