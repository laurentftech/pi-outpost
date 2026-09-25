/**
 * Writing Markdown into an existing Word package — a template for `docx_create`, the
 * document itself for `docx_update`.
 *
 * The content is written by the same mapping the viewer's export uses (`@pi-outpost/
 * shared/docx`), into a throwaway package of the writer library's; its body is then
 * carried into the target package, and only what that body needs comes with it:
 *
 * - **styles**, matched by name: a paragraph the writer styled `Heading1` gets the
 *   target's style named `heading 1`, whatever its id (`Titre1` in a French template).
 *   A style the target lacks is added, never swapped for another.
 * - **numbering**: the writer's list definitions are appended with ids past the
 *   target's, so both sets coexist and neither is renumbered.
 * - **pictures and links**: re-issued as relationships with ids the target does not
 *   use, media under names it does not use.
 * - **namespaces** the carried markup uses and the target root does not declare.
 *
 * Everything else in the target is left as the bytes it was, unless a change needs it.
 *
 * SECURITY: the target is a workspace file. Everything read from it goes through the
 * capped zip reader and the DOCTYPE-refusing XML readers; relationship targets stay
 * names inside the package.
 */
import { Packer } from "docx";
import { docxDocument, markdownToDocx, type PictureSource } from "@pi-outpost/shared/docx";
import { contentTypeOf, decode, parseRelationshipList, relsPartOf, scanRawRelationships, type Relationship } from "./ooxml.ts";
import { readAllZipEntries } from "./zip.ts";
import { writeZip } from "./zipWriter.ts";
import { bodyLayout, childElements, parseStyles, rootAttributes, styleKey, type WordStyle, type XmlElement } from "./wordml.ts";
import {
  CONTENT_TYPES,
  CT_DOCUMENT,
  CT_NUMBERING,
  NS_R,
  REL_NUMBERING,
  ROOT_RELS,
  type WordPackage,
} from "./docxTemplate.ts";

const NS_REL_PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/** Relationship types that only body content refers to; unreferenced ones go with it. */
const BODY_REFERENCE_TYPES = new Set(
  ["image", "hyperlink", "oleObject", "package", "chart", "diagramData", "diagramLayout", "diagramQuickStyle", "diagramColors", "video", "audio", "media"].map(
    (name) => `${NS_R}/${name}`,
  ),
);

/** What the mapping wrote, opened. */
export interface GeneratedContent {
  parts: Map<string, Buffer>;
  documentXml: string;
  rels: Relationship[];
  styles: Map<string, WordStyle>;
  body: XmlElement[];
}

/** Markdown as body elements of a throwaway package, for `WordComposer.adopt`. */
export async function generateContent(markdown: string, source: PictureSource): Promise<GeneratedContent> {
  const blocks = await markdownToDocx(markdown, source);
  const bytes = await Packer.toBuffer(docxDocument(blocks));
  const parts = readAllZipEntries(bytes, { maxEntries: 4096, maxInflatedBytes: 256 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 });
  const documentXml = decode(parts, "word/document.xml")!;
  const layout = bodyLayout(documentXml);
  return {
    parts,
    documentXml,
    rels: parseRelationshipList(decode(parts, "word/_rels/document.xml.rels"), "word/document.xml"),
    styles: parseStyles(decode(parts, "word/styles.xml")),
    body: layout.children.filter((child) => child.local !== "sectPr"),
  };
}

/**
 * A Word document someone else wrote — the viewer's export, drawn in the browser with
 * its diagrams and pictures — opened as content to carry into a template.
 */
export function contentFromDocx(bytes: Uint8Array): GeneratedContent {
  const parts = readAllZipEntries(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    maxEntries: 4096,
    maxInflatedBytes: 256 * 1024 * 1024,
    maxTotalBytes: 512 * 1024 * 1024,
  });
  const main = parseRelationshipList(decode(parts, ROOT_RELS), "").find((rel) => rel.type.endsWith("/officeDocument") && !rel.external)?.target;
  const documentXml = main === undefined ? undefined : decode(parts, main);
  if (main === undefined || documentXml === undefined) throw new Error("the export is not a Word document");
  const layout = bodyLayout(documentXml);
  const rels = parseRelationshipList(decode(parts, relsPartOf(main)), main);
  const target = (type: string) => rels.find((rel) => rel.type === type && !rel.external)?.target;
  const stylesPart = target(`${NS_R}/styles`);
  const numberingPart = target(REL_NUMBERING);
  // `adopt` reads the writer's own part names; an export is one of the writer's packages.
  if (stylesPart !== undefined && stylesPart !== "word/styles.xml") parts.set("word/styles.xml", parts.get(stylesPart)!);
  if (numberingPart !== undefined && numberingPart !== "word/numbering.xml") parts.set("word/numbering.xml", parts.get(numberingPart)!);
  return {
    parts,
    documentXml,
    rels,
    styles: parseStyles(stylesPart === undefined ? undefined : decode(parts, stylesPart)),
    body: layout.children.filter((child) => child.local !== "sectPr"),
  };
}

/** The namespace declarations on a part's root element, by prefix. */
function namespacesOf(xml: string): Map<string, string> {
  const start = xml.indexOf("<", xml.startsWith("<?") ? xml.indexOf("?>") + 2 : 0);
  const attributes = rootAttributes(xml.slice(start));
  const map = new Map<string, string>();
  for (const [name, value] of Object.entries(attributes)) if (name.startsWith("xmlns:")) map.set(name.slice(6), value);
  return map;
}

/** Prefixes an XML fragment uses on elements and attributes. */
function prefixesUsed(xml: string): Set<string> {
  const used = new Set<string>();
  for (const match of xml.matchAll(/<\/?([A-Za-z_][\w.-]*):/g)) used.add(match[1]);
  for (const match of xml.matchAll(/\s([A-Za-z_][\w.-]*):[\w.-]+\s*=/g)) if (match[1] !== "xmlns") used.add(match[1]);
  used.delete("xml");
  return used;
}

/**
 * Declare on a part's root the prefixes `needed` maps to URIs, and list as ignorable
 * the ones the source listed so. Refuses a prefix already bound to another URI —
 * rewriting prefixes inside carried markup is not something to do silently.
 */
function declareNamespaces(xml: string, needed: Map<string, string>, ignorable: Set<string>): string {
  const declared = namespacesOf(xml);
  const additions: string[] = [];
  const addIgnorable: string[] = [];
  for (const [prefix, uri] of needed) {
    const existing = declared.get(prefix);
    if (existing === uri) continue;
    if (existing !== undefined) throw new Error(`the document binds the prefix ${prefix}: to another namespace (${existing})`);
    additions.push(` xmlns:${prefix}="${uri}"`);
    if (ignorable.has(prefix)) addIgnorable.push(prefix);
  }
  if (additions.length === 0) return xml;
  const rootStart = xml.indexOf("<", xml.startsWith("<?") ? xml.indexOf("?>") + 2 : 0);
  const rootEnd = xml.indexOf(">", rootStart);
  let root = xml.slice(rootStart, rootEnd);
  const selfClosing = root.endsWith("/");
  if (selfClosing) root = root.slice(0, -1);
  root += additions.join("");
  if (addIgnorable.length > 0) {
    const current = /\smc:Ignorable="([^"]*)"/.exec(root);
    if (current !== null) {
      const list = new Set(current[1].split(/\s+/).filter(Boolean));
      for (const prefix of addIgnorable) list.add(prefix);
      root = root.replace(current[0], ` mc:Ignorable="${[...list].join(" ")}"`);
    } else if (declared.has("mc") || needed.get("mc") === NS_MC) {
      root += ` mc:Ignorable="${addIgnorable.join(" ")}"`;
    }
    // Without an mc: binding the extension attributes are still declared, which is
    // what well-formedness needs; readers that do not know them skip them.
  }
  return xml.slice(0, rootStart) + root + (selfClosing ? "/" : "") + xml.slice(rootEnd);
}

function ignorableOf(xml: string): Set<string> {
  const match = /\smc:Ignorable="([^"]*)"/.exec(xml.slice(0, 4096));
  return new Set((match?.[1] ?? "").split(/\s+/).filter(Boolean));
}

/** The highest `N` among values like `rIdN`, `N`. */
function highestNumber(values: Iterable<string>): number {
  let highest = 0;
  for (const value of values) {
    const match = /(\d+)$/.exec(value);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

/** Relationships reachable from the package root. */
function reachableParts(parts: Map<string, Buffer>): Set<string> {
  const reached = new Set<string>();
  const queue = [""];
  while (queue.length > 0) {
    const source = queue.shift()!;
    if (source !== "") reached.add(source);
    const relsPart = source === "" ? ROOT_RELS : relsPartOf(source);
    for (const rel of parseRelationshipList(decode(parts, relsPart), source)) {
      if (rel.external || reached.has(rel.target) || queue.includes(rel.target) || !parts.has(rel.target)) continue;
      queue.push(rel.target);
    }
  }
  return reached;
}

export interface ComposeOptions {
  /** Retype the main part as a document (a template becomes a `.docx`). */
  asDocument?: boolean;
  /** Ask Word to refresh fields — a kept table of contents — when the file is opened. */
  updateFields?: boolean;
  /**
   * Which unreachable parts to drop: `all` — whatever nothing reaches once the new body
   * is in (a template's sample pictures); `changed` — only what the new body stopped
   * reaching, leaving anything the original already carried unreached alone.
   */
  sweep: "all" | "changed";
}

/**
 * The target package, and what is being carried into it.
 *
 * `adopt` turns generated content into body markup valid in the target; `compose`
 * writes the package around a final `document.xml`.
 */
export class WordComposer {
  readonly target: WordPackage;
  private readonly styles: Map<string, WordStyle>;
  private readonly addedStyles: string[] = [];
  private readonly styleMap = new Map<string, string>();
  private readonly addedAbstractNums: string[] = [];
  private readonly addedNums: string[] = [];
  private nextAbstractNum: number;
  private nextNum: number;
  private generatedNumbering: string | undefined;
  private readonly addedRels: string[] = [];
  private readonly addedMedia = new Map<string, Buffer>();
  private nextRel: number;
  private nextMedia = 1;
  private nextDocPr: number;
  private readonly mediaPrefix: string;
  private readonly namespaces = new Map<string, string>();
  private readonly ignorable = new Set<string>();
  private readonly styleNamespaces = new Map<string, string>();
  private readonly numberingNamespaces = new Map<string, string>();

  constructor(target: WordPackage) {
    this.target = target;
    this.styles = new Map(target.styles);
    const numbering = target.numberingPart === undefined ? "" : (decode(target.parts, target.numberingPart) ?? "");
    this.nextAbstractNum = highestNumber([...numbering.matchAll(/abstractNumId="(\d+)"/g)].map((match) => match[1])) + 1;
    this.nextNum = highestNumber([...numbering.matchAll(/<(?:\w+:)?num\b[^>]*numId="(\d+)"/g)].map((match) => match[1])) + 1;
    this.nextRel = highestNumber(target.documentRels.map((rel) => rel.id)) + 1;
    this.nextDocPr = highestNumber([...target.documentXml.matchAll(/<(?:\w+:)?docPr\b[^>]*?\bid="(\d+)"/g)].map((match) => match[1])) + 1;
    let prefix = "pi-";
    while ([...target.parts.keys()].some((part) => part.startsWith(`word/media/${prefix}`))) prefix = `x${prefix}`;
    this.mediaPrefix = prefix;
  }

  /** The target's id for the generated style `id`, adding the style when the target has none of that name. */
  private styleFor(id: string, generated: Map<string, WordStyle>, seen = new Set<string>()): string {
    const mapped = this.styleMap.get(id);
    if (mapped !== undefined) return mapped;
    const source = generated.get(id);
    if (source === undefined || seen.has(id)) return id;
    seen.add(id);
    const key = styleKey(source.name);
    const match = [...this.styles.values()].find((style) => style.type === source.type && styleKey(style.name) === key);
    if (match !== undefined) {
      this.styleMap.set(id, match.id);
      return match.id;
    }
    let newId = id;
    for (let n = 2; this.styles.has(newId); n++) newId = `${id}${n}`;
    this.styleMap.set(id, newId);
    let xml = source.xml.replace(/(\bw:styleId=")[^"]*(")/, `$1${newId}$2`);
    xml = xml.replace(/(<w:(?:basedOn|next|link)\b[^>]*?\bw:val=")([^"]*)(")/g, (_, open: string, value: string, close: string) => `${open}${this.styleFor(value, generated, seen)}${close}`);
    this.styles.set(newId, { ...source, id: newId, xml });
    this.addedStyles.push(xml);
    return newId;
  }

  /** Body elements of `generated`, rewritten to live in the target. */
  adopt(generated: GeneratedContent): string[] {
    const genNamespaces = namespacesOf(generated.documentXml);
    for (const prefix of ignorableOf(generated.documentXml)) this.ignorable.add(prefix);
    let body = generated.body.map((element) => element.xml).join("\u0000");

    // Styles, by name.
    body = body.replace(/(<w:(?:pStyle|rStyle|tblStyle)\b[^>]*?\bw:val=")([^"]*)(")/g, (_, open: string, value: string, close: string) => `${open}${this.styleFor(value, generated.styles)}${close}`);
    if (this.addedStyles.length > 0) {
      const genStylesXml = decode(generated.parts, "word/styles.xml") ?? "";
      for (const [prefix, uri] of namespacesOf(genStylesXml)) this.styleNamespaces.set(prefix, uri);
    }

    // Numbering: carry the definitions the body uses, renumbered past the target's.
    const numbering = decode(generated.parts, "word/numbering.xml");
    if (numbering !== undefined) {
      this.generatedNumbering ??= numbering;
      const root = /<(\w+:)?numbering\b[^>]*>/.exec(numbering)!;
      const elements = childElements(numbering, root.index + root[0].length, numbering.lastIndexOf("</"));
      const abstracts = new Map(elements.filter((e) => e.local === "abstractNum").map((e) => [/abstractNumId="(\d+)"/.exec(e.xml)![1], e.xml]));
      const nums = new Map(elements.filter((e) => e.local === "num").map((e) => [/numId="(\d+)"/.exec(e.xml)![1], e.xml]));
      const numMap = new Map<string, string>();
      const abstractMap = new Map<string, string>();
      body = body.replace(/(<w:numId\b[^>]*?\bw:val=")(\d+)(")/g, (whole, open: string, value: string, close: string) => {
        const num = nums.get(value);
        if (num === undefined) return whole;
        let newNum = numMap.get(value);
        if (newNum === undefined) {
          const abstractId = /<(?:\w+:)?abstractNumId\b[^>]*?val="(\d+)"/.exec(num)?.[1];
          let newAbstract = abstractId === undefined ? undefined : abstractMap.get(abstractId);
          if (abstractId !== undefined && newAbstract === undefined && abstracts.has(abstractId)) {
            newAbstract = String(this.nextAbstractNum++);
            abstractMap.set(abstractId, newAbstract);
            this.addedAbstractNums.push(
              abstracts
                .get(abstractId)!
                .replace(/(abstractNumId=")\d+(")/, `$1${newAbstract}$2`)
                // A list's identity in Word; two lists sharing one are merged when pasted.
                .replace(/<(?:\w+:)?nsid\b[^>]*\/>/g, "")
                // A Word 2013 hint the writer adds; its namespace is not the target's to need.
                .replace(/\sw15:restartNumberingAfterBreak="[^"]*"/g, ""),
            );
          }
          newNum = String(this.nextNum++);
          numMap.set(value, newNum);
          this.addedNums.push(
            num.replace(/(\bnumId=")\d+(")/, `$1${newNum}$2`).replace(/(<(?:\w+:)?abstractNumId\b[^>]*?val=")(\d+)(")/, (_, a: string, id: string, c: string) => `${a}${abstractMap.get(id) ?? id}${c}`),
          );
        }
        return `${open}${newNum}${close}`;
      });
      for (const [prefix, uri] of namespacesOf(numbering)) this.numberingNamespaces.set(prefix, uri);
    }

    // Pictures and links: new relationship ids, media under names of our own.
    const relIds = new Map<string, string>();
    body = body.replace(/(\sr:(?:embed|id|link|pict)=")([^"]*)(")/g, (whole, open: string, value: string, close: string) => {
      const rel = generated.rels.find((candidate) => candidate.id === value);
      if (rel === undefined) return whole;
      let newId = relIds.get(value);
      if (newId === undefined) {
        while (this.target.documentRels.some((existing) => existing.id === `rId${this.nextRel}`)) this.nextRel++;
        newId = `rId${this.nextRel++}`;
        relIds.set(value, newId);
        if (rel.external) {
          this.addedRels.push(`<Relationship Id="${newId}" Type="${rel.type}" Target="${escapeAttribute(rel.target)}" TargetMode="External"/>`);
        } else {
          const bytes = generated.parts.get(rel.target);
          const extension = rel.target.split(".").pop()!.toLowerCase();
          const name = `media/${this.mediaPrefix}${this.nextMedia++}.${extension}`;
          if (bytes !== undefined) this.addedMedia.set(`word/${name}`, bytes);
          this.addedRels.push(`<Relationship Id="${newId}" Type="${rel.type}" Target="${name}"/>`);
        }
      }
      return `${open}${newId}${close}`;
    });

    // Drawing ids must be unique in the document.
    body = body.replace(/(<wp:docPr\b[^>]*?\bid=")(\d+)(")/g, (_, open: string, __: string, close: string) => `${open}${this.nextDocPr++}${close}`);

    for (const prefix of prefixesUsed(body)) {
      const uri = genNamespaces.get(prefix);
      if (uri !== undefined) this.namespaces.set(prefix, uri);
    }
    return body.split("\u0000");
  }

  /** The document's root with the namespaces carried content needs. */
  prepareDocument(documentXml: string): string {
    return declareNamespaces(documentXml, this.namespaces, this.ignorable);
  }

  /** The whole package around a final `document.xml`. */
  compose(documentXml: string, options: ComposeOptions): Buffer {
    const target = this.target;
    const out = new Map(target.parts);
    out.set(target.mainPart, Buffer.from(this.prepareDocument(documentXml), "utf8"));

    // Styles.
    if (this.addedStyles.length > 0 && target.stylesPart !== undefined) {
      let styles = decode(target.parts, target.stylesPart)!;
      const close = styles.lastIndexOf("</");
      styles = styles.slice(0, close) + this.addedStyles.join("") + styles.slice(close);
      const needed = new Map([...prefixesUsed(this.addedStyles.join(""))].flatMap((prefix) => (this.styleNamespaces.has(prefix) ? [[prefix, this.styleNamespaces.get(prefix)!] as const] : [])));
      out.set(target.stylesPart, Buffer.from(declareNamespaces(styles, needed, this.ignorable), "utf8"));
    }

    // Numbering.
    const relsPart = relsPartOf(target.mainPart);
    const extraRels = [...this.addedRels];
    const extraOverrides: Array<[string, string]> = [];
    if (this.addedNums.length > 0) {
      const fragment = this.addedAbstractNums.join("") + this.addedNums.join("");
      const needed = new Map([...prefixesUsed(fragment)].flatMap((prefix) => (this.numberingNamespaces.has(prefix) ? [[prefix, this.numberingNamespaces.get(prefix)!] as const] : [])));
      if (target.numberingPart !== undefined) {
        let numbering = decode(target.parts, target.numberingPart)!;
        const firstNum = /<(?:\w+:)?num\b[^>]*\bnumId=/.exec(numbering);
        const close = numbering.lastIndexOf("</");
        const cleanup = /<(?:\w+:)?numIdMacAtCleanup\b/.exec(numbering);
        const numsAt = cleanup !== null ? cleanup.index : close;
        numbering = numbering.slice(0, numsAt) + this.addedNums.join("") + numbering.slice(numsAt);
        const abstractsAt = firstNum !== null ? firstNum.index : numsAt;
        numbering = numbering.slice(0, abstractsAt) + this.addedAbstractNums.join("") + numbering.slice(abstractsAt);
        out.set(target.numberingPart, Buffer.from(declareNamespaces(numbering, needed, this.ignorable), "utf8"));
      } else {
        const root = /<(\w+:)?numbering\b[^>]*>/.exec(this.generatedNumbering!)!;
        const numbering = this.generatedNumbering!.slice(0, root.index + root[0].length) + fragment + `</${root[1] ?? ""}numbering>`;
        const part = target.parts.has("word/numbering.xml") ? "word/pi-numbering.xml" : "word/numbering.xml";
        out.set(part, Buffer.from(numbering, "utf8"));
        let id = this.nextRel++;
        while (target.documentRels.some((rel) => rel.id === `rId${id}`)) id = this.nextRel++;
        extraRels.push(`<Relationship Id="rId${id}" Type="${REL_NUMBERING}" Target="${part.slice("word/".length)}"/>`);
        extraOverrides.push([part, CT_NUMBERING]);
      }
    }
    if (target.stylesPart === undefined && this.addedStyles.length > 0) {
      throw new Error("the document has no style sheet to add styles to");
    }

    // Settings: refresh fields on open.
    if (options.updateFields && target.settingsPart !== undefined) {
      const settings = decode(target.parts, target.settingsPart)!;
      if (!/<(?:\w+:)?updateFields\b/.test(settings)) out.set(target.settingsPart, Buffer.from(withUpdateFields(settings), "utf8"));
    }

    // Relationships: keep the target's, minus body references nothing points at any more.
    const finalDocument = out.get(target.mainPart)!.toString("utf8");
    const referenced = new Set([...finalDocument.matchAll(/\s[\w.-]+:[\w.-]+="(rId[^"]*|[^"]+)"/g)].map((match) => match[1]));
    const originalRels = decode(target.parts, relsPart) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_REL_PACKAGE}"></Relationships>`;
    const kept: string[] = [];
    let dropped = false;
    scanRawRelationships(originalRels, (raw, type) => {
      const id = /\bId="([^"]*)"/.exec(raw)?.[1] ?? "";
      if (BODY_REFERENCE_TYPES.has(type) && !referenced.has(id)) {
        dropped = true;
        return;
      }
      kept.push(raw);
    });
    const liveRels = extraRels.filter((raw) => {
      const id = /\bId="([^"]*)"/.exec(raw)![1];
      return !/\/(image|hyperlink)"/.test(raw) || referenced.has(id);
    });
    if (dropped || liveRels.length > 0) {
      const head = originalRels.slice(0, originalRels.indexOf("<Relationships"));
      const open = /<Relationships\b[^>]*>/.exec(originalRels)?.[0] ?? `<Relationships xmlns="${NS_REL_PACKAGE}">`;
      out.set(relsPart, Buffer.from(`${head || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'}${open}${kept.join("")}${liveRels.join("")}</Relationships>`, "utf8"));
    }
    const liveMedia = new Set(liveRels.flatMap((raw) => (raw.includes('TargetMode="External"') ? [] : [`word/${/\bTarget="([^"]*)"/.exec(raw)![1]}`])));
    for (const [part, bytes] of this.addedMedia) if (liveMedia.has(part)) out.set(part, bytes);

    // Sweep.
    const before = options.sweep === "changed" ? reachableParts(target.parts) : undefined;
    const after = reachableParts(out);
    const removed = new Set<string>();
    for (const part of [...out.keys()]) {
      if (part === CONTENT_TYPES || part.endsWith(".rels") || after.has(part)) continue;
      if (before !== undefined && !before.has(part)) continue;
      out.delete(part);
      removed.add(part);
    }
    for (const part of [...out.keys()]) {
      if (!part.endsWith(".rels") || part === ROOT_RELS) continue;
      const owner = part.replace(/_rels\/([^/]+)\.rels$/, "$1");
      if (removed.has(owner)) out.delete(part);
    }

    // Content types.
    const contentTypes = decode(target.parts, CONTENT_TYPES)!;
    const newExtensions = new Set([...out.keys()].filter((part) => !target.parts.has(part) && part.startsWith("word/media/")).map((part) => part.split(".").pop()!.toLowerCase()));
    const retype = options.asDocument === true && contentTypeOf(contentTypes, target.mainPart) !== CT_DOCUMENT;
    if (removed.size > 0 || newExtensions.size > 0 || extraOverrides.length > 0 || retype) {
      out.set(CONTENT_TYPES, Buffer.from(rewriteContentTypes(contentTypes, target.mainPart, removed, newExtensions, extraOverrides, retype), "utf8"));
    }

    const order = [CONTENT_TYPES, ...[...target.parts.keys()].filter((name) => name !== CONTENT_TYPES), ...[...out.keys()].filter((name) => !target.parts.has(name))];
    const entries = [...new Set(order)].filter((name) => out.has(name)).map((name) => ({ name, data: out.get(name)! }));
    return writeZip(entries);
  }
}

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function rewriteContentTypes(
  xml: string,
  mainPart: string,
  removed: Set<string>,
  extensions: Set<string>,
  overrides: Array<[string, string]>,
  retype: boolean,
): string {
  let result = xml.replace(/<(?:\w+:)?Override\b[^>]*?\/>/g, (element) => {
    const part = /\bPartName="([^"]*)"/.exec(element)?.[1]?.replace(/^\//, "");
    if (part !== undefined && removed.has(part)) return "";
    if (retype && part === mainPart) return element.replace(/ContentType="[^"]*"/, `ContentType="${CT_DOCUMENT}"`);
    return element;
  });
  if (retype && !/PartName="\/?word\/document\.xml"/.test(result) && mainPart === "word/document.xml") {
    overrides = [...overrides, [mainPart, CT_DOCUMENT]];
  }
  const declared = new Set([...result.matchAll(/<(?:\w+:)?Default\b[^>]*\bExtension="([^"]*)"/g)].map((match) => match[1].toLowerCase()));
  const defaults = [...extensions].filter((extension) => !declared.has(extension) && MEDIA_TYPES[extension] !== undefined).map((extension) => `<Default Extension="${extension}" ContentType="${MEDIA_TYPES[extension]}"/>`);
  const close = result.lastIndexOf("</");
  result = result.slice(0, close) + defaults.join("") + overrides.map(([part, type]) => `<Override PartName="/${part}" ContentType="${type}"/>`).join("") + result.slice(close);
  return result;
}

/**
 * Settings children that come after `updateFields` in the schema's sequence
 * (ECMA-376 Part 1, CT_Settings): the flag goes before the first of them present.
 */
const AFTER_UPDATE_FIELDS = [
  "hdrShapeDefaults",
  "footnotePr",
  "endnotePr",
  "compat",
  "docVars",
  "rsids",
  "mathPr",
  "attachedSchema",
  "themeFontLang",
  "clrSchemeMapping",
  "doNotIncludeSubdocsInStats",
  "doNotAutoCompressPictures",
  "forceUpgrade",
  "captions",
  "readModeInkLockDown",
  "smartTagType",
  "schemaLibrary",
  "shapeDefaults",
  "doNotEmbedSmartTags",
  "decimalSymbol",
  "listSeparator",
];

export function withUpdateFields(settings: string): string {
  const root = /<(\w+:)?settings\b[^>]*>/.exec(settings);
  if (root === null) return settings;
  const prefix = root[1] ?? "";
  const children = childElements(settings, root.index + root[0].length, settings.lastIndexOf(`</${prefix}settings>`));
  const flag = `<${prefix}updateFields ${prefix}val="true"/>`;
  const next = children.find((child) => AFTER_UPDATE_FIELDS.includes(child.local));
  const at = next !== undefined ? next.start : settings.lastIndexOf(`</${prefix}settings>`);
  return settings.slice(0, at) + flag + settings.slice(at);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

