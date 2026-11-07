/**
 * The context the agent hands a tool after its parameters, for tests of tools that never
 * read it: the built-in file tools and present_structure use only their call id and
 * parameters. Named rather than left out, so a test calls `execute` with its real
 * signature — and a tool that starts reading its context fails loudly on `undefined`
 * instead of passing on a fake that answers anything.
 */
import assert from "node:assert/strict";
import type { AgentToolResult, ExtensionToolContext } from "@earendil-works/pi-coding-agent";

export const UNUSED_TOOL_CONTEXT = undefined as unknown as ExtensionToolContext;

/** The text a tool answered with — what the model reads — checked to be text, not a picture. */
export function textOf(result: AgentToolResult<unknown>, index = 0): string {
  const block = result.content[index];
  assert.equal(block?.type, "text", `content[${index}] is text`);
  return block.type === "text" ? block.text : "";
}
