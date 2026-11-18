import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlash } from "./useFlash";

describe("useFlash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a message for the delay, then nothing", () => {
    const { result } = renderHook(() => useFlash<string>(2500));
    act(() => result.current[1]("SVG markup copied"));
    expect(result.current[0]).toBe("SVG markup copied");
    act(() => vi.advanceTimersByTime(2499));
    expect(result.current[0]).toBe("SVG markup copied");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current[0]).toBeNull();
  });

  it("a second message gets the whole delay, not what is left of the first's", () => {
    const { result } = renderHook(() => useFlash<string>(2500));
    act(() => result.current[1]("SVG downloaded"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current[1]("SVG markup copied"));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current[0]).toBe("SVG markup copied");
    act(() => vi.advanceTimersByTime(500));
    expect(result.current[0]).toBeNull();
  });

  it("leaves no timer behind once unmounted", () => {
    const { result, unmount } = renderHook(() => useFlash<string>(2500));
    act(() => result.current[1]("SVG markup copied"));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    // A timer still pending would fire into a component, or a window, that is gone.
    expect(vi.getTimerCount()).toBe(0);
  });
});
