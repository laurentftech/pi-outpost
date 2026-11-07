/**
 * Test / bench fixture: a tool that reports how far along it is.
 *
 * The documented pattern for a long-running extension tool — call `onUpdate` with
 * a `0..1` fraction in `details.progress` as work proceeds. Load it under
 * `BENCH_LIVE=1` (a real model has to choose to call it); the offline bench and
 * e2e drive the same wire path through fake-pi-rpc's `progressDemo` scripting.
 */
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

const parameters = Type.Object({
  steps: Type.Optional(Type.Number({ description: "How many progress updates to send (default 4)." })),
});

const progressDemo: ToolDefinition = {
  name: "progress_demo",
  label: "Progress demo",
  description: "Does nothing useful for a few seconds, reporting a completion fraction as it goes.",
  parameters,
  async execute(_toolCallId, params, signal, onUpdate) {
    const steps = Math.max(1, Math.min(20, Number((params as { steps?: number }).steps ?? 4)));
    for (let i = 1; i <= steps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (signal?.aborted) break;
      onUpdate?.({
        content: [{ type: "text", text: `step ${i}/${steps}` }],
        details: { progress: i / steps },
      });
    }
    return { content: [{ type: "text", text: "done" }], details: {} };
  },
};

export default (pi: { registerTool: (tool: ToolDefinition) => void }) => {
  pi.registerTool(progressDemo);
};
