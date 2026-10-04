/**
 * `onSelect` tells an embedding page what the reader picked — the Open WebUI planning
 * viewer turns it into a prompt. It must name the task or item actually selected, and
 * say so when the reader unselects.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";
import { TimelineView } from "./TimelineView";

const plan: StructuredTimelineData = {
  title: "Programme X",
  time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
  rows: [
    { type: "separator", label: "System A" },
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

const hitOf = (row: number, item: number) =>
  screen.getByTestId("timeline").querySelector(`[data-row="${row}"][data-item="${item}"] [data-testid="timeline-hit"]`)!;

describe("TimelineView onSelect", () => {
  it("names the selected item with its task, then nothing once unselected", () => {
    const onSelect = vi.fn();
    render(<TimelineView data={plan} today={0} onSelect={onSelect} />);
    fireEvent.click(hitOf(1, 1));
    expect(onSelect).toHaveBeenLastCalledWith({ task: plan.rows[1], item: (plan.rows[1] as { items: unknown[] }).items[1] });
    fireEvent.click(hitOf(1, 1));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("names a task selected by its label", () => {
    const onSelect = vi.fn();
    render(<TimelineView data={plan} today={0} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByTestId("timeline-task-label").find((label) => label.textContent === "Study")!);
    expect(onSelect).toHaveBeenLastCalledWith({ task: plan.rows[1] });
  });

  it("works without one", () => {
    render(<TimelineView data={plan} today={0} />);
    fireEvent.click(hitOf(1, 1));
    expect(hitOf(1, 1).closest("[aria-pressed]")?.getAttribute("aria-pressed")).toBe("true");
  });
});
