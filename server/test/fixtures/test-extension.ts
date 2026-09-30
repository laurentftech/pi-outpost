export default (pi: {
  registerCommand: (name: string, opts: { description: string; handler: () => Promise<void> }) => void;
}) => {
  pi.registerCommand("test-ext", { description: "test extension command", handler: async () => {} });
};
