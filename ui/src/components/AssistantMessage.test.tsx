import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { AssistantMessage } from "./AssistantMessage";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

function item(overrides: Partial<AssistantItem> = {}): AssistantItem {
  return { kind: "assistant", blocks: [{ type: "text", text: "Here is the answer." }], ...overrides };
}

type Props = React.ComponentProps<typeof AssistantMessage>;

function setup(overrides: Partial<Props> = {}) {
  const onOpenFile = vi.fn();
  render(<AssistantMessage item={item()} onOpenFile={onOpenFile} {...overrides} />);
  return { onOpenFile };
}

describe("AssistantMessage", () => {
  describe("blocks", () => {
    it("renders the reply as markdown", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "# Title\n\nsome **bold** text" }] }) });
      expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
      expect(screen.getByText("bold").tagName).toBe("STRONG");
    });

    it("renders every text block", () => {
      setup({
        item: item({
          blocks: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        }),
      });
      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.getByText("second")).toBeInTheDocument();
    });

    it("keeps thinking folded away until asked for", () => {
      setup({ item: item({ blocks: [{ type: "thinking", text: "weighing the options" }] }) });
      expect(screen.queryByText("weighing the options")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /thinking/ }));
      expect(screen.getByText("weighing the options")).toBeInTheDocument();
    });

    it("folds it back", () => {
      setup({ item: item({ blocks: [{ type: "thinking", text: "weighing the options" }] }) });
      const toggle = screen.getByRole("button", { name: /thinking/ });
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(screen.queryByText("weighing the options")).not.toBeInTheDocument();
    });

    it("mixes thinking and answer in the order they arrived", () => {
      setup({
        item: item({
          blocks: [
            { type: "thinking", text: "hmm" },
            { type: "text", text: "the answer" },
          ],
        }),
      });
      expect(screen.getByRole("button", { name: /thinking/ })).toBeInTheDocument();
      expect(screen.getByText("the answer")).toBeInTheDocument();
    });
  });

  describe("copying", () => {
    it("offers to copy the finished reply", () => {
      setup();
      expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    });

    it("offers nothing while the reply is still arriving", () => {
      setup({ item: item({ streaming: true }) });
      expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    });

    it("offers nothing for a reply that is only thinking", () => {
      setup({ item: item({ blocks: [{ type: "thinking", text: "hmm" }] }) });
      expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    });
  });

  describe("workspace references", () => {
    it("loads a relative image through the raw-bytes endpoint", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "![plot](out/plot.png)" }] }), token: "secret" });
      const img = screen.getByRole("img", { name: "plot" });
      expect(img.getAttribute("src")).toContain("/files/raw");
      expect(img.getAttribute("src")).toContain("secret");
    });

    it("leaves an external image URL alone", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "![remote](https://example.com/a.png)" }] }) });
      expect(screen.getByRole("img", { name: "remote" })).toHaveAttribute("src", "https://example.com/a.png");
    });

    it("opens a relative link in the viewer instead of navigating away", () => {
      const { onOpenFile } = setup({ item: item({ blocks: [{ type: "text", text: "see [main](src/main.ts)" }] }) });
      fireEvent.click(screen.getByRole("link", { name: "main" }));
      expect(onOpenFile).toHaveBeenCalledWith("src/main.ts");
    });

    it("sends an external link to a new tab, safely", () => {
      const { onOpenFile } = setup({ item: item({ blocks: [{ type: "text", text: "[docs](https://example.com)" }] }) });
      const link = screen.getByRole("link", { name: "docs" });
      fireEvent.click(link);
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    });

    it("treats a relative link as external when nothing can open it", () => {
      render(<AssistantMessage item={item({ blocks: [{ type: "text", text: "[main](src/main.ts)" }] })} />);
      expect(screen.getByRole("link", { name: "main" })).toHaveAttribute("target", "_blank");
    });
  });

  describe("code fences", () => {
    it("routes a mermaid fence to the diagram renderer", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "```mermaid\ngraph TD; A-->B;\n```" }] }) });
      // Before mermaid has drawn anything the renderer shows the source, so finding
      // it proves the fence reached the renderer rather than a plain <pre>
      expect(screen.getByText(/graph TD; A-->B;/)).toBeInTheDocument();
      expect(document.querySelector("pre.my-2")).not.toBeNull();
    });

    it("leaves any other fence as plain code", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "```ts\nconst a = 1;\n```" }] }) });
      expect(screen.getByText(/const a = 1;/)).toBeInTheDocument();
      expect(document.querySelector("pre.my-2")).toBeNull();
    });

    it("leaves a fence with no language as plain code", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "```\nplain\n```" }] }) });
      expect(document.querySelector("pre.my-2")).toBeNull();
    });
  });

  describe("failures", () => {
    it("shows what went wrong alongside whatever arrived", () => {
      setup({ item: item({ errorMessage: "The provider refused the request" }) });
      expect(screen.getByText("Here is the answer.")).toBeInTheDocument();
      expect(screen.getByText("The provider refused the request")).toBeInTheDocument();
    });

    it("shows an error even when no text arrived at all", () => {
      setup({ item: item({ blocks: [], errorMessage: "Connection lost" }) });
      expect(screen.getByText("Connection lost")).toBeInTheDocument();
    });
  });
});
