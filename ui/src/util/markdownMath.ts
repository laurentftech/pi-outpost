/**
 * remark-math only recognizes $…$ / $$…$$, but models (Mistral in particular)
 * routinely emit LaTeX with \(…\) / \[…\] delimiters, which then render as raw
 * text. Rewrite those to dollar delimiters — outside code spans and fences only,
 * so LaTeX examples inside code blocks stay untouched.
 *
 * Models also *mix* the two styles within one formula — `$$e^{i\pi} + 1 = 0\]`
 * is a real observed answer. That is worse than an unconverted delimiter: the
 * opening `$$` never closes, so remark-math swallows the equation (it vanishes
 * from the page) and every later `$…$` in the message pairs up wrongly and
 * renders as literal text. One malformed formula breaks the whole answer, which
 * is why mismatched pairs are repaired here rather than left to the parser.
 *
 * Written without regular expressions to avoid CodeQL polynomial-ReDoS flags
 * on library (model) input that may contain adversarial delimiter repetition.
 */
/**
 * Position of `closer` after `from`, but only if it really closes what we opened:
 * a matching `opener` in between means that one owns it, and a blank line means we
 * left the formula behind — no math span crosses a paragraph break.
 */
function matchingCloser(text: string, from: number, closer: string, opener: string): number {
  const close = text.indexOf(closer, from);
  if (close === -1) return -1;
  const between = text.slice(from, close);
  if (between.includes(opener) || between.includes("\n\n")) return -1;
  return close;
}

export function normalizeMathDelimiters(text: string): string {
  if (!text.includes("\\(") && !text.includes("\\[") && !text.includes("\\)") && !text.includes("\\]")) {
    return text;
  }

  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text.startsWith("```", i)) {
      const close = text.indexOf("```", i + 3);
      if (close === -1) {
        out.push(text.slice(i));
        break;
      }
      out.push(text.slice(i, close + 3));
      i = close + 3;
      continue;
    }

    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1 && !text.slice(i + 1, close).includes("\n")) {
        out.push(text.slice(i, close + 1));
        i = close + 1;
        continue;
      }
    }

    if (text.startsWith("\\[", i)) {
      const close = text.indexOf("\\]", i + 2);
      if (close !== -1) {
        out.push("$$", text.slice(i + 2, close), "$$");
        i = close + 2;
        continue;
      }
      // Opened with a bracket, closed with dollars.
      const dollar = matchingCloser(text, i + 2, "$$", "\\[");
      if (dollar !== -1) {
        out.push("$$", text.slice(i + 2, dollar), "$$");
        i = dollar + 2;
        continue;
      }
    }

    if (text.startsWith("\\(", i)) {
      const close = text.indexOf("\\)", i + 2);
      if (close !== -1) {
        out.push("$", text.slice(i + 2, close), "$");
        i = close + 2;
        continue;
      }
      const dollar = matchingCloser(text, i + 2, "$", "\\(");
      if (dollar !== -1) {
        out.push("$", text.slice(i + 2, dollar), "$");
        i = dollar + 1;
        continue;
      }
    }

    // The mixed pairs: `$$…\]` and `$…\)`. Only rewritten when the bracket closer
    // arrives before any dollar closer would, so well-formed text is never touched
    // and a lone `$` (a price, a shell prompt) cannot swallow the line.
    if (text.startsWith("$$", i)) {
      const bracket = matchingCloser(text, i + 2, "\\]", "\\[");
      const dollar = text.indexOf("$$", i + 2);
      if (bracket !== -1 && (dollar === -1 || bracket < dollar)) {
        out.push("$$", text.slice(i + 2, bracket), "$$");
        i = bracket + 2;
        continue;
      }
    }

    if (text[i] === "$") {
      const paren = matchingCloser(text, i + 1, "\\)", "\\(");
      const dollar = text.indexOf("$", i + 1);
      if (paren !== -1 && (dollar === -1 || paren < dollar)) {
        out.push("$", text.slice(i + 1, paren), "$");
        i = paren + 2;
        continue;
      }
    }

    out.push(text[i]);
    i++;
  }

  return out.join("");
}
