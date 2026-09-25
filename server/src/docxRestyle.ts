/**
 * `docx_restyle`: an existing Word document brought into a template's house style.
 *
 * A paragraph's look is resolved in layers — document defaults, its style and the
 * style's `basedOn` chain, then formatting set on the paragraph and on each run by
 * hand. The last layer wins, which is why attaching a new template in Word changes so
 * little in a document that has drifted: the hand-set fonts still beat the new styles.
 * This does both halves:
 *
 * - the template's style sheet, theme and heading numbering replace the document's,
 *   every style the document uses matched to the template's by name (so an English
 *   `Heading1` becomes a French template's `Titre1`);
 * - fonts, sizes and colours set by hand on runs and paragraph marks are removed, so
 *   the text takes its style's. Everything else a writer set — emphasis, spacing,
 *   indentation — stays.
 *
 * Removals are tracked formatting changes (`w:rPrChange`, `w:sectPrChange`) by default.
 * The replaced definitions cannot be revisions, which the answer says. The text is
 * compared before and after, and nothing is written if a character moved.
 */
import {
  declareNamespaces,
  highestNumber,
  namespacesOf,
  prefixesUsed,
  reachableParts,
} from "./docxGraft.ts";
import { CONTENT_TYPES, CT_NUMBERING, NS_R, REL_NUMBERING, REL_STYLES, ROOT_RELS, WordTemplateError, type WordPackage } from "./docxTemplate.ts";
import { PENDING, REVISION_AUTHOR } from "./docxUpdate.ts";
import { contentTypeOf, decode, parseRelationshipList, relativeTarget, relsPartOf, scanRawRelationships } from "./ooxml.ts";
import { bodyLayout, childElements, parseStyles, styleKey } from "./wordml.ts";
import { writeZip } from "./zipWriter.ts";

export type RestyleInclude = "page" | "headers";

export interface RestyleOptions {
  trackChanges?: boolean;
  /** What of the template's page setup to apply as well: size and margins, headers and footers. */
  include?: RestyleInclude[];
  /** The revision time; defaults to now. */
  date?: Date;
}

export interface RestyledDocument {
  bytes: Buffer;
  report: string[];
  removed: { runs: number; fonts: number; sizes: number; colours: number };
  /** Styles the document uses and the template lacks, kept as they were, with how often each is used. */
  missingStyles: Array<{ name: string; uses: number }>;
}

const REL_HEADER = `${NS_R}/header`;
const REL_FOOTER = `${NS_R}/footer`;
const REL_THEME = `${NS_R}/theme`;
const STORY_TYPES = new Set([REL_HEADER, REL_FOOTER, `${NS_R}/footnotes`, `${NS_R}/endnotes`]);
const CT_THEME = "application/vnd.openxmlformats-officedocument.theme+xml";
const NS_REL_PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";

/** The run properties removed: the formatting a style is for. */
const HAND_SET = /<w:(rFonts|sz|szCs|color)\b[^>]*\/>/g;

/** `CT_SectPr`'s children, in the order the schema fixes. */
const SECTION_ORDER = [
  "headerReference",
  "footerReference",
  "footnotePr",
  "endnotePr",
  "type",
  "pgSz",
  "pgMar",
  "paperSrc",
  "pgBorders",
  "lnNumType",
  "pgNumType",
  "cols",
  "formProt",
  "vAlign",
  "noEndnote",
  "titlePg",
  "textDirection",
  "bidi",
  "rtlGutter",
  "docGrid",
  "printerSettings",
  "sectPrChange",
];

/** Every piece of text of a part, in order: what restyling must leave exactly as it was. */
function textOf(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("\u0001");
}

/** Refuse a restyled part whose text is not the original's, character for character. */
export function assertTextUnchanged(part: string, before: string, after: string): void {
  if (textOf(before) !== textOf(after)) throw new WordTemplateError(`restyling would have changed the text of ${part}; nothing was written`);
}

/** Spans of `[start, end)` holding equations, whose run properties belong to the equation. */
function mathSpans(xml: string): Array<[number, number]> {
  return [...xml.matchAll(/<m:oMath\b[\s\S]*?<\/m:oMath>/g)].map((match) => [match.index!, match.index! + match[0].length]);
}

/** The attributes of a self-closing element as a map. */
function attributesOf(element: string): Record<string, string> {
  return Object.fromEntries([...element.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

/** A section's children put back in the schema's order, `replace` overriding by name. */
function rebuildSection(sectPr: string, replace: Map<string, string[] | null>, append: string[] = []): string {
  const selfClosing = /^<w:sectPr\b([^>]*?)\/>$/.exec(sectPr);
  if (selfClosing !== null) return rebuildSection(`<w:sectPr${selfClosing[1]}></w:sectPr>`, replace, append);
  const open = /^<w:sectPr\b[^>]*>/.exec(sectPr)!;
  const inner = sectPr.slice(open[0].length, sectPr.lastIndexOf("</w:sectPr>"));
  const children = childElements(inner, 0, inner.length);
  const byName = new Map<string, string[]>();
  for (const child of children) byName.set(child.local, [...(byName.get(child.local) ?? []), child.xml]);
  for (const [name, value] of replace) {
    if (value === null) byName.delete(name);
    else byName.set(name, value);
  }
  const known = SECTION_ORDER.flatMap((name) => byName.get(name) ?? []);
  const unknown = children.filter((child) => !SECTION_ORDER.includes(child.local)).map((child) => child.xml);
  return `${open[0]}${known.join("")}${unknown.join("")}${append.join("")}</w:sectPr>`;
}

interface Carried {
  /** The part's name in the document. */
  part: string;
  bytes: Buffer;
  contentType: string | undefined;
}

export function restyleDocument(doc: WordPackage, template: WordPackage, options: RestyleOptions = {}): RestyledDocument {
  const track = options.trackChanges !== false;
  const include = new Set(options.include ?? []);
  const date = (options.date ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const templateStylesXml = template.stylesPart === undefined ? undefined : decode(template.parts, template.stylesPart);
  if (templateStylesXml === undefined) throw new WordTemplateError("the template has no style sheet to take the styles from");

  const out = new Map(doc.parts);
  const addedRels: string[] = [];
  const droppedRelIds = new Set<string>();
  const overrides: Array<[string, string]> = [];
  let nextRel = highestNumber(doc.documentRels.map((rel) => rel.id)) + 1;
  const newRelId = () => {
    while (doc.documentRels.some((rel) => rel.id === `rId${nextRel}`)) nextRel++;
    return `rId${nextRel++}`;
  };

  // The stories: every part holding the document's own text.
  const stories = [doc.mainPart, ...doc.documentRels.filter((rel) => !rel.external && STORY_TYPES.has(rel.type) && doc.parts.has(rel.target)).map((rel) => rel.target)];
  const original = new Map(stories.map((part) => [part, decode(doc.parts, part) ?? ""]));
  for (const [part, xml] of original) {
    if (PENDING.test(xml)) {
      throw new WordTemplateError(
        `${part === doc.mainPart ? "the document" : part} holds tracked changes nobody has accepted or rejected yet; resolve them in Word first`,
      );
    }
  }
  const replaceHeaders = include.has("headers");
  const headerParts = new Set(doc.documentRels.filter((rel) => rel.type === REL_HEADER || rel.type === REL_FOOTER).map((rel) => rel.target));
  const edited = new Map(original);

  /* ── Styles: the template's, the document's matched to them by name ──────────── */

  const docStyles = doc.styles;
  const templateStyles = template.styles;
  const takenIds = new Set(templateStyles.keys());
  const styleMap = new Map<string, string>();
  const carriedStyles: string[] = [];
  const carriedNames = new Map<string, string>();
  const mapStyle = (id: string, seen = new Set<string>()): string => {
    const mapped = styleMap.get(id);
    if (mapped !== undefined) return mapped;
    const source = docStyles.get(id);
    if (source === undefined || seen.has(id)) return id;
    seen.add(id);
    const key = styleKey(source.name);
    const match = [...templateStyles.values()].find((style) => style.type === source.type && styleKey(style.name) === key);
    if (match !== undefined) {
      styleMap.set(id, match.id);
      return match.id;
    }
    let newId = id;
    for (let n = 2; takenIds.has(newId); n++) newId = `${id}${n}`;
    takenIds.add(newId);
    styleMap.set(id, newId);
    carriedNames.set(newId, source.name);
    let xml = source.xml.replace(/(\bw:styleId=")[^"]*(")/, `$1${newId}$2`);
    xml = xml.replace(/(<w:(?:basedOn|next|link)\b[^>]*?\bw:val=")([^"]*)(")/g, (_, open: string, value: string, close: string) => `${open}${mapStyle(value, seen)}${close}`);
    carriedStyles.push(xml);
    return newId;
  };
  const isTemplateStyle = (id: string) => templateStyles.has(id);

  const uses = new Map<string, number>();
  for (const part of stories) {
    if (replaceHeaders && headerParts.has(part)) continue;
    edited.set(
      part,
      edited.get(part)!.replace(/(<w:(pStyle|rStyle|tblStyle)\b[^>]*?\bw:val=")([^"]*)(")/g, (_, open: string, kind: string, value: string, close: string) => {
        const mapped = mapStyle(value);
        if (!isTemplateStyle(mapped) && docStyles.has(value)) uses.set(mapped, (uses.get(mapped) ?? 0) + 1);
        return `${open}${mapped}${close}`;
      }),
    );
  }

  // The document's own numbering keeps its lists; its links to styles follow the rename,
  // and a heading link the template's style now carries itself is let go.
  let docNumbering = doc.numberingPart === undefined ? undefined : decode(doc.parts, doc.numberingPart);
  if (docNumbering !== undefined) {
    docNumbering = docNumbering.replace(/<w:(pStyle|styleLink|numStyleLink)\b[^>]*?\bw:val="([^"]*)"[^>]*\/>/g, (whole, kind: string, value: string) => {
      const mapped = mapStyle(value);
      if ((kind === "pStyle" || kind === "styleLink") && isTemplateStyle(mapped)) return "";
      return whole.replace(`w:val="${value}"`, `w:val="${mapped}"`);
    });
  }

  // The template's numbering its styles use (heading numbering), renumbered past the document's.
  let stylesXml = templateStylesXml;
  const templateNumbering = template.numberingPart === undefined ? undefined : decode(template.parts, template.numberingPart);
  const addedAbstracts: string[] = [];
  const addedNums: string[] = [];
  {
    const root = templateNumbering === undefined ? null : /<(\w+:)?numbering\b[^>]*>/.exec(templateNumbering);
    const elements = root === null ? [] : childElements(templateNumbering!, root.index + root[0].length, templateNumbering!.lastIndexOf("</"));
    const abstracts = new Map(elements.filter((e) => e.local === "abstractNum").map((e) => [/abstractNumId="(\d+)"/.exec(e.xml)![1], e.xml]));
    const nums = new Map(elements.filter((e) => e.local === "num").map((e) => [/numId="(\d+)"/.exec(e.xml)![1], e.xml]));
    let nextAbstract = highestNumber([...(docNumbering ?? "").matchAll(/abstractNumId="(\d+)"/g)].map((match) => match[1])) + 1;
    let nextNum = highestNumber([...(docNumbering ?? "").matchAll(/<w:num\b[^>]*numId="(\d+)"/g)].map((match) => match[1])) + 1;
    const numMap = new Map<string, string>();
    const abstractMap = new Map<string, string>();
    stylesXml = stylesXml.replace(/(<w:numId\b[^>]*?\bw:val=")(\d+)(")/g, (whole, open: string, value: string, close: string) => {
      const num = nums.get(value);
      // A numbering the template's own package lacks: left as it was, its id would name
      // one of the document's lists instead. 0 is "not numbered".
      if (num === undefined) return value === "0" ? whole : `${open}0${close}`;
      let newNum = numMap.get(value);
      if (newNum === undefined) {
        const abstractId = /<w:abstractNumId\b[^>]*?val="(\d+)"/.exec(num)?.[1];
        if (abstractId !== undefined && !abstractMap.has(abstractId) && abstracts.has(abstractId)) {
          const newAbstract = String(nextAbstract++);
          abstractMap.set(abstractId, newAbstract);
          addedAbstracts.push(
            abstracts
              .get(abstractId)!
              .replace(/(abstractNumId=")\d+(")/, `$1${newAbstract}$2`)
              // A list's identity in Word: two lists sharing one are merged.
              .replace(/<w:nsid\b[^>]*\/>/g, ""),
          );
        }
        newNum = String(nextNum++);
        numMap.set(value, newNum);
        addedNums.push(
          num
            .replace(/(\bnumId=")\d+(")/, `$1${newNum}$2`)
            .replace(/(<w:abstractNumId\b[^>]*?val=")(\d+)(")/, (_, a: string, id: string, c: string) => `${a}${abstractMap.get(id) ?? id}${c}`),
        );
      }
      return `${open}${newNum}${close}`;
    });
  }
  if (addedNums.length > 0) {
    const needed = new Map([...prefixesUsed(addedAbstracts.join("") + addedNums.join(""))].flatMap((prefix) => {
      const uri = namespacesOf(templateNumbering!).get(prefix);
      return uri === undefined ? [] : [[prefix, uri] as const];
    }));
    if (docNumbering !== undefined) {
      const firstNum = /<w:num\b[^>]*\bnumId=/.exec(docNumbering);
      const cleanup = /<w:numIdMacAtCleanup\b/.exec(docNumbering);
      const numsAt = cleanup !== null ? cleanup.index : docNumbering.lastIndexOf("</");
      docNumbering = docNumbering.slice(0, numsAt) + addedNums.join("") + docNumbering.slice(numsAt);
      const abstractsAt = firstNum !== null ? firstNum.index : numsAt;
      docNumbering = docNumbering.slice(0, abstractsAt) + addedAbstracts.join("") + docNumbering.slice(abstractsAt);
      docNumbering = declareNamespaces(docNumbering, needed, new Set());
    } else {
      const root = /<(\w+:)?numbering\b[^>]*>/.exec(templateNumbering!)!;
      docNumbering = templateNumbering!.slice(0, root.index + root[0].length) + addedAbstracts.join("") + addedNums.join("") + `</${root[1] ?? ""}numbering>`;
      const part = doc.parts.has("word/numbering.xml") ? "word/pi-numbering.xml" : "word/numbering.xml";
      addedRels.push(`<Relationship Id="${newRelId()}" Type="${REL_NUMBERING}" Target="${relativeTarget(doc.mainPart, part)}"/>`);
      overrides.push([part, CT_NUMBERING]);
      out.set(part, Buffer.from(docNumbering, "utf8"));
      docNumbering = undefined;
    }
  }
  if (docNumbering !== undefined && doc.numberingPart !== undefined) out.set(doc.numberingPart, Buffer.from(docNumbering, "utf8"));

  if (carriedStyles.length > 0) {
    const close = stylesXml.lastIndexOf("</");
    stylesXml = stylesXml.slice(0, close) + carriedStyles.join("") + stylesXml.slice(close);
    const docStylesXml = doc.stylesPart === undefined ? "" : (decode(doc.parts, doc.stylesPart) ?? "");
    const needed = new Map([...prefixesUsed(carriedStyles.join(""))].flatMap((prefix) => {
      const uri = namespacesOf(docStylesXml).get(prefix);
      return uri === undefined ? [] : [[prefix, uri] as const];
    }));
    stylesXml = declareNamespaces(stylesXml, needed, new Set());
  }
  if (doc.stylesPart !== undefined) {
    out.set(doc.stylesPart, Buffer.from(stylesXml, "utf8"));
  } else {
    const part = "word/styles.xml";
    out.set(part, Buffer.from(stylesXml, "utf8"));
    addedRels.push(`<Relationship Id="${newRelId()}" Type="${REL_STYLES}" Target="${relativeTarget(doc.mainPart, part)}"/>`);
    overrides.push([part, contentTypeOf(decode(template.parts, CONTENT_TYPES)!, template.stylesPart!) ?? "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"]);
  }

  /* ── Parts carried from the template: the theme, and headers and footers on request ── */

  const templateTypes = decode(template.parts, CONTENT_TYPES)!;
  const carried: Carried[] = [];
  let nextCarried = 1;
  const freeName = (folder: string, extension: string) => {
    let name: string;
    do name = `${folder}/pi-${nextCarried++}.${extension}`;
    while (out.has(name) || carried.some((item) => item.part === name));
    return name;
  };
  /** A template part, with whatever its relationships reach, copied under names of its own. */
  const carry = (fromPart: string, toPart: string): void => {
    carried.push({ part: toPart, bytes: template.parts.get(fromPart)!, contentType: contentTypeOf(templateTypes, fromPart) });
    const relsXml = decode(template.parts, relsPartOf(fromPart));
    if (relsXml === undefined) return;
    const rewritten: string[] = [];
    for (const rel of parseRelationshipList(relsXml, fromPart)) {
      if (rel.external) {
        rewritten.push(`<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" TargetMode="External"/>`);
        continue;
      }
      if (!template.parts.has(rel.target)) continue;
      const extension = rel.target.split(".").pop()!.toLowerCase();
      const folder = rel.target.includes("/media/") ? "word/media" : toPart.slice(0, toPart.lastIndexOf("/"));
      const target = freeName(folder, extension);
      carried.push({ part: target, bytes: template.parts.get(rel.target)!, contentType: contentTypeOf(templateTypes, rel.target) });
      rewritten.push(`<Relationship Id="${rel.id}" Type="${rel.type}" Target="${relativeTarget(toPart, target)}"/>`);
    }
    carried.push({
      part: relsPartOf(toPart),
      bytes: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_REL_PACKAGE}">${rewritten.join("")}</Relationships>`, "utf8"),
      contentType: undefined,
    });
  };

  const templateTheme = template.documentRels.find((rel) => rel.type === REL_THEME && !rel.external && template.parts.has(rel.target));
  if (templateTheme !== undefined) {
    const docTheme = doc.documentRels.find((rel) => rel.type === REL_THEME && !rel.external);
    const part = docTheme?.target ?? "word/theme/theme1.xml";
    // The old theme's own relationships go with it.
    out.delete(relsPartOf(part));
    carry(templateTheme.target, part);
    if (docTheme === undefined) {
      addedRels.push(`<Relationship Id="${newRelId()}" Type="${REL_THEME}" Target="${relativeTarget(doc.mainPart, part)}"/>`);
      overrides.push([part, CT_THEME]);
    }
  }

  const templateSection = bodyLayout(template.documentXml).sectPr?.xml ?? "";
  const templateRefs: string[] = [];
  if (replaceHeaders) {
    for (const ref of templateSection.matchAll(/<w:(headerReference|footerReference)\b[^>]*\/>/g)) {
      const attributes = attributesOf(ref[0]);
      const rel = template.documentRels.find((candidate) => candidate.id === attributes["r:id"]);
      if (rel === undefined || rel.external || !template.parts.has(rel.target)) continue;
      const part = freeName("word", "xml");
      carry(rel.target, part);
      overrides.push([part, contentTypeOf(templateTypes, rel.target)!]);
      const id = newRelId();
      addedRels.push(`<Relationship Id="${id}" Type="${rel.type}" Target="${relativeTarget(doc.mainPart, part)}"/>`);
      templateRefs.push(`<w:${ref[1]} w:type="${attributes["w:type"] ?? "default"}" r:id="${id}"/>`);
    }
    for (const rel of doc.documentRels) if (rel.type === REL_HEADER || rel.type === REL_FOOTER) droppedRelIds.add(rel.id);
  }

  /* ── Hand-set formatting, removed ─────────────────────────────────────────── */

  let nextRevision = 1 + Math.max(0, ...[...original.values()].flatMap((xml) => [...xml.matchAll(/\bw:id="(\d+)"/g)].map((match) => Number(match[1]))));
  const mark = () => `w:id="${nextRevision++}" w:author="${REVISION_AUTHOR}" w:date="${date}"`;
  const removed = { runs: 0, fonts: 0, sizes: 0, colours: 0 };
  for (const part of stories) {
    if (replaceHeaders && headerParts.has(part)) continue;
    const xml = edited.get(part)!;
    const math = mathSpans(xml);
    edited.set(
      part,
      xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (whole, inner: string, offset: number) => {
        if (math.some(([start, end]) => offset >= start && offset < end)) return whole;
        const kinds = new Set<string>();
        const kept = inner.replace(HAND_SET, (_, name: string) => {
          kinds.add(name === "rFonts" ? "fonts" : name === "color" ? "colours" : "sizes");
          return "";
        });
        if (kinds.size === 0) return whole;
        removed.runs++;
        for (const kind of kinds) removed[kind as "fonts" | "sizes" | "colours"]++;
        if (track) return `<w:rPr>${kept}<w:rPrChange ${mark()}><w:rPr>${inner}</w:rPr></w:rPrChange></w:rPr>`;
        return kept === "" ? "" : `<w:rPr>${kept}</w:rPr>`;
      }),
    );
  }

  /* ── Page setup and headers, on request ───────────────────────────────────── */

  let sections = 0;
  if (include.has("page") || replaceHeaders) {
    const templateSize = /<w:pgSz\b[^>]*\/>/.exec(templateSection)?.[0];
    const templateMargins = /<w:pgMar\b[^>]*\/>/.exec(templateSection)?.[0];
    const templateTitlePage = /<w:titlePg\b[^>]*\/>/.exec(templateSection)?.[0];
    const size = templateSize === undefined ? undefined : attributesOf(templateSize);
    const short = size === undefined ? 0 : Math.min(Number(size["w:w"]), Number(size["w:h"]));
    const long = size === undefined ? 0 : Math.max(Number(size["w:w"]), Number(size["w:h"]));
    const main = edited.get(doc.mainPart)!;
    edited.set(
      doc.mainPart,
      main.replace(/<w:sectPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:sectPr>)/g, (sectPr) => {
        sections++;
        const replace = new Map<string, string[] | null>();
        const append: string[] = [];
        if (include.has("page") && size !== undefined && templateMargins !== undefined) {
          const own = /<w:pgSz\b[^>]*\/>/.exec(sectPr)?.[0];
          const ownSize = own === undefined ? {} : attributesOf(own);
          const landscape = ownSize["w:orient"] === "landscape" || Number(ownSize["w:w"]) > Number(ownSize["w:h"]);
          replace.set("pgSz", [landscape ? `<w:pgSz w:w="${long}" w:h="${short}" w:orient="landscape"/>` : `<w:pgSz w:w="${short}" w:h="${long}"/>`]);
          replace.set("pgMar", [templateMargins]);
          if (track) {
            const inner = /^<w:sectPr\b[^>]*>([\s\S]*)<\/w:sectPr>$/.exec(sectPr)?.[1] ?? "";
            const base = childElements(inner, 0, inner.length)
              .filter((child) => child.local !== "headerReference" && child.local !== "footerReference")
              .map((child) => child.xml)
              .join("");
            append.push(`<w:sectPrChange ${mark()}><w:sectPr>${base}</w:sectPr></w:sectPrChange>`);
          }
        }
        if (replaceHeaders) {
          replace.set("headerReference", templateRefs.filter((ref) => ref.startsWith("<w:headerReference")));
          replace.set("footerReference", templateRefs.filter((ref) => ref.startsWith("<w:footerReference")));
          replace.set("titlePg", templateTitlePage === undefined ? null : [templateTitlePage]);
        }
        return rebuildSection(sectPr, replace, append);
      }),
    );
  }

  /* ── The text must not have moved ─────────────────────────────────────────── */

  for (const [part, before] of original) {
    if (replaceHeaders && headerParts.has(part)) continue;
    assertTextUnchanged(part, before, edited.get(part)!);
  }

  /* ── The package ──────────────────────────────────────────────────────────── */

  for (const [part, xml] of edited) {
    if (xml !== original.get(part)) out.set(part, Buffer.from(xml, "utf8"));
  }
  for (const item of carried) out.set(item.part, item.bytes);

  const documentRelsPart = relsPartOf(doc.mainPart);
  const relsXml = decode(doc.parts, documentRelsPart) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_REL_PACKAGE}"></Relationships>`;
  const keptRels: string[] = [];
  scanRawRelationships(relsXml, (raw) => {
    const id = /\bId="([^"]*)"/.exec(raw)?.[1] ?? "";
    if (!droppedRelIds.has(id)) keptRels.push(raw);
  });
  const head = relsXml.slice(0, relsXml.indexOf("<Relationships"));
  const open = /<Relationships\b[^>]*>/.exec(relsXml)?.[0] ?? `<Relationships xmlns="${NS_REL_PACKAGE}">`;
  out.set(documentRelsPart, Buffer.from(`${head}${open}${keptRels.join("")}${addedRels.join("")}</Relationships>`, "utf8"));

  // What the document no longer reaches — its replaced headers and their pictures — goes.
  const before = reachableParts(doc.parts);
  const after = reachableParts(out);
  const swept = new Set<string>();
  for (const part of [...out.keys()]) {
    if (part === CONTENT_TYPES || part.endsWith(".rels") || after.has(part) || !before.has(part)) continue;
    out.delete(part);
    swept.add(part);
  }
  for (const part of [...out.keys()]) {
    if (part.endsWith(".rels") && part !== ROOT_RELS && swept.has(part.replace(/_rels\/([^/]+)\.rels$/, "$1"))) out.delete(part);
  }

  // Content types: overrides for what came, none for what went, a default for new extensions.
  let types = decode(doc.parts, CONTENT_TYPES)!;
  types = types.replace(/<(?:\w+:)?Override\b[^>]*?\/>/g, (element) => {
    const part = /\bPartName="([^"]*)"/.exec(element)?.[1]?.replace(/^\//, "");
    return part !== undefined && swept.has(part) ? "" : element;
  });
  const declaredDefaults = new Set([...types.matchAll(/<(?:\w+:)?Default\b[^>]*\bExtension="([^"]*)"/g)].map((match) => match[1].toLowerCase()));
  const declaredOverrides = new Set([...types.matchAll(/PartName="\/([^"]*)"/g)].map((match) => match[1].toLowerCase()));
  const additions: string[] = [];
  for (const [part, type] of overrides) {
    if (!declaredOverrides.has(part.toLowerCase())) additions.push(`<Override PartName="/${part}" ContentType="${type}"/>`);
    declaredOverrides.add(part.toLowerCase());
  }
  for (const item of carried) {
    if (item.contentType === undefined || item.part.endsWith(".rels")) continue;
    const extension = item.part.split(".").pop()!.toLowerCase();
    if (declaredOverrides.has(item.part.toLowerCase()) || (declaredDefaults.has(extension) && contentTypeOf(types, item.part) === item.contentType)) continue;
    if (!declaredDefaults.has(extension) && item.part.startsWith("word/media/")) {
      additions.push(`<Default Extension="${extension}" ContentType="${item.contentType}"/>`);
      declaredDefaults.add(extension);
    } else {
      additions.push(`<Override PartName="/${item.part}" ContentType="${item.contentType}"/>`);
      declaredOverrides.add(item.part.toLowerCase());
    }
  }
  const close = types.lastIndexOf("</");
  out.set(CONTENT_TYPES, Buffer.from(types.slice(0, close) + additions.join("") + types.slice(close), "utf8"));

  const order = [CONTENT_TYPES, ...[...doc.parts.keys()].filter((name) => name !== CONTENT_TYPES), ...[...out.keys()].filter((name) => !doc.parts.has(name))];
  const bytes = writeZip([...new Set(order)].filter((name) => out.has(name)).map((name) => ({ name, data: out.get(name)! })));

  /* ── What happened, said plainly ──────────────────────────────────────────── */

  const missingStyles = [...uses].map(([id, count]) => ({ name: carriedNames.get(id) ?? id, uses: count })).sort((a, b) => b.uses - a.uses);
  const report = [
    `Styles, theme and heading numbering: the template's${templateTheme === undefined ? " (the template has no theme; the document's was kept)" : ""}.`,
    removed.runs === 0
      ? "No font, size or colour was set by hand."
      : `Removed hand-set formatting from ${removed.runs} run(s): a font in ${removed.fonts}, a size in ${removed.sizes}, a colour in ${removed.colours}${track ? " — as tracked formatting changes" : ""}.`,
  ];
  if (missingStyles.length > 0) {
    report.push(`Styles the template does not have, kept as they were: ${missingStyles.map((style) => `"${style.name}" (${style.uses} use${style.uses === 1 ? "" : "s"})`).join(", ")}.`);
  }
  if (include.has("page")) report.push(`Page size and margins: the template's, in ${sections} section(s), each keeping its orientation${track ? " (tracked)" : ""}.`);
  if (replaceHeaders) report.push(`Headers and footers: the template's${templateRefs.length === 0 ? " (it has none, so the document now has none)" : ""}.`);
  report.push(
    track
      ? "The replaced style definitions, theme and numbering are not tracked changes: rejecting every change in Word brings back the hand-set formatting, not the old styles. The original file is the way back."
      : "Written directly, without tracked changes. The original file is the way back.",
  );
  return { bytes, report, removed, missingStyles };
}
