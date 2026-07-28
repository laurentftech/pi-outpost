import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
