import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SplitDiffBlock, DiffBlock } from "./DiffBlocks";
import type { DiffLine } from "../util/diff";

function getContainer(ui: React.ReactElement) {
  const { container } = render(ui);
  return container.firstElementChild as HTMLElement;
}

describe("SplitDiffBlock", () => {
  const sample: DiffLine[] = [
    { type: "same", text: "same" },
    { type: "del", text: "gone" },
    { type: "add", text: "added" },
  ];

  it("renders diff lines", () => {
    render(<SplitDiffBlock lines={sample} />);
    expect(screen.getAllByText("same")).toHaveLength(2);
    expect(screen.getByText("gone")).toBeInTheDocument();
    expect(screen.getByText("added")).toBeInTheDocument();
  });

  it("has border and font-mono class", () => {
    const el = getContainer(<SplitDiffBlock lines={sample} />);
    expect(el).toHaveClass("border", "font-mono");
  });

  it("fill false applies max-h-72", () => {
    const el = getContainer(<SplitDiffBlock lines={sample} fill={false} />);
    expect(el).toHaveClass("max-h-72");
  });

  it("fill true applies max-h-full", () => {
    const el = getContainer(<SplitDiffBlock lines={sample} fill={true} />);
    expect(el).toHaveClass("max-h-full");
  });
});

describe("DiffBlock", () => {
  const sample: DiffLine[] = [
    { type: "same", text: "keep" },
    { type: "del", text: "remove" },
    { type: "add", text: "new" },
  ];

  it("renders diff lines", () => {
    render(<DiffBlock lines={sample} />);
    expect(screen.getByText(/^keep$/)).toBeInTheDocument();
    expect(screen.getByText(/\+ new/)).toBeInTheDocument();
    expect(screen.getByText(/remove/)).toBeInTheDocument();
  });

  it("add lines prefixed with +", () => {
    render(<DiffBlock lines={[{ type: "add", text: "new" }]} />);
    expect(screen.getByText(/^\+ new$/)).toBeInTheDocument();
  });

  it("del lines prefixed with unicode minus", () => {
    render(<DiffBlock lines={[{ type: "del", text: "gone" }]} />);
    expect(screen.getByText(/^− gone$/)).toBeInTheDocument();
  });

  it("same lines prefixed with double space", () => {
    // Need a change nearby so the same line isn't collapsed by withContext
    render(<DiffBlock lines={[{ type: "same", text: "keep" }, { type: "add", text: "new" }]} />);
    expect(screen.getByText(/^keep$/)).toBeInTheDocument();
  });

  it("has max-h-72 and font-mono", () => {
    const el = getContainer(<DiffBlock lines={sample} />);
    expect(el).toHaveClass("max-h-72", "font-mono");
  });
});
