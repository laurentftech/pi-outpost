/**
 * Puts text on the clipboard, and says whether it did.
 *
 * The clipboard API is refused in a frame whose embedder did not grant
 * `clipboard-write` — an MCP Apps host's sandbox, among others. The older
 * `execCommand("copy")` on a selected text field is not governed by that policy and
 * still works there on a click, so it is the fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(field);
    try {
      field.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
    }
  }
}
