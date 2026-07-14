/** ANSI→HTML output from pi extension TUI renderers (server-side). */
export function RenderedHtml({
  html,
  className = "",
  as: Element = "div",
}: {
  html: string;
  className?: string;
  as?: "div" | "span";
}) {
  return (
    <Element
      className={`rendered-ansi overflow-x-auto font-mono text-xs leading-relaxed [&_span]:whitespace-pre-wrap ${className}`}
      // Trusted: produced locally by pi extension renderers in the server process.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
