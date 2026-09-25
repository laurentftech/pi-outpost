/**
 * KaTeX's MathML, as a tree the equation transform can walk anywhere.
 *
 * The transform used to read it through the browser's `DOMParser`, which the server
 * does not have. What KaTeX emits is a small, closed, well-formed vocabulary — nested
 * elements, a handful of attributes, text with the five predefined entities and
 * numeric references — so this reads exactly that and nothing more. It is not a
 * general XML parser, and does not need to be: an input it does not understand
 * raises, and the caller shows the formula's source instead.
 */

/** An element: its name, its attributes, its element children and all of its text. */
export type MathNode = {
  readonly tagName: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly MathNode[];
  /** Every text node beneath it, concatenated, as the DOM's `textContent`. */
  readonly textContent: string;
};

/** Raised on markup this reader does not accept. */
export class MathMarkupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MathMarkupError";
  }
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return NAMED[name] ?? whole;
  });
}

type Building = { tagName: string; attributes: Map<string, string>; children: Building[]; text: string[] };

function freeze(node: Building): MathNode {
  const children = node.children.map(freeze);
  return {
    tagName: node.tagName,
    attributes: node.attributes,
    children,
    get textContent() {
      return node.text.join("");
    },
  };
}

const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * The markup as a list of top-level elements.
 *
 * Text is attributed to every open element, so an element's `textContent` holds the
 * text of all its descendants in document order, as the DOM's does.
 */
export function parseMathMarkup(markup: string): MathNode[] {
  const root: Building = { tagName: "#root", attributes: new Map(), children: [], text: [] };
  const stack: Building[] = [root];
  let index = 0;
  while (index < markup.length) {
    const lt = markup.indexOf("<", index);
    const textEnd = lt === -1 ? markup.length : lt;
    if (textEnd > index) {
      const text = decode(markup.slice(index, textEnd));
      for (const open of stack) open.text.push(text);
    }
    if (lt === -1) break;
    TAG.lastIndex = lt;
    const match = TAG.exec(markup);
    if (match === null) throw new MathMarkupError(`unreadable markup at ${lt}`);
    const [, closing, name, attributeText, selfClosing] = match;
    index = TAG.lastIndex;
    if (closing === "/") {
      const open = stack.pop();
      if (open === undefined || open === root || open.tagName !== name) throw new MathMarkupError(`unexpected </${name}>`);
      continue;
    }
    const attributes = new Map<string, string>();
    for (const attribute of attributeText.matchAll(ATTRIBUTE)) attributes.set(attribute[1], decode(attribute[2] ?? attribute[3] ?? ""));
    const element: Building = { tagName: name, attributes, children: [], text: [] };
    stack[stack.length - 1].children.push(element);
    if (selfClosing !== "/") stack.push(element);
  }
  if (stack.length !== 1) throw new MathMarkupError(`unclosed <${stack[stack.length - 1].tagName}>`);
  return root.children.map(freeze);
}

/** The first element, depth first, that `test` accepts. */
export function findMathNode(nodes: readonly MathNode[], test: (node: MathNode) => boolean): MathNode | undefined {
  for (const node of nodes) {
    if (test(node)) return node;
    const inner = findMathNode(node.children, test);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/** Whether the element's `class` attribute names `name`. */
export function hasClass(node: MathNode, name: string): boolean {
  return (node.attributes.get("class") ?? "").split(/\s+/).includes(name);
}
