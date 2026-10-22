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
import { withMermaid } from "../util/mermaidQueue";
import { DIAGRAM_ACTION, DIAGRAM_ACTIONS } from "./diagramControls";

type MermaidTheme = "dark" | "default";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

/**
 * Lazy-load mermaid (heavy) only when a diagram is actually rendered, configured for
 * the screen in this theme.
 *
 * Configured on every call, not once per theme: the Word export reconfigures the same
 * global module for print between two of these, and a cached "already set" would draw
 * the next diagram with whatever the export left. Only ever called inside `withMermaid`.
 */
async function loadMermaid(theme: MermaidTheme) {
  const module = await (mermaidPromise ??= import("mermaid"));
  module.default.initialize({
    startOnLoad: false,
    theme,
    // Mermaid 12's own layout (ELK, its default), drawn in the classic look: crisp
    // boxes, where its new default look puts a blurred halo round every box on a
    // dark page. The Word export draws with the same look.
    look: "classic",
    securityLevel: "strict",
    // On parse errors mermaid injects an error SVG into the document —
    // keep failures inside our fallback <pre> instead
    suppressErrorRendering: true,
  });
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
  const [drawn, setDrawn] = useState<{ svg: string; orientation: Orientation; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadPending = useRef(false);
  const sourceGeneration = useRef(0);
  /**
   * A fresh id for every render. Mermaid removes the element already carrying the id it
   * is given (`removeExistingElements`), and the SVG it returns carries that id — so one
   * id for every render deletes the diagram on screen each time, and keeps it deleted
   * when the new SVG is identical, since React does not rewrite an unchanged innerHTML.
   */
  const renders = useRef(0);
  const renderId = () => `mermaid-${id}-${++renders.current}`;
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
    sourceGeneration.current += 1;
    setDrawn(null);
    setChosen(undefined);
    setEnlarged(false);
    setError(null);
    setDownloadError(null);
    return () => { sourceGeneration.current += 1; };
  }, [code]);

  async function downloadSvg() {
    if (!drawn || downloadPending.current) return;
    downloadPending.current = true;
    setDownloading(true);
    setDownloadError(null);
    const generation = sourceGeneration.current;
    try {
      // The document exporter produces standalone SVG with text labels, explicit
      // dimensions and inline appearance. Export the orientation currently shown.
      const { renderDiagram } = await import("../export/mermaidToImage");
      const image = await renderDiagram(drawn.source, `mermaid-download-${id}`);
      if (generation !== sourceGeneration.current) return;
      const url = URL.createObjectURL(new Blob([image.svg], { type: "image/svg+xml;charset=utf-8" }));
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "diagram.svg";
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (generation === sourceGeneration.current) setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      downloadPending.current = false;
      setDownloading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Debounce: during streaming the code arrives in chunks and intermediate
    // states are invalid diagrams — only render once input settles.
    const timer = setTimeout(() => void withMermaid(async () => {
      try {
        const mermaid = (await loadMermaid(mermaidTheme)).default;
        const source = codeRef.current;
        const read = orientableMermaid(source);
        const asWritten: Orientation = read === undefined ? "landscape" : orientationOfDirection(read.direction);

        // A reader who has chosen is not asking to be measured. Their direction is
        // drawn, once, and nothing about the size of it changes that.
        if (chosen !== undefined && read !== undefined) {
          const wanted = chosen === asWritten ? source : read.turned;
          const { svg } = await mermaid.render(renderId(), wanted);
          if (!cancelled) {
            setDrawn({ svg, orientation: chosen, source: wanted });
            setError(null);
          }
          return;
        }

        const first = await mermaid.render(renderId(), source);
        let result = { svg: first.svg, orientation: asWritten, source };
        const asDrawn = naturalWidth(first.svg);
        // The second render is what it costs to know whether turning would help, and
        // it is paid only by a diagram that is already too wide to read — never by
        // the ones that arrived fine, which is nearly all of them.
        if (read !== undefined && asDrawn !== undefined && asDrawn > READING_WIDTH) {
          const second = await mermaid.render(renderId(), read.turned);
          const turnedWidth = naturalWidth(second.svg);
          if (turnedWidth !== undefined) {
            // The rule takes the landscape width first, whichever of the two that is
            // here: the source may have been written either way round.
            const better =
              asWritten === "landscape"
                ? orientationFor(asDrawn, turnedWidth)
                : orientationFor(turnedWidth, asDrawn);
            if (better !== asWritten) result = { svg: second.svg, orientation: better, source: read.turned };
          }
        }
        if (!cancelled) {
          setDrawn(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setDrawn(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }), 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id, mermaidTheme, chosen]);

  if (svg) {
    return (
      <div
        ref={blockRef}
        className="my-2 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className={`${DIAGRAM_ACTIONS} order-3`}>
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            title={showCode ? "Show diagram" : "Show code"}
            className={DIAGRAM_ACTION}
          >
            {showCode ? "⚏ diagram" : "⌗ code"}
          </button>
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
              className={DIAGRAM_ACTION}
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
              className={DIAGRAM_ACTION}
            >
              ⤢ enlarge
            </button>
          )}
          <button type="button" className={DIAGRAM_ACTION} disabled={downloading} onClick={() => void downloadSvg()}
            title="Save as .svg — insert it as a picture in a document">
            {downloading ? "preparing SVG…" : "⤓ download SVG"}
          </button>
          <CopyButton text={code} className={DIAGRAM_ACTION} />
          {downloadError && <span role="alert" className="text-red-600 dark:text-red-400">Could not download SVG: {downloadError}</span>}
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
          actions={<><button type="button" className={DIAGRAM_ACTION} disabled={downloading} onClick={() => void downloadSvg()}>
            {downloading ? "preparing SVG…" : "⤓ download SVG"}
          </button>{downloadError && <span role="alert" className="text-red-600 dark:text-red-400">Could not download SVG: {downloadError}</span>}</>}
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
