import type { ExtensionAPI, ExtensionCommandContext, InputEvent } from "@earendil-works/pi-coding-agent";

export default (pi: ExtensionAPI) => {
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args: string | undefined, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });

  pi.registerCommand("time", {
    description: "Show current time",
    handler: async (_args: string | undefined, ctx: ExtensionCommandContext) => {
      const now = new Date();
      ctx.ui.notify(`It's ${now.toLocaleTimeString("en-US")}`, "info");
    },
  });

  pi.on("input", (event: InputEvent) => {
    if (event.text.startsWith("!hello")) {
      return { action: "handled" as const };
    }
    return { action: "continue" as const };
  });
};
