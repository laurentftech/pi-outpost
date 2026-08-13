/**
 * A scanner for the XML that WordprocessingML actually contains — not a general
 * parser, and not trying to be one.
 *
 * It emits a flat stream of events (open, close, text) that a caller walks with
 * its own stack. That is enough for `word/document.xml`, and it means a document
 * can be abandoned mid-stream when a cap is reached instead of being built into
 * a tree first.
 *
 * SECURITY: the input is attacker-controlled. A DOCTYPE is refused outright, so
 * there is no internal subset in which entities could be declared — entity
 * expansion is not mitigated here, it is unreachable. Anything the scanner does
 * not recognise as structure is treated as text rather than guessed at.
 */

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlError";
  }
}

export type XmlEvent =
  /** `<w:p …>` — `selfClosing` for `<w:br/>`, which has no matching close. */
  | { kind: "open"; name: string; attributes: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

const PREDEFINED = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

/**
 * Decode the five predefined entities and numeric references. An entity this
 * document has no way to declare — because a DOCTYPE is refused — is left as
 * written rather than dropped: showing `&unknown;` is honest, silence is not.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code, whole) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code, whole) : whole;
    }
    return PREDEFINED.get(body) ?? whole;
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback; // out of range: keep the reference rather than throw
  }
}

/** Attributes of one tag. Values are quoted in XML, which is what bounds the scan. */
function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    attributes[match[1]] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/**
 * Walk the document, handing each event to `onEvent`.
 *
 * Returning `false` from `onEvent` stops the scan — how a caller enforces a cap
 * without reading the rest of a document it has already decided to truncate.
 */
export function scanXml(source: string, onEvent: (event: XmlEvent) => boolean | void): void {
  let at = 0;
  const length = source.length;

  while (at < length) {
    const open = source.indexOf("<", at);
    if (open === -1) {
      emitText(source.slice(at));
      return;
    }
    if (open > at) {
      if (emitText(source.slice(at, open)) === false) return;
    }

    // <!-- comment -->, <![CDATA[…]]>, <!DOCTYPE …>
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      if (end === -1) return; // an unterminated comment ends the document
      at = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      if (end === -1) throw new XmlError("unterminated CDATA section");
      // CDATA is text verbatim: no entity decoding inside it
      if (onEvent({ kind: "text", text: source.slice(open + 9, end) }) === false) return;
      at = end + 3;
      continue;
    }
    if (/^<!doctype/i.test(source.slice(open, open + 9))) {
      throw new XmlError("this document declares a DOCTYPE, which is refused");
    }
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      if (end === -1) throw new XmlError("unterminated processing instruction");
      at = end + 2;
      continue;
    }

    const close = findTagEnd(source, open);
    if (close === -1) throw new XmlError("unterminated tag");
    const raw = source.slice(open + 1, close);
    at = close + 1;

    if (raw.startsWith("/")) {
      if (onEvent({ kind: "close", name: raw.slice(1).trim() }) === false) return;
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameEnd = body.search(/[\s/]/);
    const name = (nameEnd === -1 ? body : body.slice(0, nameEnd)).trim();
    if (name === "") throw new XmlError("a tag has no name");
    const attributes = nameEnd === -1 ? {} : readAttributes(body.slice(nameEnd));
    if (onEvent({ kind: "open", name, attributes, selfClosing }) === false) return;
  }

  function emitText(text: string): boolean | void {
    if (text === "") return;
    return onEvent({ kind: "text", text: decodeEntities(text) });
  }
}

/**
 * The `>` that ends this tag — skipping the ones inside quoted attribute values.
 * `<w:t val="a > b">` is one tag, and a scanner that stops at the first `>`
 * splits it into nonsense.
 */
function findTagEnd(source: string, open: number): number {
  let quote: string | null = null;
  for (let at = open + 1; at < source.length; at++) {
    const char = source[at];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === ">") return at;
  }
  return -1;
}
