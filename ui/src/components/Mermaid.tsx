import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useThemeContext } from "../theme/ThemeContext";
import { CopyButton } from "./CopyButton";
import { EnlargedView } from "./EnlargedView";
import {
  orientationFor,
  otherOrientation,
  READING_WIDTH,
  type Orientation,
} from "@pi-outpost/shared/diagram-orientation";
import { orientableMermaid, orientationOfDirection } from "./mermaidDirection";

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

/**
 * The diagram's own width, read from its viewBox.
 *
 * Needed because mermaid writes `width="100%"` and a `max-width` on the SVG: it
 * has no intrinsic size, it fills whatever it is put in. Dropped into the
 * overlay's shrink-to-fit box that comes out *smaller* than the chat column —
 * enlarge that shrinks. Giving the box the diagram's real width makes the SVG
 * fill exactly that, and the modal scrolls when it does not fit.
 */
export function naturalWidth(svg: string): number | undefined {
  const viewBox = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  const width = viewBox ? Number(viewBox[1]) : Number.NaN;
  return Number.isFinite(width) && width > 0 ? width : undefined;
}

/**
 * The text of a fenced block, when `children` is the `code` element Markdown puts in
 * a `pre` — and, given a language, only when the fence named it. Null for anything
 * else. The text is as written, trailing newline included.
 */
export function fencedCode(children: React.ReactNode, language?: string): string | null {
  if (children === null || typeof children !== "object" || !("props" in children)) return null;
  const props = children.props as { className?: string; children?: React.ReactNode };
  if (language !== undefined && !new RegExp(`\\blanguage-${language}\\b`).test(props.className ?? "")) return null;
  const content = props.children;
  if (typeof content === "string") return content;
  if (Array.isArray(content) && content.every((part) => typeof part === "string")) return content.join("");
  return null;
}

function mermaidCode(children: React.ReactNode): string | null {
  const code = fencedCode(children, "mermaid");
  return code === null ? null : code.trim();
}

/**
 * A `ReactMarkdown` `pre` renderer: routes ```mermaid fences to `Mermaid`, keeps
 * everything else as plain `<pre>`. Shared by every markdown surface (chat
 * messages, the file-viewer's `.md` preview) so a diagram fence renders the same
 * way wherever it appears, rather than each surface reimplementing the routing.
 */
export function MarkdownPre(props: React.HTMLAttributes<HTMLPreElement>) {
  const { children, ...rest } = props;
  const code = mermaidCode(children);
  if (code !== null) return <Mermaid code={code} />;
  const text = fencedCode(children);
  // The copy control sits in the block's corner, always shown: a hover-only one
  // cannot be found on a touch screen.
  if (text === null) return <pre {...rest}>{children}</pre>;
  return (
    <div className="code-block relative" data-testid="code-block">
      <pre {...rest}>{children}</pre>
      <CopyButton
        iconOnly
        text={text.replace(/\n$/, "")}
        className="absolute right-1.5 top-1.5 rounded border border-zinc-300 bg-white/80 px-1.5 py-0.5 text-xs text-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:text-zinc-100"
      />
    </div>
  );
}

export function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const theme = useThemeContext();
  const mermaidTheme: MermaidTheme = theme === "light" ? "default" : "dark";
  const [drawn, setDrawn] = useState<{ svg: string; orientation: Orientation } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  /**
   * How this source says it runs, and how to say the other — undefined for a notation
   * with no direction of its own, which is how the control knows not to appear.
   */
  const authored = useMemo(() => orientableMermaid(code), [code]);
  const authoredOrientation: Orientation =
    authored === undefined ? "landscape" : orientationOfDirection(authored.direction);
  /** What the reader chose, when they chose. Undefined means "whatever reads better". */
  const [chosen, setChosen] = useState<Orientation | undefined>(undefined);
  const svg = drawn?.svg ?? null;
  /**
   * Drawn against what the source asks for.
   *
   * Said on the block whoever decided it. A reader comparing the picture with the
   * source under `⌗ code` would otherwise find them disagreeing about which way the
   * diagram runs, and have no way to tell which of the two is lying.
   */
  const turnedFromAuthored = drawn !== null && drawn.orientation !== authoredOrientation;
  // The block, not the diagram: it stays mounted whichever face is showing, so
  // the overlay can always tell which tree it belongs to.
  const blockRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    let cancelled = false;
    // Debounce: during streaming the code arrives in chunks and intermediate
    // states are invalid diagrams — only render once input settles.
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await loadMermaid(mermaidTheme)).default;
        const source = codeRef.current;
        const read = orientableMermaid(source);
        const asWritten: Orientation = read === undefined ? "landscape" : orientationOfDirection(read.direction);

        // A reader who has chosen is not asking to be measured. Their direction is
        // drawn, once, and nothing about the size of it changes that.
        if (chosen !== undefined && read !== undefined) {
          const wanted = chosen === asWritten ? source : read.turned;
          const { svg } = await mermaid.render(`mermaid-${id}`, wanted);
          if (!cancelled) {
            setDrawn({ svg, orientation: chosen });
            setError(null);
          }
          return;
        }

        const first = await mermaid.render(`mermaid-${id}`, source);
        let result = { svg: first.svg, orientation: asWritten };
        const asDrawn = naturalWidth(first.svg);
        // The second render is what it costs to know whether turning would help, and
        // it is paid only by a diagram that is already too wide to read — never by
        // the ones that arrived fine, which is nearly all of them.
        if (read !== undefined && asDrawn !== undefined && asDrawn > READING_WIDTH) {
          const second = await mermaid.render(`mermaid-${id}-turned`, read.turned);
          const turnedWidth = naturalWidth(second.svg);
          if (turnedWidth !== undefined) {
            // The rule takes the landscape width first, whichever of the two that is
            // here: the source may have been written either way round.
            const better =
              asWritten === "landscape"
                ? orientationFor(asDrawn, turnedWidth)
                : orientationFor(turnedWidth, asDrawn);
            if (better !== asWritten) result = { svg: second.svg, orientation: better };
          }
        }
        if (!cancelled) {
          setDrawn(result);
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
  }, [code, id, mermaidTheme, chosen]);

  if (svg) {
    return (
      <div
        ref={blockRef}
        className="group relative my-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="absolute left-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            title={showCode ? "Show diagram" : "Show code"}
            className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            {showCode ? "⚏ diagram" : "⌗ code"}
          </button>
        </div>
        <div className="absolute right-2 top-2 z-10 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          {/* Same reason the structured-exchange view has one: a wide diagram in a
              narrow column arrives as a sliver, and scrolling it sideways is not
              reading it. */}
          {/* Only a notation that carries a direction has one to choose. A sequence,
              a pie or a gantt offers nothing here, and its source is never rewritten. */}
          {!showCode && authored !== undefined && drawn !== null && (
            <button
              type="button"
              data-testid="mermaid-orientation"
              // From the previous choice rather than from what is on screen: a second
              // click while the first turn is still being drawn has to queue the other
              // way round, not recompute the same answer and do nothing.
              onClick={() => setChosen((current) => otherOrientation(current ?? drawn.orientation))}
              title={
                drawn.orientation === "portrait"
                  ? "Turn it across the page — it is drawn down"
                  : "Turn it down the page — it is drawn across"
              }
              aria-label={`Turn the diagram ${otherOrientation(drawn.orientation)}`}
              className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              {drawn.orientation === "portrait" ? "↔ landscape" : "↕ portrait"}
            </button>
          )}
          {!showCode && (
            <button
              type="button"
              onClick={() => setEnlarged(true)}
              // Named, not just captioned: the structured-exchange view has an
              // enlarge control of its own, and a page carrying both would
              // otherwise offer two buttons called the same thing.
              aria-label="Show diagram at full size"
              className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              ⤢ enlarge
            </button>
          )}
          <CopyButton text={code} />
        </div>
        {showCode ? (
          // The authored source, always. What was handed to mermaid may have had its
          // direction rewritten; showing that as the agent's own words would be this
          // application putting words in its mouth.
          <pre className="overflow-x-auto font-mono text-xs text-zinc-500 dark:text-zinc-400">{code}</pre>
        ) : (
          <div
            className="flex justify-center overflow-x-auto [&_svg]:max-w-full"
            // eslint-disable-next-line react/no-danger — SVG produced by mermaid with securityLevel strict
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        {turnedFromAuthored && !showCode && (
          // Under the picture rather than over it: a footnote about how the diagram is
          // drawn, not a warning about the diagram. A reader comparing it with the
          // source would otherwise find the two disagreeing and no way to tell which
          // of them is lying.
          <div className="mt-1 text-center text-xs text-zinc-400 dark:text-zinc-600" data-testid="mermaid-turned">
            drawn {drawn?.orientation} to fit — the source asks for {authoredOrientation}
          </div>
        )}
        <EnlargedView
          label="diagram"
          testId="mermaid-enlarged"
          open={enlarged}
          onClose={() => setEnlarged(false)}
          anchorRef={blockRef}
        >
          <div
            style={{ width: naturalWidth(svg) }}
            className="[&_svg]:!h-auto [&_svg]:!max-w-none [&_svg]:!w-full"
            // eslint-disable-next-line react/no-danger — the same SVG, at its own size
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </EnlargedView>
      </div>
    );
  }
  return (
    <pre className="my-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      {code}
      {error && <div className="mt-2 text-red-600 dark:text-red-400">{error}</div>}
    </pre>
  );
}
