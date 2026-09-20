/**
 * What a fake provider is handed, read the way pi-ai 0.86.0 sends it.
 *
 * Providers used to receive `{ systemPrompt, tools, messages }`. Since 0.86.0 they
 * receive a normalized transcript: the prompt and the tool declarations live in the
 * transcript's system messages, so instruction and tool changes survive a resume or a
 * branch without breaking the cached prefix.
 *
 * These read that, and still accept the old shape, so a fixture asserting "the tool
 * reached the provider" keeps asserting the same thing. Written here rather than
 * imported from `@earendil-works/pi-ai`: these fixtures load both inside an RPC child,
 * where the SDK's own node_modules resolve, and in this repository's process, where
 * pi-ai is only a transitive dependency and does not.
 */

const systemMessages = (context) => (context.messages ?? []).filter((message) => message?.role === "system");

const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .filter((block) => block?.type === "text")
        .map((block) => block.text ?? "")
        .join("");

/** Tools available at the end of the transcript: added by system messages, minus those removed. */
export function toolsOf(context) {
  if (context.tools) return context.tools;
  const tools = new Map();
  for (const message of systemMessages(context)) {
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
  }
  return [...tools.values()];
}

/** The system prompt after replaying every system message: base text, then its sections. */
export function promptOf(context) {
  if (typeof context.systemPrompt === "string") return context.systemPrompt;
  const parts = [];
  const sections = new Map();
  for (const message of systemMessages(context)) {
    const text = textOf(message.content);
    if (text.length > 0) parts.push(text);
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  return [...parts, ...sections.values()].join("\n\n");
}
