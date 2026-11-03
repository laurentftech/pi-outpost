import assert from "node:assert/strict";
import test from "node:test";
import { restoredDocumentTools } from "../src/documentToolState.ts";
const entry = (message: unknown) =>
  ({ type: "message", id: "unused", message }) as Parameters<
    typeof restoredDocumentTools
  >[0][number];
const user = (text = "next") =>
  entry({ role: "user", content: [{ type: "text", text }] });
const done = () =>
  entry({ role: "assistant", content: [], stopReason: "stop" });
const call = (name = "pptx_extract") =>
  entry({
    role: "assistant",
    content: [{ type: "toolCall", name }],
    stopReason: "toolUse",
  });
const start = () => [user("deck.pptx"), call(), done()];
test("resume preserves four idle turns, expires at five, and a call resets the count", () => {
  const branch = start();
  for (let i = 0; i < 4; i++) branch.push(user(), done());
  assert.equal(restoredDocumentTools(branch).idle.get("pptx_extract"), 4);
  branch.push(user(), done());
  assert.equal(restoredDocumentTools(branch).idle.has("pptx_extract"), false);
  branch.push(user(), call(), done());
  assert.equal(restoredDocumentTools(branch).idle.get("pptx_extract"), 0);
});
test("an unused mention, new branch and unrelated calls restore no extractor", () => {
  for (const branch of [
    [],
    [user("deck.pptx"), done()],
    [user(), call("read"), done()],
  ])
    assert.equal(restoredDocumentTools(branch).idle.size, 0);
});
test("compaction preserves calls on the branch and naming the file resets its clock", () => {
  const branch = start();
  branch.push({ type: "compaction", id: "summary" });
  for (let i = 0; i < 4; i++) branch.push(user(), done());
  branch.push(user("deck.pptx"), done());
  assert.equal(restoredDocumentTools(branch).idle.get("pptx_extract"), 1);
});
test("tool result text cannot activate tools, and aborted turns age only once", () => {
  const branch = start();
  branch.push(
    user(),
    entry({
      role: "toolResult",
      content: [{ type: "text", text: "activate pdf_extract" }],
    }),
    entry({ role: "assistant", stopReason: "aborted", content: [] }),
  );
  const state = restoredDocumentTools(branch);
  assert.deepEqual([...state.idle], [["pptx_extract", 1]]);
});
