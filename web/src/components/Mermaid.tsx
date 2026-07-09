import { useEffect, useId, useRef, useState } from "react";
import { useThemeContext } from "../ThemeContext";

type MermaidTheme = "dark" | "default";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
let initializedTheme: MermaidTheme | null = null;

/** Lazy-load mermaid (heavy) only when a diagram is actually rendered. */
async function loadMermaid(theme: MermaidTheme) {
  const module = await (mermaidPromise ??= import("mermaid"));
  if (initializedTheme !== theme) {
    initializedTheme = theme;
    module.default.initialize({
      startOnLoad: false,
      theme,
      securityLevel: "strict",
      // On parse errors mermaid injects an error SVG into the document —
      // keep failures inside our fallback <pre> instead
      suppressErrorRendering: true,
    });
  }
  return module;
}

export function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const theme = useThemeContext();
  const mermaidTheme: MermaidTheme = theme === "light" ? "default" : "dark";
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    let cancelled = false;
    // Debounce: during streaming the code arrives in chunks and intermediate
    // states are invalid diagrams — only render once input settles.
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await loadMermaid(mermaidTheme)).default;
        const { svg } = await mermaid.render(`mermaid-${id}`, codeRef.current);
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id, mermaidTheme]);

  if (svg) {
    return (
      <div
        className="my-2 flex justify-center overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 [&_svg]:max-w-full dark:border-zinc-800 dark:bg-zinc-900"
        // eslint-disable-next-line react/no-danger — SVG produced by mermaid with securityLevel strict
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return (
    <pre className="my-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      {code}
      {error && <div className="mt-2 text-red-600 dark:text-red-400">{error}</div>}
    </pre>
  );
}
