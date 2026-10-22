/** Keep shell control keys while supporting the clipboard conventions of desktop terminals. */
export function terminalKeyboardHandler(terminal: {
  hasSelection(): boolean;
  getSelection(): string;
}, copy: (text: string) => Promise<void>, onCopyError: () => void) {
  return (event: KeyboardEvent): boolean => {
    const key = event.key.toLowerCase();
    const modifier = (event.ctrlKey || event.metaKey) && !event.altKey;
    if (!modifier) return true;
    if (key === "c" && terminal.hasSelection()) {
      if (event.type === "keydown") {
        event.preventDefault();
        const selection = terminal.getSelection();
        void Promise.resolve().then(() => copy(selection)).catch(onCopyError);
      }
      return false;
    }
    // Leave native paste to the browser and xterm's paste listener. This preserves
    // bracketed paste, multiline handling and works without clipboard-read permission.
    if (key === "v") return false;
    return true; // Ctrl+C without selection still sends SIGINT; Ctrl+A/L/etc. stay shell keys.
  };
}
