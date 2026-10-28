import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExtensionWidgets } from "./ExtensionWidgets";
import type { ExtensionWidget } from "../useAgent";

describe("ExtensionWidgets", () => {
  it("returns null when no widgets match", () => {
    const widgets: Record<string, ExtensionWidget> = {
      w: { lines: ["hello"], placement: "aboveEditor" },
    };
    const { container } = render(<ExtensionWidgets widgets={widgets} placement="belowEditor" />);
    expect(container.firstChild).toBeNull();
  });

  it("filters by placement", () => {
    const widgets: Record<string, ExtensionWidget> = {
      a: { lines: ["above line"], placement: "aboveEditor" },
      b: { lines: ["below line"], placement: "belowEditor" },
    };
    render(<ExtensionWidgets widgets={widgets} placement="aboveEditor" />);
    expect(screen.getByText("above line")).toBeInTheDocument();
    expect(screen.queryByText("below line")).not.toBeInTheDocument();
  });

  it("renders all matching widgets", () => {
    const widgets: Record<string, ExtensionWidget> = {
      w1: { lines: ["line 1", "line 2"], placement: "belowEditor" },
      w2: { lines: ["single"], placement: "belowEditor" },
    };
    const { container } = render(<ExtensionWidgets widgets={widgets} placement="belowEditor" />);
    const divs = container.firstElementChild?.children ?? [];
    expect(divs).toHaveLength(2);
    expect(divs[0]).toHaveTextContent("line 1");
    expect(divs[1]).toHaveTextContent("single");
  });

  // openlore: scenario=TheCloseControlClosesThePanel spec=btw-side-question
  it("gives a widget with a close control a × that runs it, and others none", () => {
    const run = vi.fn();
    const widgets: Record<string, ExtensionWidget> = {
      btw: { lines: ["Side answer · not part of the conversation", "› where?"], placement: "aboveEditor" },
      other: { lines: ["status"], placement: "aboveEditor" },
    };
    render(<ExtensionWidgets widgets={widgets} placement="aboveEditor" controls={{ btw: { close: { label: "Close side answer", run } } }} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close side answer" }));
    expect(run).toHaveBeenCalledTimes(1);
    // Closing is the extension's to do: the widget stays until it clears it.
    expect(screen.getByText("› where?")).toBeInTheDocument();
  });

  // openlore: scenario=ALongAnswerScrollsByKeyboard spec=btw-side-question
  it("bounds a widget's height, keeps its pinned title outside the scrolling region, and lets the region take focus", () => {
    const widgets: Record<string, ExtensionWidget> = {
      btw: { lines: ["Title", ...Array.from({ length: 80 }, (_, i) => `line ${i}`)], placement: "aboveEditor" },
    };
    render(<ExtensionWidgets widgets={widgets} placement="aboveEditor" controls={{ btw: { region: "Side answer", pinnedLines: 1 } }} />);
    const region = screen.getByLabelText("Side answer");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toMatch(/max-h-\[20vh\]/);
    expect(region.className).toMatch(/overflow-y-auto/);
    expect(region).not.toHaveTextContent("Title");
    expect(region).toHaveTextContent("line 79");
    expect(screen.getByText("Title")).toBeInTheDocument();
  });

  // openlore: scenario=AFollowUpSeesTheEarlierSideQuestions spec=btw-side-question
  it("brings the anchor line to the top of the region each time the lines change, and shows blank lines", () => {
    // jsdom lays nothing out: each line sits 16px below the previous one, and scrollTop is recorded.
    const offset = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.parentElement ? [...this.parentElement.children].indexOf(this) * 16 : 0;
    });
    const scrolls: number[] = [];
    const scroll = vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation((value: number) => void scrolls.push(value));
    const control = { region: "Side answer", pinnedLines: 1, anchor: (lines: readonly string[]) => lines.findLastIndex((line) => line.startsWith("› ")) };
    const first = { btw: { lines: ["Title", "› one?", "answer one"], placement: "aboveEditor" as const } };
    const { rerender } = render(<ExtensionWidgets widgets={first} placement="aboveEditor" controls={{ btw: control }} />);
    expect(scrolls.at(-1)).toBe(0);

    const second = { btw: { lines: ["Title", "› one?", "answer one", "", "› two?", "answer two"], placement: "aboveEditor" as const } };
    rerender(<ExtensionWidgets widgets={second} placement="aboveEditor" controls={{ btw: control }} />);
    expect(scrolls.at(-1)).toBe(3 * 16, "the latest question, fourth line of the region, is at its top");
    // The blank separator is a line of its own height, not collapsed.
    expect(screen.getByLabelText("Side answer").children[2]!.className).toMatch(/min-h-4/);
    offset.mockRestore();
    scroll.mockRestore();
  });
});
