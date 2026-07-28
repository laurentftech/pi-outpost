import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  beforeEach(() => {
    Object.assign(global.navigator, {
      clipboard: { writeText: vi.fn() },
    });
  });

  it("renders copy text initially", () => {
    render(<CopyButton text="test text" />);
    expect(screen.getByRole("button")).toHaveTextContent("copy");
  });

  it("calls navigator.clipboard.writeText on click", async () => {
    render(<CopyButton text="test text" />);
    fireEvent.click(screen.getByRole("button"));
    expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith("test text");
  });

  it("shows 'copied' after click", async () => {
    render(<CopyButton text="test text" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button")).toHaveTextContent("copied");
  });

  it("reverts after timeout", async () => {
    vi.useFakeTimers();
    render(<CopyButton text="test text" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button")).toHaveTextContent("copied");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole("button")).toHaveTextContent("copy");
    vi.useRealTimers();
  });

  it("accepts optional className prop", () => {
    render(<CopyButton text="test text" className="custom-class" />);
    expect(screen.getByRole("button")).toHaveClass("custom-class");
  });

  it("handles clipboard API errors silently", async () => {
    global.navigator.clipboard.writeText = vi.fn(() => Promise.reject(new Error("denied")));
    render(<CopyButton text="test text" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button")).toHaveTextContent("copy");
  });
});
