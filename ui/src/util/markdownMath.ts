/**
 * remark-math only recognizes $…$ / $$…$$, but models (Mistral in particular)
 * routinely emit LaTeX with \(…\) / \[…\] delimiters, which then render as raw
 * text. Rewrite those to dollar delimiters — outside code spans and fences only,
 * so LaTeX examples inside code blocks stay untouched.
 *
 * Written without regular expressions to avoid CodeQL polynomial-ReDoS flags
 * on library (model) input that may contain adversarial delimiter repetition.
 */
export function normalizeMathDelimiters(text: string): string {
  if (!text.includes("\\(") && !text.includes("\\[")) return text;

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
    }

    if (text.startsWith("\\(", i)) {
      const close = text.indexOf("\\)", i + 2);
      if (close !== -1) {
        out.push("$", text.slice(i + 2, close), "$");
        i = close + 2;
        continue;
      }
    }

    out.push(text[i]);
    i++;
  }

  return out.join("");
}
