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

function assertWorkPlanSchema(context) {
  const tool = context.tools?.find((candidate) => candidate.name === "work_plan");
  if (!tool) throw new Error("work_plan was not exposed to the provider");
  const empty = [];
  const walk = (value, at) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (Object.keys(value).length === 0) empty.push(at);
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child)) child.forEach((item, index) => walk(item, `${at}.${key}[${index}]`));
      else walk(child, `${at}.${key}`);
    }
  };
  walk(tool.parameters, "$parameters");
  if (empty.length > 0) throw new Error(`unconstrained work_plan schemas reached provider: ${empty.join(", ")}`);
  // One object whose `action` enumerates the operations — not a union of
  // branches, whose failures pi reports all at once.
  if (tool.parameters.anyOf) throw new Error("work_plan provider schema is a union again");
  const actions = tool.parameters.properties?.action?.enum;
  for (const action of ["get", "clear", "create", "replace", "add_task", "update_task", "move_task", "remove_task", "set_dependencies", "set_resources", "set_evidence"]) {
    if (!actions?.includes(action)) throw new Error(`work_plan provider schema does not offer ${action}`);
  }
  const evidence = tool.parameters.properties?.evidence;
  if (evidence?.type !== "array" || evidence.maxItems !== 100) throw new Error("work_plan provider schema does not bound evidence");
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
  assertWorkPlanSchema(context);
  assertWorkPlanGuidance(context);
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const results = context.messages.filter((item) => item.role === "toolResult" && item.toolName === "work_plan");
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
          task: { id: "release-note", title: "Write release note", status: "todo", dependsOn: [], resources: [] },
        },
        {
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
      const toolCall = {
        type: "toolCall",
        id: `real-rpc-work-plan-${results.length}`,
        name: "work_plan",
        arguments: argumentsByStep[results.length],
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
