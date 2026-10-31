/**
 * drawio_check's anchor advice, followed to the letter, converges (drawio-diagrams:
 * FollowingTheAdviceConverges). The diagrams are what Codestral left in live runs, and the ones
 * the viewer corpus holds from other models: whatever a model does with the advice, the advice
 * itself must not send a wire to a point that brings another warning back.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { followAdvice } from "./drawioFollowAdvice.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const files = [
  ...readdirSync(path.join(FIXTURES, "drawio-advice")).filter((name) => name.endsWith(".drawio")).map((name) => path.join("drawio-advice", name)),
  ...readdirSync(path.join(FIXTURES, "drawio")).filter((name) => name.startsWith("live-") && name.endsWith(".drawio")).map((name) => path.join("drawio", name)),
];

describe("following drawio_check's anchor advice", () => {
  // openlore: scenario=FollowingTheAdviceConverges spec=drawio-diagrams
  for (const file of files) {
    test(`FollowingTheAdviceConverges: ${file}`, () => {
      const result = followAdvice(readFileSync(path.join(FIXTURES, file), "utf8"));
      assert.equal(result.looped, false, `the advice went round: ${result.left.join(" | ")}`);
      assert.deepEqual(result.left, [], "every anchor warning gave something to apply, and applying it cleared it");
    });
  }
  test("there are diagrams to follow the advice on", () => assert.ok(files.length >= 7, files.join(", ")));
});
