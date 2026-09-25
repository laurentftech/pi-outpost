/**
 * LaTeX as native Word equations: the transform lives in `@pi-outpost/shared`, where
 * the server's Word writer uses it too.
 *
 * `mathmlFor` stays here as the browser's own reading of KaTeX's MathML. The tests use
 * it as an independent witness — the MathML vocabulary check and the oracle comparison
 * — so they do not grade the shared reader with itself.
 */
import katex from "katex";
import { UnsupportedMathError } from "@pi-outpost/shared/docx";

export { latexToOmml, UnsupportedMathError } from "@pi-outpost/shared/docx";

export function mathmlFor(latex: string, displayMode: boolean): Element {
  const html = katex.renderToString(latex, { output: "mathml", displayMode, throwOnError: false });
  const math = new DOMParser().parseFromString(html, "text/html").querySelector("math");
  if (math === null) throw new UnsupportedMathError("math");
  return math;
}
