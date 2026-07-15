export default (pi: {
  registerCommand: (name: string, opts: { description: string }) => void;
}) => {
  pi.registerCommand("test-ext", { description: "test extension command" });
};
