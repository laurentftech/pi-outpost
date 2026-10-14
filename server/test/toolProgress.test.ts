/**
 * The one shape both runtimes use to turn a tool's partial result into a
 * `tool_update` event. The RPC record and the SDK event differ around it; this
 * extraction does not, so it is tested once here and exercised through each
 * runtime in their own suites.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toolUpdateEvent } from "../src/agentRuntime.ts";

describe("toolUpdateEvent", () => {
  test("carries the completion fraction the tool put in details", () => {
    const event = toolUpdateEvent("t1", { content: [{ type: "text", text: "…" }], details: { progress: 0.4 } });
    assert.deepEqual(event, {
      type: "tool_update",
      toolCallId: "t1",
      content: [{ type: "text", text: "…" }],
      progress: 0.4,
      details: { progress: 0.4 },
    });
  });

  test("a partial with no details yields no progress and does not throw", () => {
    const event = toolUpdateEvent("t1", { content: [{ type: "text", text: "…" }] });
    assert.equal(event.progress, undefined);
    assert.deepEqual(event.content, [{ type: "text", text: "…" }]);
  });

  test("no partial result at all yields no content and no progress", () => {
    const event = toolUpdateEvent("t1", undefined);
    assert.deepEqual(event, { type: "tool_update", toolCallId: "t1", content: undefined, progress: undefined });
  });

  test("the fraction is carried raw here — range is enforced later, at the broadcast", () => {
    assert.equal(toolUpdateEvent("t1", { details: { progress: 1.7 } }).progress, 1.7);
    assert.ok(Number.isNaN(toolUpdateEvent("t1", { details: { progress: Number.NaN } }).progress as number));
  });
});
