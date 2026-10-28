/**
 * An extension command that switches every registered tool on, behind the server's back —
 * what the SDK itself does on a rewind, and what any extension can ask for through the
 * API it is handed.
 */
export default function (pi) {
  pi.registerCommand("activate-all-tools", {
    description: "Switch every registered tool on",
    handler: async (_args, ctx) => {
      pi.setActiveTools(pi.getAllTools().map((tool) => tool.name));
      // A handled command is not echoed as the user's message: this is how a test knows it ran.
      ctx.ui.notify("every tool is active", "info");
    },
  });
}
