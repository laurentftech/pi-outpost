/**
 * LaTeX, as an equation Word owns.
 *
 * The alternative was a picture of an equation, and a picture cannot sit on a text
 * baseline: Word has no vertical-align for an inline image, so `$x_i$` in the
 * middle of a sentence would ride high and its subscript would hang below the line.
 * OMML is *text* to Word — it takes the paragraph's font and size, it is selectable
 * and searchable, and it opens in the equation editor.
 *
 * The route is KaTeX's own MathML rather than a second TeX engine. KaTeX already
 * renders every equation the viewer shows, and it emits MathML beside its visual
 * output; asking it for that costs nothing and cannot disagree with what was on
 * screen. The element vocabulary it emits is small and closed, which is what makes
 * a hand-written transform tractable and, more to the point, testable.
 *
 * Coverage gaps here are silent — a wrong equation still looks like an equation —
 * so anything unrecognised raises `UnsupportedMathError` and the caller falls back
 * to showing the LaTeX source. A visible `\frac{a}{b}` is a far better failure than
 * a confidently wrong formula.
 */
import {
  MathFraction,
  MathIntegral,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
} from "docx";
import katex from "katex";

/** A component of an equation, as the writer models one. */
type MathComponent = ConstructorParameters<typeof MathSum>[0]["children"][number];

/** Raised when the MathML contains something this transform does not model. */
export class UnsupportedMathError extends Error {
  readonly element: string;

  constructor(element: string) {
    super(`no OMML mapping for MathML element <${element}>`);
    this.name = "UnsupportedMathError";
    this.element = element;
  }
}

/**
 * The n-ary operators Word models as objects of their own.
 *
 * A sum is not a character with a subscript: Word has an n-ary object whose limits
 * sit under and over the sign and grow with it. Mapping these generically would
 * render `∑` at text size with the bounds hanging off its shoulder.
 */
const SUM_SIGNS = new Set(["\u2211"]); // ∑
const INTEGRAL_SIGNS = new Set(["\u222B", "\u222C", "\u222D", "\u222E"]); // ∫ ∬ ∭ ∮

/** Brackets Word draws as a stretching pair rather than as two characters. */
const OPENING_ROUND = new Set(["(", "\u0028"]);
const CLOSING_ROUND = new Set([")", "\u0029"]);

/**
 * The MathML KaTeX produces for a piece of LaTeX.
 *
 * `output: "mathml"` gives the semantic tree without the visual span soup, and
 * `throwOnError: false` means a malformed formula yields KaTeX's own error markup
 * rather than throwing — which the transform then rejects, and the caller shows the
 * source. Either way the export survives one bad equation.
 */
export function mathmlFor(latex: string, displayMode: boolean): Element {
  const html = katex.renderToString(latex, {
    output: "mathml",
    displayMode,
    throwOnError: false,
  });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const math = parsed.querySelector("math");
  if (math === null) throw new UnsupportedMathError("math");
  return math;
}

/** Element children only — MathML carries no meaningful text between elements. */
function elementChildren(node: Element): Element[] {
  return [...node.children];
}

/** The text a leaf carries, with the whitespace MathML pads operators with removed. */
function leafText(node: Element): string {
  return (node.textContent ?? "").replace(/[\u2061-\u2064]/g, "").trim();
}

function convertAll(nodes: readonly Element[]): MathComponent[] {
  return nodes.flatMap(convert);
}

/**
 * One MathML element as its OMML counterpart.
 *
 * Returns a list rather than a single component because a row flattens into its
 * contents and a wrapper contributes nothing of its own.
 */
function convert(node: Element): MathComponent[] {
  const name = node.tagName.toLowerCase().replace(/^m:/, "");

  switch (name) {
    // Wrappers with no meaning of their own. Converted as a row, because their
    // contents are siblings and an n-ary operator reaches past itself to the ones
    // that follow it.
    case "math":
    case "semantics":
    case "mrow":
    case "mstyle":
    case "mpadded":
      return convertRow(elementChildren(node));

    // The TeX source KaTeX attaches for round-tripping, and phantom space: neither
    // is content a reader sees.
    case "annotation":
    case "annotation-xml":
    case "mphantom":
      return [];

    case "mspace":
      return [new MathRun(" ")];

    case "mi":
    case "mn":
    case "mo":
    case "mtext": {
      const text = leafText(node);
      return text === "" ? [] : [new MathRun(text)];
    }

    case "mfrac": {
      const [numerator, denominator] = elementChildren(node);
      if (numerator === undefined || denominator === undefined) throw new UnsupportedMathError("mfrac");
      return [new MathFraction({ numerator: convert(numerator), denominator: convert(denominator) })];
    }

    case "msqrt":
      return [new MathRadical({ children: convertAll(elementChildren(node)) })];

    case "mroot": {
      const [radicand, degree] = elementChildren(node);
      if (radicand === undefined || degree === undefined) throw new UnsupportedMathError("mroot");
      return [new MathRadical({ children: convert(radicand), degree: convert(degree) })];
    }

    case "msub":
    case "munder": {
      const [base, sub] = elementChildren(node);
      if (base === undefined || sub === undefined) throw new UnsupportedMathError(name);
      return [new MathSubScript({ children: convert(base), subScript: convert(sub) })];
    }

    case "msup":
    case "mover": {
      const [base, sup] = elementChildren(node);
      if (base === undefined || sup === undefined) throw new UnsupportedMathError(name);
      return [new MathSuperScript({ children: convert(base), superScript: convert(sup) })];
    }

    case "msubsup":
    case "munderover": {
      const [base, sub, sup] = elementChildren(node);
      if (base === undefined || sub === undefined || sup === undefined) throw new UnsupportedMathError(name);
      return [
        new MathSubSuperScript({ children: convert(base), subScript: convert(sub), superScript: convert(sup) }),
      ];
    }

    default:
      throw new UnsupportedMathError(name);
  }
}

/** The scripted forms an n-ary operator's limits can arrive in. */
const SCRIPTED = new Set(["msub", "msup", "msubsup", "munder", "mover", "munderover"]);

/**
 * A sum or an integral, if this element is one, together with everything it sums.
 *
 * MathML writes `\sum_{i=1}^{n} x_i` as two siblings: a scripted `∑`, then the
 * operand beside it. Word's n-ary object is one thing containing both, and its
 * operand slot is not optional — left empty, Word hides it but every other reader
 * draws an empty-slot placeholder, so `Σ □ xᵢ` is what the document says. The
 * operand is therefore taken from what follows the sign, which is why this works
 * on a row rather than on a single element.
 *
 * Returns `undefined` when the element is not an n-ary operator, which is the
 * caller's signal to convert it as an ordinary script.
 */
function naryFrom(node: Element, following: readonly Element[]): MathComponent[] | undefined {
  if (!SCRIPTED.has(node.tagName.toLowerCase())) return undefined;
  const [base, first, second] = elementChildren(node);
  if (base === undefined) return undefined;

  const sign = leafText(base);
  const isSum = SUM_SIGNS.has(sign);
  const isIntegral = INTEGRAL_SIGNS.has(sign);
  if (!isSum && !isIntegral) return undefined;

  const name = node.tagName.toLowerCase();
  const under = name === "msub" || name === "munder" ? first : name === "msubsup" || name === "munderover" ? first : undefined;
  const over = name === "msup" || name === "mover" ? first : name === "msubsup" || name === "munderover" ? second : undefined;

  const options = {
    // Everything after the sign is what it operates on.
    children: convertAll(following),
    ...(under === undefined ? {} : { subScript: convert(under) }),
    ...(over === undefined ? {} : { superScript: convert(over) }),
  };
  return [isSum ? new MathSum(options) : new MathIntegral(options)];
}

/**
 * A bracketed group, recognised after conversion.
 *
 * KaTeX writes `\left( … \right)` as three siblings — an opening operator, the
 * contents, a closing one — and Word draws a stretching pair only when it is told
 * the group is bracketed. Recognising the pattern here keeps large parenthesised
 * fractions from being wrapped in parentheses the height of a single character.
 */
function groupBrackets(nodes: readonly Element[]): MathComponent[] {
  const opening = nodes[0];
  const closing = nodes[nodes.length - 1];
  if (
    nodes.length >= 2 &&
    opening !== undefined &&
    closing !== undefined &&
    opening.tagName.toLowerCase() === "mo" &&
    closing.tagName.toLowerCase() === "mo" &&
    OPENING_ROUND.has(leafText(opening)) &&
    CLOSING_ROUND.has(leafText(closing))
  ) {
    return [new MathRoundBrackets({ children: convertRow(nodes.slice(1, -1)) })];
  }
  return convertRow(nodes);
}

/**
 * A run of siblings, where a construct may reach past itself.
 *
 * Most elements convert on their own. An n-ary operator does not: it owns what
 * comes after it, so a row is the smallest unit that can be converted correctly.
 */
function convertRow(nodes: readonly Element[]): MathComponent[] {
  const out: MathComponent[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const nary = naryFrom(nodes[index], nodes.slice(index + 1));
    if (nary !== undefined) {
      // The operator consumed the rest of the row as its operand.
      out.push(...nary);
      return out;
    }
    out.push(...convert(nodes[index]));
  }
  return out;
}

/**
 * A piece of LaTeX as the components of a Word equation.
 *
 * Throws `UnsupportedMathError` when anything in it has no mapping — deliberately,
 * so the caller can fall back rather than emit an equation that is quietly wrong.
 */
export function latexToOmml(latex: string, displayMode: boolean): MathComponent[] {
  const math = mathmlFor(latex, displayMode);
  // KaTeX marks a formula it could not parse; its error markup would otherwise
  // convert into a perfectly well-formed equation reading "\frac{a}" or similar.
  if (math.querySelector(".katex-error") !== null) throw new UnsupportedMathError("katex-error");

  const semantics = math.querySelector("semantics");
  const top = semantics === null ? elementChildren(math) : elementChildren(semantics);
  // A single row is the usual shape; unwrap it so bracket detection sees the
  // operators as siblings rather than through a wrapper.
  const nodes = top.length === 1 && top[0].tagName.toLowerCase() === "mrow" ? elementChildren(top[0]) : top;
  const components = groupBrackets(nodes.filter((node) => node.tagName.toLowerCase() !== "annotation"));
  if (components.length === 0) throw new UnsupportedMathError("empty");
  return components;
}
