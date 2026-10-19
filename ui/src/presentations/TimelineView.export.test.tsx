/**
 * The timeline's own export buttons, and what they tell the reader.
 *
 * The confirmation is cleared by a timer. A test that never waits for it covered that
 * timer only when the run happened to outlive it, which is what made the suite's
 * function coverage move between machines: these drive the clock instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";
import { TimelineView } from "./TimelineView";

const plan: StructuredTimelineData = {
  title: "Programme X",
  time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
  rows: [
    {
      type: "task",
      id: "T1",
      label: "Study",
      items: [
        { type: "activity", id: "study", start: "2027-01-10", end: "2027-03-31", label: "Study" },
        { type: "milestone", id: "srr", date: "2027-04-15", kind: "SRR", label: "Requirements review" },
      ],
    },
  ],
};

/** Let the export's promise settle under fake timers. */
const settle = () => act(async () => {});

describe("the timeline's export confirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:figure");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("says the SVG was downloaded, then clears after a moment", async () => {
    render(<TimelineView data={plan} today={0} />);
    fireEvent.click(screen.getByTestId("timeline-download-svg"));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("SVG downloaded");
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the file a host saved it as, and says so when the host could not", async () => {
    const saveFigure = vi.fn().mockResolvedValueOnce("timeline-programme-x.svg").mockRejectedValueOnce(new Error("disk full"));
    render(<TimelineView data={plan} today={0} saveFigure={saveFigure} />);
    fireEvent.click(screen.getByTestId("timeline-download-svg"));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("timeline-programme-x.svg");
    act(() => vi.advanceTimersByTime(2500));
    fireEvent.click(screen.getByTestId("timeline-download-svg"));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("could not save");
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the markup was copied, then clears after a moment", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    render(<TimelineView data={plan} today={0} />);
    fireEvent.click(screen.getByTestId("timeline-copy-svg"));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("SVG markup copied");
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a drawn item reached by the keyboard", () => {
  it("draws a focus ring while it has focus, and removes it on leaving", () => {
    render(<TimelineView data={plan} today={0} />);
    const milestone = screen.getByRole("button", { name: /Requirements review/ });
    fireEvent.focus(milestone);
    expect(screen.getAllByTestId("timeline-focus-ring")).toHaveLength(1);
    fireEvent.blur(milestone);
    expect(screen.queryByTestId("timeline-focus-ring")).toBeNull();
  });
});
