import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Rail } from "./Rail";
import { CURRENT_COLOR, laneColor, laneX, ROW_H, type RailRow } from "./lanes";

function row(overrides: Partial<RailRow> = {}): RailRow {
  return { lane: 0, through: [], forkTo: [], lineAbove: true, lineBelow: true, emphasis: "filled", ...overrides };
}

function draw(railRow: RailRow, laneCount = 2) {
  const { container } = render(<Rail row={railRow} laneCount={laneCount} />);
  return container.querySelector("svg")!;
}

describe("Rail", () => {
  it("stays out of the accessibility tree — the row states its identity in text", () => {
    expect(draw(row())).toHaveAttribute("aria-hidden");
  });

  it("draws lane 0 in the reserved current colour", () => {
    const circle = draw(row()).querySelector("circle")!;
    expect(circle).toHaveAttribute("fill", CURRENT_COLOR);
  });

  it("gives each further lane its own colour", () => {
    const line = draw(row({ through: [1] })).querySelector("line")!;
    expect(line).toHaveAttribute("stroke", laneColor(1));
    expect(line).not.toHaveAttribute("stroke", CURRENT_COLOR);
  });

  it("curves a fork downward, towards older rows", () => {
    const path = draw(row({ forkTo: [1] })).querySelector("path")!;
    // Ends at the bottom edge of the row, on the lane it forked to
    expect(path.getAttribute("d")).toContain(`${laneX(1)} ${ROW_H}`);
  });

  it("curves a merge upward, mirroring the fork", () => {
    const path = draw(row({ mergeFrom: [1] })).querySelector("path")!;
    expect(path.getAttribute("d")).toContain(`${laneX(1)} 0`);
  });

  it("marks the current row with a ring around its node", () => {
    const circles = draw(row({ emphasis: "current" })).querySelectorAll("circle");
    expect(circles).toHaveLength(2);
    expect(circles[0]).toHaveAttribute("fill", "none");
  });

  it("hollows out a node that is off the current line", () => {
    const circle = draw(row({ emphasis: "hollow" })).querySelector("circle")!;
    expect(circle).toHaveAttribute("stroke-width", "1.5");
    expect(circle).not.toHaveAttribute("fill", CURRENT_COLOR);
  });

  it("dashes the rail of a row that is not a commit", () => {
    const line = draw(row({ dashed: true })).querySelector("line")!;
    expect(line).toHaveAttribute("stroke-dasharray");
    expect(draw(row()).querySelector("line")).not.toHaveAttribute("stroke-dasharray");
  });
});
