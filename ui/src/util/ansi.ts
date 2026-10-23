/**
 * ANSI SGR sequences, turned into something a browser can show.
 *
 * Extensions render their widgets and statuses for a terminal, and pi hands that
 * text to any front end unchanged — `ctx.mode` is "rpc" but the styling has
 * already happened. So a widget from little-coder arrives as
 * `ESC[38;2;225;90;31m◆ESC[39m ESC[1mextensionsESC[22m`, and a monospace
 * block that prints its input verbatim shows exactly that.
 *
 * Interpreting the codes rather than deleting them keeps what the extension author
 * meant: the colour separates a heading from a count, and dropping it flattens the
 * widget into an undifferentiated wall. Anything not understood is dropped rather
 * than printed — a stray escape is never content.
 */

export interface AnsiSegment {
  text: string;
  /** A CSS colour, when the sequence named one. */
  color?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * The 16 terminal colours as CSS.
 *
 * Deliberately mid-tone rather than the classic saturated set: these render on
 * both the light and the dark background, and a widget is chrome, not art. Bright
 * black (90) is the one that matters — extensions use it for secondary text.
 */
const BASIC: Record<number, string> = {
  30: "#3f3f46",
  31: "#dc2626",
  32: "#16a34a",
  33: "#ca8a04",
  34: "#2563eb",
  35: "#9333ea",
  36: "#0891b2",
  37: "#71717a",
  90: "#a1a1aa",
  91: "#ef4444",
  92: "#22c55e",
  93: "#eab308",
  94: "#3b82f6",
  95: "#a855f7",
  96: "#06b6d4",
  97: "#d4d4d8",
};

/** Indexed ANSI colour: the basic palette, 6×6×6 cube, then 24 greys. */
function indexedColor(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined;
  if (index < 16) return BASIC[index < 8 ? 30 + index : 90 + index - 8];
  if (index >= 232) {
    const grey = 8 + (index - 232) * 10;
    return `rgb(${grey} ${grey} ${grey})`;
  }
  const value = index - 16;
  const level = (component: number) => component === 0 ? 0 : 55 + component * 40;
  return `rgb(${level(Math.floor(value / 36))} ${level(Math.floor(value / 6) % 6)} ${level(value % 6)})`;
}

/** CSI sequences (colour and cursor alike) plus the two-character escapes. */
const ANSI_PATTERN = /\u001B\[[0-9;:]*[A-Za-z]|\u001B[()][A-Za-z0-9]|\u001B[A-Za-z]/g;

/** Everything an SGR run can say, as it is being accumulated. */
type Style = Omit<AnsiSegment, "text">;

/** Apply one SGR parameter list to the running style. */
function applySgr(style: Style, params: number[]): Style {
  const next: Style = { ...style };
  for (let i = 0; i < params.length; i++) {
    const code = params[i];
    if (code === 0) {
      // Reset: not `{}` by mutation — every attribute has to go.
      for (const key of Object.keys(next) as (keyof Style)[]) delete next[key];
    } else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 39) delete next.color;
    else if (BASIC[code] !== undefined) next.color = BASIC[code];
    else if (code === 38) {
      // 38;2;r;g;b (truecolor) or 38;5;n (256-colour). Consume the arguments either
      // way, so a colour we cannot name does not leave its digits behind as text.
      if (params[i + 1] === 2) {
        const [r, g, b] = [params[i + 2], params[i + 3], params[i + 4]];
        if ([r, g, b].every((v) => Number.isFinite(v))) next.color = `rgb(${r} ${g} ${b})`;
        i += 4;
      } else if (params[i + 1] === 5) {
        const color = indexedColor(params[i + 2]);
        if (color !== undefined) next.color = color;
        i += 2;
      }
    }
    // Background colours are ignored on purpose: a widget sits inside the app's own
    // surface, and a terminal's background would fight it rather than decorate it.
  }
  return next;
}

/**
 * Split styled terminal text into segments. Plain text yields exactly one segment,
 * so a caller can render the common case without inspecting anything.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: Style = {};
  let index = 0;
  ANSI_PATTERN.lastIndex = 0;
  for (let match = ANSI_PATTERN.exec(text); match !== null; match = ANSI_PATTERN.exec(text)) {
    if (match.index > index) segments.push({ text: text.slice(index, match.index), ...style });
    index = match.index + match[0].length;
    const sequence = match[0];
    // Only SGR ("m") carries style; every other CSI is cursor or screen control and
    // has no meaning in a div, so it is simply consumed.
    if (sequence.endsWith("m")) {
      const body = sequence.slice(2, -1);
      const params = body === "" ? [0] : body.split(/[;:]/).map((part) => (part === "" ? 0 : Number(part)));
      style = applySgr(style, params);
    }
  }
  if (index < text.length) segments.push({ text: text.slice(index), ...style });
  return segments;
}

/** The text alone, for titles, search and anything that cannot show style. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

