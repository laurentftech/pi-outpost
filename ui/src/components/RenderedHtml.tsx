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
      // Security: dangerouslySetInnerHTML is safe here because `html` is generated
      // server-side by our own extension render pipeline (configureExtensionRender in
      // extensionRender.ts). It is not user-provided content — no untrusted input ever
      // reaches this component.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
