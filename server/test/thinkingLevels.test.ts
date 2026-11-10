/**
 * The wire-side sanitiser for a model's accepted thinking levels. Both runtimes
 * feed whatever the SDK / RPC child returned through this before it reaches a
 * client, so the client can trust the shape.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clampThinkingLevel, normalizeThinkingLevels } from "@pi-outpost/shared";

describe("normalizeThinkingLevels", () => {
  test("drops names this build does not know and keeps canonical order", () => {
    assert.deepEqual(normalizeThinkingLevels(["xhigh", "low", "medium", "bogus", "max"]), [
      "low",
      "medium",
      "xhigh",
    ]);
  });

  test("preserves a model's reasoning floor without inventing off", () => {
    assert.deepEqual(normalizeThinkingLevels(["low", "medium", "xhigh"]), ["low", "medium", "xhigh"]);
  });

  test("keeps off available when the model actually reports it", () => {
    assert.deepEqual(normalizeThinkingLevels(["medium", "off", "low"]), ["off", "low", "medium"]);
  });

  test("keeps a genuine off-only set as off-only", () => {
    assert.deepEqual(normalizeThinkingLevels(["off"]), ["off"]);
  });

  test("a set with a gap stays a set with a gap", () => {
    // the qwen3.8-max case: low, medium, xhigh — no high
    const levels = normalizeThinkingLevels(["low", "medium", "xhigh"]);
    assert.ok(levels);
    assert.equal(levels.includes("high"), false);
  });

  test("an empty list, a non-array, or all-unknown names yield undefined", () => {
    assert.equal(normalizeThinkingLevels([]), undefined);
    assert.equal(normalizeThinkingLevels(["bogus", "nope"]), undefined);
    assert.equal(normalizeThinkingLevels(undefined), undefined);
    assert.equal(normalizeThinkingLevels(null), undefined);
    assert.equal(normalizeThinkingLevels("high"), undefined);
    assert.equal(normalizeThinkingLevels(42), undefined);
  });
});

describe("clampThinkingLevel", () => {
  test("keeps a level the model accepts", () => {
    assert.equal(clampThinkingLevel("medium", ["off", "low", "medium", "xhigh"]), "medium");
  });

  test("steps down rather than up: a model that tops out below the current level", () => {
    // The office case: a session on `high` moving to a model that takes nothing.
    assert.equal(clampThinkingLevel("high", ["off"]), "off");
    assert.equal(clampThinkingLevel("high", ["off", "low"]), "low");
  });

  test("steps down over a gap to the nearest level below", () => {
    assert.equal(clampThinkingLevel("high", ["off", "low", "medium", "xhigh"]), "medium");
  });

  test("steps up only when nothing below is on offer", () => {
    assert.equal(clampThinkingLevel("off", ["low", "medium", "high"]), "low");
    assert.equal(clampThinkingLevel("minimal", ["high", "xhigh"]), "high");
  });

  test("an empty set is off", () => {
    assert.equal(clampThinkingLevel("high", []), "off");
  });
});
