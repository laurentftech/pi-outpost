import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FindBar } from "./FindBar";

function renderBar(overrides: Partial<React.ComponentProps<typeof FindBar>> = {}) {
  const props = {
    query: "",
    onQueryChange: vi.fn(),
    matchCount: 0,
    currentIndex: -1,
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<FindBar {...props} />);
  return props;
}

describe("FindBar", () => {
  it("focuses and selects the query field on mount", () => {
    renderBar({ query: "outpost" });
    const input = screen.getByLabelText("Find") as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("outpost".length);
  });

  it("shows the current match out of the total", () => {
    renderBar({ matchCount: 17, currentIndex: 2 });
    expect(screen.getByText("3/17")).toBeInTheDocument();
  });

  it("marks the count as truncated when there may be more matches than shown", () => {
    renderBar({ matchCount: 3000, currentIndex: 0, truncated: true });
    expect(screen.getByText("1/3000+")).toBeInTheDocument();
  });

  it("shows a searching state instead of 0/0 while a PDF index is still building", () => {
    renderBar({ matchCount: 0, searching: true });
    expect(screen.getByText("searching…")).toBeInTheDocument();
  });

  it("shows 0/0 when nothing matches and nothing is in progress", () => {
    renderBar({ matchCount: 0 });
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("calls onNext for the next control and Enter", () => {
    const props = renderBar({ matchCount: 2 });
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(props.onNext).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Enter" });
    expect(props.onNext).toHaveBeenCalledTimes(2);
  });

  it("calls onPrev for the previous control and Shift+Enter", () => {
    const props = renderBar({ matchCount: 2 });
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect(props.onPrev).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Enter", shiftKey: true });
    expect(props.onPrev).toHaveBeenCalledTimes(2);
  });

  it("disables next/previous when there are no matches", () => {
    renderBar({ matchCount: 0 });
    expect(screen.getByLabelText("Next match")).toBeDisabled();
    expect(screen.getByLabelText("Previous match")).toBeDisabled();
  });

  it("closes on the close button and on Escape in the query field", () => {
    const props = renderBar();
    fireEvent.click(screen.getByLabelText("Close find bar"));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("reports typed queries", () => {
    const props = renderBar();
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "hello" } });
    expect(props.onQueryChange).toHaveBeenCalledWith("hello");
  });
});
