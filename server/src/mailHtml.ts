/**
 * Reducing an email's HTML body to markdown.
 *
 * What is wanted here is *reduction*, not fidelity: a mail body is Word- or
 * Outlook-generated tag soup wrapped in layout tables, and the reader wants the
 * sentences. So this walks a flat event stream with its own small stack, exactly
 * as `docx.ts` walks `scanXml`, rather than building a DOM.
 *
 * It does not use `scanXml`, and the reason is worth stating: that scanner is
 * deliberately strict — it throws on a DOCTYPE, on an unterminated tag, and on a
 * bare `<` that is not a tag. All three are ordinary in mail. `<!DOCTYPE html>`
 * opens most HTML mail, and `a < b` appears in prose. A parser that refuses those
 * would refuse the body, so the scanner below is the tolerant sibling: it never
 * throws, and anything it does not recognise as structure becomes text.
 *
 * SECURITY: the input is a stranger's HTML. Nothing here fetches, resolves or
 * executes anything — `script`, `style` and `head` are skipped whole, and a `src`
 * or `href` is reported as the text it is. There is no DOM, no network and no
 * evaluation, so a body cannot do anything but be read.
 *
 * Nothing is dropped silently: a tag this module has no rule for contributes its
 * text content. The worst outcome is plain-looking markdown, never missing prose.
 */
import { renderMarkdownTable } from "./markdownTable.ts";

/** A tag, or a run of text between tags. Attribute names are lower-cased. */
export type HtmlEvent =
  | { kind: "open"; name: string; attributes: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

/**
 * Named entities worth knowing, beyond the five XML predefines and numeric
 * references.
 *
 * The Latin-1 letters are here because they are how a French message written in a
 * non-Unicode client arrives: `&eacute;` and `&agrave;` are as common in real mail
 * as `&nbsp;`, and leaving them as written would put `&eacute;` in the middle of a
 * word. The punctuation entries are what a word processor emits for quotes and
 * dashes it curled itself.
 */
const NAMED_ENTITIES = new Map<string, string>(
  Object.entries({
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    nbsp: " ", shy: "­",
    iexcl: "¡", cent: "¢", pound: "£", curren: "¤", yen: "¥", brvbar: "¦", sect: "§",
    uml: "¨", copy: "©", ordf: "ª", laquo: "«", not: "¬", reg: "®", macr: "¯",
    deg: "°", plusmn: "±", sup2: "²", sup3: "³", acute: "´", micro: "µ", para: "¶",
    middot: "·", cedil: "¸", sup1: "¹", ordm: "º", raquo: "»", frac14: "¼",
    frac12: "½", frac34: "¾", iquest: "¿",
    Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å",
    AElig: "Æ", Ccedil: "Ç", Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
    Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï", ETH: "Ð", Ntilde: "Ñ",
    Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", times: "×",
    Oslash: "Ø", Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý",
    THORN: "Þ", szlig: "ß",
    agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å",
    aelig: "æ", ccedil: "ç", egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
    igrave: "ì", iacute: "í", icirc: "î", iuml: "ï", eth: "ð", ntilde: "ñ",
    ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", divide: "÷",
    oslash: "ø", ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý",
    thorn: "þ", yuml: "ÿ",
    OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š", Yuml: "Ÿ", fnof: "ƒ",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚",
    ldquo: "“", rdquo: "”", bdquo: "„", dagger: "†", Dagger: "‡",
    bull: "•", hellip: "…", permil: "‰", lsaquo: "‹", rsaquo: "›", euro: "€",
    trade: "™", larr: "←", uarr: "↑", rarr: "→", darr: "↓", harr: "↔",
    minus: "−", lowast: "∗", ne: "≠", le: "≤", ge: "≥", loz: "◊",
    hearts: "♥", diams: "♦", clubs: "♣", spades: "♠",
  }),
);

/**
 * Decode entity references in HTML text.
 *
 * `xml.ts` has a version of this, and it is not this one: it knows the five XML
 * predefines and refuses to guess at anything else, which is right for a format
 * that declares its entities. HTML declares nothing, so an unknown name is left as
 * written — `&foo;` stays `&foo;`, which is honest — and a known one is decoded
 * whether or not it carries its semicolon, because `&nbsp` unterminated is what
 * some clients emit.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole; // out of range: keep the reference rather than throw
      }
    }
    // Case matters: `&Eacute;` and `&eacute;` are different letters, so an unknown
    // spelling is left as written rather than folded onto one that exists.
    return NAMED_ENTITIES.get(body) ?? whole;
  });
}

/** Attribute values may be quoted or bare in HTML; both are read here. */
function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`<>=]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    if (name === "" || name === "/") continue;
    attributes[name] = decodeHtmlEntities(match[3] ?? match[4] ?? match[5] ?? "");
  }
  return attributes;
}

/** Void elements: they never carry a close tag, whatever the document writes. */
const VOID_ELEMENTS = new Set([
  "area", "base", "basefont", "br", "col", "embed", "frame", "hr", "img", "input",
  "isindex", "link", "meta", "param", "source", "track", "wbr",
]);

/** Elements whose content is not markup and must be read to their close tag. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "title", "textarea"]);

/** The `>` ending this tag, skipping the ones inside quoted attribute values. */
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

/**
 * Walk HTML, handing each event to `onEvent`. Returning `false` stops the scan.
 *
 * Never throws. A `<` that begins nothing recognisable is text, an unterminated
 * tag at the end of the document is text, and a DOCTYPE or comment is skipped.
 * That tolerance is the whole point: this runs on bodies no validator has seen.
 */
export function scanHtml(source: string, onEvent: (event: HtmlEvent) => boolean | void): void {
  let at = 0;

  while (at < source.length) {
    const open = source.indexOf("<", at);
    if (open === -1) {
      emitText(source.slice(at));
      return;
    }
    if (open > at && emitText(source.slice(at, open)) === false) return;

    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      // An unterminated comment swallows the rest, which is what a browser does.
      if (end === -1) return;
      at = end + 3;
      continue;
    }
    // <!DOCTYPE …>, <![if !mso]> and the other conditional junk Word emits.
    if (source.startsWith("<!", open) || source.startsWith("<?", open)) {
      const end = source.indexOf(">", open + 2);
      if (end === -1) return;
      at = end + 1;
      continue;
    }

    // Only a name or a closing slash starts a tag. `a < b` is prose.
    if (!/^<\/?[a-zA-Z]/.test(source.slice(open, open + 3))) {
      if (emitText("<") === false) return;
      at = open + 1;
      continue;
    }

    const close = findTagEnd(source, open);
    if (close === -1) {
      // An unterminated tag at the end of the body: text, not a failure.
      if (emitText(source.slice(open)) === false) return;
      return;
    }
    const raw = source.slice(open + 1, close);
    at = close + 1;

    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      if (name !== "" && onEvent({ kind: "close", name }) === false) return;
      continue;
    }

    const selfClosed = raw.endsWith("/");
    const body = selfClosed ? raw.slice(0, -1) : raw;
    const nameEnd = body.search(/[\s/]/);
    const name = (nameEnd === -1 ? body : body.slice(0, nameEnd)).trim().toLowerCase();
    if (name === "") continue;
    const attributes = nameEnd === -1 ? {} : readAttributes(body.slice(nameEnd));
    const isVoid = VOID_ELEMENTS.has(name);
    if (onEvent({ kind: "open", name, attributes, selfClosing: selfClosed || isVoid }) === false) return;

    // `script`/`style` content is not markup: consume to the close tag so a `<`
    // inside a script cannot be mistaken for structure.
    if (RAW_TEXT_ELEMENTS.has(name) && !selfClosed) {
      const closing = new RegExp(`</${name}\\s*>`, "i").exec(source.slice(at));
      const rawText = closing === null ? source.slice(at) : source.slice(at, at + closing.index);
      at = closing === null ? source.length : at + closing.index + closing[0].length;
      if (onEvent({ kind: "text", text: rawText }) === false) return;
      if (onEvent({ kind: "close", name }) === false) return;
    }
  }

  function emitText(text: string): boolean | void {
    if (text === "") return;
    return onEvent({ kind: "text", text: decodeHtmlEntities(text) });
  }
}

export interface ReduceHtmlOptions {
  /** Called periodically; throw from it to abandon a body that is taking too long. */
  deadline?: () => void;
}

/** Content skipped whole: it is not prose, and `style` in particular is enormous. */
const SKIPPED = new Set(["script", "style", "head", "noscript", "meta", "link", "title"]);

/** Tags that end the current line, and start a new block after it. */
const BLOCK = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside", "nav",
  "blockquote", "pre", "hr", "ul", "ol", "dl", "dt", "dd", "figure", "figcaption",
  "center", "form", "fieldset", "address", "h1", "h2", "h3", "h4", "h5", "h6",
]);

/** Inline markers, opened and closed around their content. */
const EMPHASIS: Record<string, string> = {
  b: "**", strong: "**", i: "*", em: "*", u: "", code: "`", del: "~~", s: "~~", strike: "~~",
};

/**
 * A cell being collected inside a table, or a whole table being collected.
 *
 * Tables are gathered rather than streamed because the decision of whether a table
 * is a table at all cannot be made until it has been seen: mail is laid out with
 * them, and a one-column `<table>` wrapping the whole message is a page frame, not
 * data. See `flushTable`.
 */
interface TableFrame {
  rows: string[][];
  row: string[] | null;
  cell: string[] | null;
  /** A table holding another table is layout, whatever its shape. */
  nested: boolean;
}

/**
 * Reduce an HTML body to markdown.
 *
 * The output keeps every piece of text the body carried. Structure is recognised
 * where it is recognisable and ignored otherwise, so an unusual construct costs
 * its formatting and not its content.
 */
export function reduceHtmlToMarkdown(html: string, options: ReduceHtmlOptions = {}): string {
  const out: string[] = [];
  /** Text of the line being built, before it is pushed as a block. */
  let line: string[] = [];
  /** Prefixes from the open blockquotes, so quoted history stays marked as quoted. */
  let quoteDepth = 0;
  /** Open list contexts: an ordered list counts, an unordered one does not. */
  const lists: { ordered: boolean; index: number }[] = [];
  /** Nested tables, innermost last. */
  const tables: TableFrame[] = [];
  /** `pre` keeps its whitespace; everything else collapses it. */
  let preformatted = 0;
  let skipDepth = 0;
  /** Set while inside an `<a>`, so its text can be wrapped in a markdown link. */
  let anchor: { href: string; text: string[] } | null = null;
  let events = 0;

  /**
   * The open anchor, cleared. Read through a call rather than directly because
   * TypeScript keeps the narrowing from `anchor`'s initialiser across the scan —
   * it does not see the writes the callback makes — and would type the variable
   * `never` at the end of this function.
   */
  const takeAnchor = (): { href: string; text: string[] } | null => {
    const held = anchor;
    anchor = null;
    return held;
  };

  const emit = (text: string): void => {
    if (text === "") return;
    if (anchor !== null) anchor.text.push(text);
    else if (tables.length > 0 && tables[tables.length - 1].cell !== null) tables[tables.length - 1].cell?.push(text);
    else line.push(text);
  };

  const endLine = (): void => {
    const text = line.join("").replace(/[ \t]+$/, "");
    line = [];
    if (text.trim() === "") return;
    out.push(quoteDepth > 0 ? text.replace(/^/gm, "> ".repeat(quoteDepth)) : text);
  };

  /**
   * A collected table: rendered as markdown only when it looks like data.
   *
   * Two rows and two columns is the threshold, and a table containing another
   * table never qualifies. Everything that does not qualify is *unwrapped* — its
   * cells become blocks — because the alternative is a page-wide layout frame
   * rendered as a one-cell table, and the text inside it is the message.
   */
  const flushTable = (): void => {
    const frame = tables.pop();
    if (frame === undefined) return;
    const rows = frame.rows.filter((row) => row.some((cell) => cell.trim() !== ""));
    const columns = rows.length === 0 ? 0 : Math.max(...rows.map((row) => row.length));
    const isData = !frame.nested && rows.length >= 2 && columns >= 2;
    if (isData) {
      const rendered = renderMarkdownTable(rows, { header: true });
      if (tables.length > 0 && tables[tables.length - 1].cell !== null) tables[tables.length - 1].cell?.push(rendered);
      else out.push(quoteDepth > 0 ? rendered.replace(/^/gm, "> ".repeat(quoteDepth)) : rendered);
      return;
    }
    for (const row of rows) {
      for (const cell of row) {
        const text = cell.trim();
        if (text === "") continue;
        if (tables.length > 0 && tables[tables.length - 1].cell !== null) tables[tables.length - 1].cell?.push(text);
        else out.push(quoteDepth > 0 ? text.replace(/^/gm, "> ".repeat(quoteDepth)) : text);
      }
    }
  };

  scanHtml(html, (event) => {
    if (++events % 2000 === 0) options.deadline?.();

    if (event.kind === "text") {
      if (skipDepth > 0) return;
      const text = preformatted > 0 ? event.text : event.text.replace(/[\s ]+/g, " ");
      emit(text);
      return;
    }

    if (event.kind === "open") {
      const { name, attributes } = event;
      if (SKIPPED.has(name)) {
        if (!event.selfClosing) skipDepth++;
        return;
      }
      if (skipDepth > 0) return;

      if (name === "br") {
        endLine();
        return;
      }
      if (name === "img") {
        // Reported, never resolved: `cid:` and `http:` alike stay text. Markdown
        // image syntax is avoided deliberately — see extractedPictures.ts for the
        // same choice and the same reason.
        const source = attributes.src ?? "";
        const alt = attributes.alt ?? "";
        const described = [alt, source].filter((part) => part !== "").join(" — ");
        emit(described === "" ? "[image]" : `[image: ${described}]`);
        return;
      }
      if (name === "a") {
        anchor = { href: attributes.href ?? "", text: [] };
        return;
      }
      if (name === "table") {
        endLine();
        if (tables.length > 0) tables[tables.length - 1].nested = true;
        tables.push({ rows: [], row: null, cell: null, nested: false });
        return;
      }
      if (name === "tr") {
        const frame = tables[tables.length - 1];
        if (frame !== undefined) frame.row = [];
        return;
      }
      if (name === "td" || name === "th") {
        const frame = tables[tables.length - 1];
        if (frame !== undefined) frame.cell = [];
        return;
      }
      if (name === "li") {
        endLine();
        const list = lists[lists.length - 1];
        if (list === undefined) line.push("- ");
        else if (list.ordered) line.push(`${++list.index}. `);
        else line.push("- ");
        return;
      }
      if (name === "ul" || name === "ol") {
        endLine();
        lists.push({ ordered: name === "ol", index: 0 });
        return;
      }
      if (name === "blockquote") {
        endLine();
        quoteDepth++;
        return;
      }
      if (name === "pre") {
        endLine();
        preformatted++;
        return;
      }
      if (name === "hr") {
        endLine();
        out.push("---");
        return;
      }
      if (/^h[1-6]$/.test(name)) {
        endLine();
        line.push(`${"#".repeat(Number(name[1]))} `);
        return;
      }
      const marker = EMPHASIS[name];
      if (marker !== undefined && marker !== "") emit(marker);
      else if (BLOCK.has(name)) endLine();
      return;
    }

    // close
    const { name } = event;
    if (SKIPPED.has(name)) {
      if (skipDepth > 0) skipDepth--;
      return;
    }
    if (skipDepth > 0) return;

    if (name === "a") {
      const held = takeAnchor();
      if (held === null) return;
      const text = held.text.join("").trim();
      // A link with no text of its own is its target; a link to nowhere is its text.
      if (held.href === "") emit(text);
      else if (text === "") emit(held.href);
      else if (text === held.href) emit(text);
      else emit(`[${text}](${held.href})`);
      return;
    }
    if (name === "table") {
      endLine();
      flushTable();
      return;
    }
    if (name === "tr") {
      const frame = tables[tables.length - 1];
      if (frame?.row != null) {
        frame.rows.push(frame.row);
        frame.row = null;
      }
      return;
    }
    if (name === "td" || name === "th") {
      const frame = tables[tables.length - 1];
      if (frame?.cell != null) {
        const text = frame.cell.join("").replace(/\s+/g, " ").trim();
        frame.cell = null;
        if (frame.row === null) frame.row = [];
        frame.row.push(text);
      }
      return;
    }
    if (name === "ul" || name === "ol") {
      endLine();
      lists.pop();
      return;
    }
    if (name === "blockquote") {
      endLine();
      if (quoteDepth > 0) quoteDepth--;
      return;
    }
    if (name === "pre") {
      endLine();
      if (preformatted > 0) preformatted--;
      return;
    }
    if (name === "li" || /^h[1-6]$/.test(name) || BLOCK.has(name)) {
      endLine();
      return;
    }
    const marker = EMPHASIS[name];
    if (marker !== undefined && marker !== "") emit(marker);
  });

  // A body that never closed its last element still has a line in hand — and an
  // `<a>` left open at the end still holds the text it collected.
  const unclosed = takeAnchor();
  if (unclosed !== null) {
    const text = unclosed.text.join("").trim();
    if (text !== "") line.push(unclosed.href === "" ? text : `[${text}](${unclosed.href})`);
  }
  while (tables.length > 0) flushTable();
  endLine();

  return out
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
