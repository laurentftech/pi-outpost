import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function message(model, content, stopReason) {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function assertWorkPlanSchema(context, { expectExtended }) {
  const tool = context.tools?.find((candidate) => candidate.name === "work_plan");
  if (!tool) throw new Error("work_plan was not exposed to the provider");
  const extended = context.tools?.find((candidate) => candidate.name === "work_plan_extended");
  // The whole point of the split, seen from where it matters: a provider serving a
  // session with no plan is never sent the collection shapes.
  //
  // Only the embedded runtime can withhold it. Inside a real RPC child both tools are
  // published at all times — that dialect has no command for the active toolset — so
  // the absence is asserted only where the test says it should hold.
  const gated = process.env.WORK_PLAN_EXPECT_GATED === "1";
  if (expectExtended && !extended) throw new Error("work_plan_extended was not published once a plan existed");
  if (gated && !expectExtended && extended) throw new Error("work_plan_extended reached a provider before any plan existed");

  const empty = [];
  const walk = (value, at) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (Object.keys(value).length === 0) empty.push(at);
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child)) child.forEach((item, index) => walk(item, `${at}.${key}[${index}]`));
      else walk(child, `${at}.${key}`);
    }
  };
  for (const published of [tool, ...(extended ? [extended] : [])]) {
    walk(published.parameters, `$${published.name}`);
    // One object whose `action` enumerates the operations — not a union of
    // branches, whose failures pi reports all at once.
    if (published.parameters.anyOf) throw new Error(`${published.name} provider schema is a union again`);
  }
  if (empty.length > 0) throw new Error(`unconstrained work_plan schemas reached provider: ${empty.join(", ")}`);

  const actions = tool.parameters.properties?.action?.enum;
  for (const action of ["get", "clear", "create", "add_task", "update_task", "move_task", "remove_task"]) {
    if (!actions?.includes(action)) throw new Error(`work_plan provider schema does not offer ${action}`);
  }
  for (const action of ["replace", "set_dependencies", "set_resources", "set_evidence"]) {
    if (actions?.includes(action)) throw new Error(`work_plan provider schema still carries ${action}`);
  }
  // Creation describes titles and statuses, never the collections a task acquires later.
  const creationTask = tool.parameters.properties?.tasks?.items?.properties;
  if (creationTask?.evidence || creationTask?.resources) throw new Error("creation still advertises its collections");
  if (!extended) return;

  const extendedActions = extended.parameters.properties?.action?.enum;
  for (const action of ["replace", "set_dependencies", "set_resources", "set_evidence"]) {
    if (!extendedActions?.includes(action)) throw new Error(`work_plan_extended does not offer ${action}`);
  }
  const evidence = extended.parameters.properties?.evidence;
  if (evidence?.type !== "array" || evidence.maxItems !== 100) throw new Error("work_plan_extended does not bound evidence");
  const record = evidence.items;
  if (record?.additionalProperties !== false) throw new Error("work_plan evidence accepts provider-specific fields");
  const results = record?.properties?.result?.enum;
  for (const result of ["passed", "failed", "inconclusive", "informational"]) {
    if (!results?.includes(result)) throw new Error(`work_plan evidence does not offer result ${result}`);
  }
}

function assertWorkPlanGuidance(context) {
  const prompt = String(context.systemPrompt ?? "");
  for (const phrase of ["explicit working state", "Record verification evidence deliberately", "Evidence and task status are independent", "Before resuming substantial work", "Skip a Work Plan for trivial interactions"]) {
    if (!prompt.includes(phrase)) throw new Error(`work_plan system guidance did not reach provider: ${phrase}`);
  }
}

function streamWorkPlan(model, context) {
  const results = context.messages.filter(
    (item) => item.role === "toolResult" && (item.toolName === "work_plan" || item.toolName === "work_plan_extended"),
  );
  // Publication follows the plan, and the plan is made by the first call: every
  // request after it must carry the extended tool, and the first must not.
  assertWorkPlanSchema(context, { expectExtended: results.length > 0 });
  assertWorkPlanGuidance(context);
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (results.length >= 5) {
      const output = message(model, [{ type: "text", text: "Plan updated." }], "stop");
      stream.push({ type: "start", partial: output });
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: "Plan updated.", partial: output });
      stream.push({ type: "done", reason: "stop", message: output });
    } else {
      const createdText = results[0]?.content?.find((item) => item.type === "text")?.text;
      const createdPlan = createdText?.includes("\n") ? JSON.parse(createdText.slice(createdText.indexOf("\n") + 1)) : undefined;
      const argumentsByStep = [
        {
          action: "create",
          title: "RPC release",
          tasks: [{ title: "Verify RPC" }],
        },
        {
          action: "add_task",
          // No `resources` here any more: the published schema is authoritative — pi
          // validates a call against it before the handler ever runs — and the
          // collections belong to work_plan_extended.
          task: { id: "release-note", title: "Write release note", status: "todo", dependsOn: [] },
        },
        {
          tool: "work_plan_extended",
          action: "set_evidence",
          taskId: createdPlan?.tasks?.[0]?.id,
          evidence: [
            { id: "focused-tests", type: "test", result: "passed", summary: "Focused tests passed" },
            { id: "external-probe", type: "external-check", result: "failed", summary: "External probe failed" },
          ],
        },
        {
          action: "update_task",
          taskId: createdPlan?.tasks?.[0]?.id,
          // Flat, beside taskId. The `changes` wrapper is no longer published, and the
          // published schema is authoritative: pi validates a tool call against it
          // before the handler runs, so a wrapper the schema does not declare is
          // refused whatever the normaliser would have done with it.
          status: "done",
        },
        { action: "get" },
      ];
      const { tool: calledTool = "work_plan", ...args } = argumentsByStep[results.length];
      const toolCall = {
        type: "toolCall",
        id: `real-rpc-work-plan-${results.length}`,
        name: calledTool,
        arguments: args,
      };
      const output = message(model, [toolCall], "toolUse");
      stream.push({ type: "start", partial: output });
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
      stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
      stream.push({ type: "done", reason: "toolUse", message: output });
    }
    stream.end();
  });
  return stream;
}

export default function (pi) {
  pi.registerProvider("work-plan-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "work-plan-test-api",
    models: [{
      id: "work-plan-test",
      name: "Work Plan Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: streamWorkPlan,
  });
}
