export default (pi) => {
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });

  pi.registerCommand("time", {
    description: "Show current time",
    handler: async (args, ctx) => {
      const now = new Date();
      ctx.ui.notify(`It's ${now.toLocaleTimeString("en-US")}`, "info");
    },
  });

  pi.on("input", (event) => {
    if (event.text.startsWith("!hello")) {
      return { action: "handled" };
    }
    return { action: "continue" };
  });
};
