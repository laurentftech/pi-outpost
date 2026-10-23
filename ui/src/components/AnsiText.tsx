import { parseAnsi } from "../util/ansi";

/**
 * Extension text with its terminal styling honoured.
 *
 * Extension widgets and statuses are written for a terminal and arrive pre-styled — pi passes
 * the author's own escape sequences through unchanged. Printed verbatim they read
 * as `ESC[38;2;225;90;31m◆ESC[39m`; interpreted, they read as the author meant.
 */
export function AnsiText({ text }: { text: string }) {
  const segments = parseAnsi(text);
  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={index}
          style={{
            ...(segment.color ? { color: segment.color } : {}),
            ...(segment.bold ? { fontWeight: 600 } : {}),
            ...(segment.dim ? { opacity: 0.7 } : {}),
            ...(segment.italic ? { fontStyle: "italic" } : {}),
            ...(segment.underline ? { textDecoration: "underline" } : {}),
          }}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

