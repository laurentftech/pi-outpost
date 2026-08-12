import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GitCommitView } from "./GitCommitView";
import type { GitShowState } from "../useAgent";

const PATCH = [
  "diff --git a/src/main.ts b/src/main.ts",
  "index 1234567..89abcde 100644",
  "--- a/src/main.ts",
  "+++ b/src/main.ts",
  "@@ -1,3 +1,3 @@",
  " const unchanged = 1;",
  "-const before = 2;",
  "+const after = 2;",
  "",
].join("\n");

function show(overrides: Partial<GitShowState> = {}): GitShowState {
  return { sha: "abcdef1234567890", patch: PATCH, truncated: false, ...overrides };
}

function setup(overrides: Partial<GitShowState> = {}) {
  const onClose = vi.fn();
  const view = render(<GitCommitView show={show(overrides)} onClose={onClose} />);
  return { onClose, ...view };
}

/**
 * The rendered row carrying this text, so we can inspect how it was classified.
 * Added and removed rows render their glyph as a separate text node, so the row's
 * text has to be matched as a whole rather than by an exact string.
 */
function row(text: string) {
  return screen.getByText((_, element) => element?.textContent?.trim() === text && element.children.length === 0);
}

describe("GitCommitView", () => {
  it("abbreviates the commit id in the header", () => {
    setup();
    expect(screen.getByText("abcdef123456")).toBeInTheDocument();
  });

  it("marks added and removed lines differently", () => {
    setup();
    // The leading +/- is stripped from the text and replaced by a rendered glyph
    expect(row("+ const after = 2;").className).toMatch(/emerald/);
    expect(row("− const before = 2;").className).toMatch(/red/);
  });

  it("leaves context lines unhighlighted", () => {
    setup();
    const context = row("const unchanged = 1;").className;
    expect(context).not.toMatch(/emerald|red/);
    expect(context).toMatch(/zinc/);
  });

  it("picks out the hunk header", () => {
    setup();
    expect(row("@@ -1,3 +1,3 @@").className).toMatch(/sky/);
  });

  it("treats the file header as a heading, without its diff --git noise", () => {
    setup();
    // "diff --git " is stripped; what remains names the file on both sides
    expect(screen.getByText("a/src/main.ts b/src/main.ts").className).toMatch(/font-bold/);
  });

  it("does not mistake the +++/--- file markers for added and removed lines", () => {
    setup();
    expect(row("+++ b/src/main.ts").className).toMatch(/sky/);
    expect(row("--- a/src/main.ts").className).toMatch(/sky/);
  });

  it("says nothing about truncation for a complete patch", () => {
    setup();
    expect(screen.queryByText(/truncated/i)).not.toBeInTheDocument();
  });

  it("warns when the patch was cut short", () => {
    setup({ truncated: true });
    expect(screen.getByText(/Patch truncated/)).toBeInTheDocument();
  });

  it("closes on the button", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close commit diff" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const { onClose, unmount } = setup();
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders an empty patch without collapsing", () => {
    setup({ patch: "" });
    expect(screen.getByText("abcdef123456")).toBeInTheDocument();
  });
});
