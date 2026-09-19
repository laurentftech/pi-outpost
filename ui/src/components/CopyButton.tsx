import { useState } from "react";

/**
 * Copies `text`. `iconOnly` draws a small glyph for a corner — a code block's — with
 * its purpose in the accessible name rather than on the face.
 */
export function CopyButton({ text, className, iconOnly = false }: { text: string; className?: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable or permission denied — nothing actionable to surface
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : iconOnly ? "Copy code" : "Copy"}
      aria-label={iconOnly ? (copied ? "Copied" : "Copy code") : undefined}
      className={
        className ??
        "rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      }
    >
      {iconOnly ? (copied ? "✓" : "⧉") : copied ? "✓ copied" : "⧉ copy"}
    </button>
  );
}
