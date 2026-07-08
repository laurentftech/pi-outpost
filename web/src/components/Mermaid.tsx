import { useEffect, useId, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

/** Lazy-load mermaid (heavy) only when a diagram is actually rendered. */
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => {
      module.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        // On parse errors mermaid injects an error SVG into the document —
        // keep failures inside our fallback <pre> instead
        suppressErrorRendering: true,
      });
      return module;
    });
  }
  return mermaidPromise;
}

export function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
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
        const mermaid = (await loadMermaid()).default;
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
  }, [code, id]);

  if (svg) {
    return (
      <div
        className="my-2 flex justify-center overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 [&_svg]:max-w-full"
        // eslint-disable-next-line react/no-danger — SVG produced by mermaid with securityLevel strict
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return (
    <pre className="my-2 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-400">
      {code}
      {error && <div className="mt-2 text-red-400">{error}</div>}
    </pre>
  );
}
