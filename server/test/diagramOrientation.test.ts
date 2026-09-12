/**
 * The one rule that decides which way a diagram flows.
 *
 * It is tested here, away from either surface that uses it, because its whole value
 * is being the same answer in both. A graph laid out by dagre and a Mermaid diagram
 * measured from its rendered viewBox arrive with two numbers each, and from there
 * they are the same question.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  READING_WIDTH,
  orientationFor,
  otherOrientation,
  type Orientation,
} from "@pi-outpost/shared/diagram-orientation";

describe("the orientation a diagram is drawn in", () => {
  test("a layout that fits the reading width is left landscape", () => {
    // Nothing is lost below the reading width, so there is nothing to buy by turning
    // — and turning a picture the reader could already take in is pure surprise.
    assert.equal(orientationFor(READING_WIDTH - 1, 200), "landscape");
    assert.equal(orientationFor(READING_WIDTH, 200), "landscape");
  });

  test("a layout that overflows and is much narrower turned is turned", () => {
    // The case the whole change exists for: many boxes across, unreadable in a column.
    assert.equal(orientationFor(2400, 600), "portrait");
  });

  test("a layout that overflows and gains nothing by turning is left alone", () => {
    // A wide fan-out that is also deep. Turning it trades one overflowing picture for
    // another, so it does not happen: enlarging and panning are what that diagram has.
    assert.equal(orientationFor(1200, 1100), "landscape");
  });

  test("the margin is what decides, not merely being narrower", () => {
    // Just over the line and just under it, around the same landscape width: a few
    // percent of width is not worth rearranging a diagram the reader is reading.
    assert.equal(orientationFor(1000, 801), "landscape");
    assert.equal(orientationFor(1000, 800), "portrait");
  });

  test("the same widths give the same answer every time", () => {
    // ChoiceIsDeterministic. The figure a reader approves and the figure an agent
    // writes to a path are produced by different processes from the same numbers.
    const answers = new Set<Orientation>();
    for (let attempt = 0; attempt < 50; attempt += 1) answers.add(orientationFor(2400, 600));
    assert.deepEqual([...answers], ["portrait"]);
  });

  test("a width that is not a number rearranges nothing", () => {
    // An unmeasurable layout is not evidence that the diagram is too wide. Treating
    // it as such would turn diagrams for a reason that is really a failed measurement.
    assert.equal(orientationFor(Number.NaN, 600), "landscape");
    assert.equal(orientationFor(2400, Number.NaN), "landscape");
    assert.equal(orientationFor(Number.POSITIVE_INFINITY, 600), "landscape");
  });

  test("the other orientation is the other one", () => {
    assert.equal(otherOrientation("landscape"), "portrait");
    assert.equal(otherOrientation("portrait"), "landscape");
  });
});
