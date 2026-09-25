/**
 * `pptx_update`: changing an existing PowerPoint deck slide by slide.
 *
 * The deck is its own template. A replaced slide is rewritten on its own layout, an
 * inserted one on a layout of the deck's own, with the same placement rules as
 * `pptx_create`; a deleted slide goes with whatever only it used; a moved one changes
 * its place in the running order and nothing else.
 *
 * Every slide the edits do not touch is left as the bytes it was, together with every
 * part it uses: only the presentation part (its slide list), its relationships, the
 * content types, and the parts the edits make or retire change.
 *
 * SECURITY: the deck is a workspace file; it is opened with the same capped reader and
 * DOCTYPE-refusing scanner as a template, and relationship targets stay names inside
 * the package.
 */
import { IMAGE_CONTENT_TYPES, type ImageKind } from "./imageInfo.ts";
import { decode, parseRelationshipList, relativeTarget, relsPartOf, scanRawRelationships } from "./ooxml.ts";
import {
  composeSlide,
  CONTENT_TYPES,
  CT_SLIDE,
  defaultLayout,
  ensureRelationshipNamespace,
  findLayout,
  NS_R,
  NS_REL_PACKAGE,
  PptxBuildError,
  readTemplate,
  REL_SLIDE,
  REL_SLIDE_LAYOUT,
  ROOT_RELS,
  validateSlide,
  type BuildOptions,
  type NewSlide,
  type PartNames,
  type SlideSpec,
  type Template,
} from "./pptxBuild.ts";
import { CT_XLSX } from "./pptxVisuals.ts";
import { writeZip } from "./zipWriter.ts";

export const MAX_DECK_EDITS = 100;
const REL_NOTES = `${NS_R}/notesSlide`;

/** A slide named by its number in the deck as it is now (1-based), or by its title. */
export type SlideRef = number | string;

export type DeckEdit =
  | { action: "replace"; slide: SlideRef; content: SlideSpec }
  | { action: "insert_after"; slide: SlideRef | 0; content: SlideSpec }
  | { action: "delete"; slide: SlideRef }
  | { action: "move"; slide: SlideRef; after: SlideRef | 0 };

export interface UpdatedDeck {
  bytes: Buffer;
  /** Numbers, in the result, of the slides written or moved — the ones to render. */
  changed: number[];
  report: string[];
  warnings: string[];
}

interface ExistingSlide {
  /** The `<p:sldId …/>` element as written, kept verbatim for untouched slides. */
  raw: string;
  id: number;
  rid: string;
  part: string;
  title: string;
}

/** The title a slide shows: the text of its title placeholder. */
function slideTitle(xml: string): string {
  for (const shape of xml.matchAll(/<(?:\w+:)?sp\b[\s\S]*?<\/(?:\w+:)?sp>/g)) {
    if (!/<(?:\w+:)?ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(shape[0])) continue;
    return [...shape[0].matchAll(/<(?:\w+:)?t>([^<]*)<\/(?:\w+:)?t>/g)].map((match) => match[1]).join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

function normalise(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function listing(slides: ExistingSlide[]): string {
  return ["The deck's slides:", ...slides.map((slide, index) => `${index + 1}. ${slide.title === "" ? "(no title)" : slide.title}`)].join("\n");
}

function resolveRef(ref: SlideRef, slides: ExistingSlide[], label: string): number {
  if (typeof ref === "number" || /^\s*\d+\s*$/.test(String(ref))) {
    const number = Number(ref);
    if (!Number.isInteger(number) || number < 1 || number > slides.length) {
      throw new PptxBuildError(`${label}: the deck has ${slides.length} slide(s); there is no slide ${ref}.\n${listing(slides)}`);
    }
    return number - 1;
  }
  const wanted = normalise(String(ref));
  const found = slides.flatMap((slide, index) => (normalise(slide.title) === wanted ? [index] : []));
  if (found.length === 0) throw new PptxBuildError(`${label}: no slide is titled "${ref}".\n${listing(slides)}`);
  if (found.length > 1) throw new PptxBuildError(`${label}: ${found.length} slides are titled "${ref}"; name it by number.\n${listing(slides)}`);
  return found[0];
}

function reachable(parts: Map<string, Buffer>): Set<string> {
  const reached = new Set<string>();
  const queue = [""];
  while (queue.length > 0) {
    const source = queue.shift()!;
    if (source !== "") reached.add(source);
    for (const rel of parseRelationshipList(decode(parts, source === "" ? ROOT_RELS : relsPartOf(source)), source)) {
      if (!rel.external && !reached.has(rel.target) && !queue.includes(rel.target) && parts.has(rel.target)) queue.push(rel.target);
    }
  }
  return reached;
}

type Entry = { kind: "existing"; index: number } | { kind: "new"; edit: number; slide: NewSlide; rid: string; id: number };

export async function updatePresentation(bytes: Uint8Array, edits: DeckEdit[], options: BuildOptions = {}): Promise<UpdatedDeck> {
  if (edits.length === 0) throw new PptxBuildError("no edits were given");
  if (edits.length > MAX_DECK_EDITS) throw new PptxBuildError(`at most ${MAX_DECK_EDITS} edits in one call (got ${edits.length})`);
  const template: Template = readTemplate(bytes);
  const parts = template.parts;
  const presentationXml = decode(parts, template.presentationPart)!;
  const presentationRelsPart = relsPartOf(template.presentationPart);
  const presentationRels = parseRelationshipList(decode(parts, presentationRelsPart), template.presentationPart);

  const list = /<(\w+:)?sldIdLst\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sldIdLst>/.exec(presentationXml);
  const p = /<(\w+:)?presentation\b/.exec(presentationXml)?.[1] ?? "";
  const slides: ExistingSlide[] = [];
  for (const match of (list?.[2] ?? "").matchAll(/<(?:\w+:)?sldId\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?sldId>)/g)) {
    const raw = match[0];
    const id = Number(/\bid="(\d+)"/.exec(raw)?.[1]);
    const rid = /\b[\w]+:id="([^"]*)"/.exec(raw)?.[1] ?? "";
    const rel = presentationRels.find((candidate) => candidate.id === rid);
    if (rel === undefined || rel.type !== REL_SLIDE || !parts.has(rel.target)) continue;
    slides.push({ raw, id, rid, part: rel.target, title: slideTitle(decode(parts, rel.target) ?? "") });
  }
  if (slides.length === 0 && edits.some((edit) => edit.action !== "insert_after")) throw new PptxBuildError("the deck has no slides");

  // Resolve everything against the deck as it is before changing anything.
  const touched = new Map<number, number>();
  const claim = (index: number, order: number) => {
    const other = touched.get(index);
    if (other !== undefined) throw new PptxBuildError(`edits ${other + 1} and ${order + 1} both change slide ${index + 1}; combine them into one`);
    touched.set(index, order);
  };
  const resolved = edits.map((edit, order) => {
    const label = `edit ${order + 1}`;
    if (edit.action === "insert_after") {
      validateSlide(edit.content, label);
      return { edit, order, anchor: edit.slide === 0 || edit.slide === "0" ? -1 : resolveRef(edit.slide, slides, label) };
    }
    const index = resolveRef(edit.slide, slides, label);
    claim(index, order);
    if (edit.action === "replace") validateSlide(edit.content, label);
    const anchor = edit.action === "move" ? (edit.after === 0 || edit.after === "0" ? -1 : resolveRef(edit.after, slides, label)) : undefined;
    if (anchor === index) throw new PptxBuildError(`${label}: a slide cannot be moved after itself`);
    return { edit, order, index, anchor };
  });
  const deleted = new Set(resolved.flatMap((r) => (r.edit.action === "delete" ? [r.index!] : [])));
  for (const r of resolved) {
    if (r.anchor !== undefined && r.anchor >= 0 && deleted.has(r.anchor)) {
      throw new PptxBuildError(`edit ${r.order + 1}: slide ${r.anchor + 1} is deleted by another edit and cannot be an anchor`);
    }
  }

  // Part names and ids the new slides may take.
  let slideNumber = 0;
  for (const part of parts.keys()) {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(part);
    if (match) slideNumber = Math.max(slideNumber, Number(match[1]));
  }
  let mediaPrefix = "pptx-update-";
  while ([...parts.keys()].some((part) => part.startsWith(`ppt/media/${mediaPrefix}`))) mediaPrefix = `x${mediaPrefix}`;
  let chartNumber = 0;
  const names: PartNames = {
    mediaPrefix,
    nextChart: () => {
      do chartNumber++;
      while (parts.has(`ppt/charts/chart${chartNumber}.xml`) || parts.has(`ppt/embeddings/Microsoft_Excel_Sheet${chartNumber}.xlsx`));
      return chartNumber;
    },
  };
  let nextRid = 0;
  for (const rel of presentationRels) {
    const match = /^rId(\d+)$/.exec(rel.id);
    if (match) nextRid = Math.max(nextRid, Number(match[1]));
  }
  let nextSlideId = Math.max(255, ...slides.map((slide) => slide.id));

  const out = new Map(parts);
  const warnings: string[] = [];
  const addedRels: string[] = [];
  const repointed = new Map<string, string>();
  const overrides: Array<[string, string]> = [];
  const extensions = new Set<string>();
  const place = (slide: NewSlide) => {
    out.set(slide.part, Buffer.from(slide.xml, "utf8"));
    out.set(relsPartOf(slide.part), Buffer.from(slide.rels, "utf8"));
    overrides.push([slide.part, CT_SLIDE]);
    for (const item of slide.media) {
      out.set(item.part, item.bytes);
      if (item.part.endsWith(".rels")) continue;
      if (item.contentType !== undefined) overrides.push([item.part, item.contentType]);
      else extensions.add(item.part.split(".").pop()!.toLowerCase());
    }
  };
  const layoutOf = (slide: ExistingSlide) => {
    const target = parseRelationshipList(decode(parts, relsPartOf(slide.part)), slide.part).find((rel) => rel.type === REL_SLIDE_LAYOUT)?.target;
    return template.layouts.find((layout) => layout.part === target);
  };

  const inserted = new Map<number, Entry[]>();
  const report: string[] = [];
  for (const r of resolved) {
    const label = `edit ${r.order + 1}`;
    const edit = r.edit;
    if (edit.action === "replace") {
      const old = slides[r.index!];
      const layout =
        edit.content.layout !== undefined && edit.content.layout.trim() !== ""
          ? findLayout(template.layouts, edit.content.layout)
          : (layoutOf(old) ?? defaultLayout(template.layouts, edit.content, r.index!));
      const slideWarnings: string[] = [];
      const composed = await composeSlide(template, layout, edit.content, ++slideNumber, names, options, slideWarnings);
      // Speaker notes belong to the slide, not to its content: they follow it.
      const notes = parseRelationshipList(decode(parts, relsPartOf(old.part)), old.part).find((rel) => rel.type === REL_NOTES);
      if (notes !== undefined) {
        const notesRels = decode(parts, relsPartOf(notes.target));
        if (notesRels !== undefined) {
          let rewritten = notesRels;
          scanRawRelationships(notesRels, (raw, type) => {
            if (type !== REL_SLIDE) return;
            rewritten = rewritten.replace(raw, raw.replace(/\bTarget="[^"]*"/, `Target="${relativeTarget(notes.target, composed.part)}"`));
          });
          out.set(relsPartOf(notes.target), Buffer.from(rewritten, "utf8"));
        }
        composed.rels = composed.rels.replace("</Relationships>", `<Relationship Id="rIdNotes" Type="${REL_NOTES}" Target="${relativeTarget(composed.part, notes.target)}"/></Relationships>`);
      }
      place(composed);
      repointed.set(old.rid, composed.part);
      report.push(`${label}: rewrote slide ${r.index! + 1} on layout "${layout.name}"${slideWarnings.length > 0 ? ` — ${slideWarnings.join("; ")}` : ""}`);
      warnings.push(...slideWarnings.map((warning) => `slide ${r.index! + 1}: ${warning}`));
    } else if (edit.action === "insert_after") {
      const layout =
        edit.content.layout !== undefined && edit.content.layout.trim() !== ""
          ? findLayout(template.layouts, edit.content.layout)
          : defaultLayout(template.layouts, edit.content, r.anchor! + 1);
      const slideWarnings: string[] = [];
      const composed = await composeSlide(template, layout, edit.content, ++slideNumber, names, options, slideWarnings);
      place(composed);
      const rid = `rId${++nextRid}`;
      addedRels.push(`<Relationship Id="${rid}" Type="${REL_SLIDE}" Target="${relativeTarget(template.presentationPart, composed.part)}"/>`);
      const entry: Entry = { kind: "new", edit: r.order, slide: composed, rid, id: ++nextSlideId };
      inserted.set(r.anchor!, [...(inserted.get(r.anchor!) ?? []), entry]);
      report.push(`${label}: added a slide on layout "${layout.name}"${slideWarnings.length > 0 ? ` — ${slideWarnings.join("; ")}` : ""}`);
      warnings.push(...slideWarnings.map((warning) => `new slide: ${warning}`));
    } else if (edit.action === "delete") {
      report.push(`${label}: deleted slide ${r.index! + 1}${slides[r.index!].title ? ` ("${slides[r.index!].title}")` : ""}`);
    } else {
      report.push(`${label}: moved slide ${r.index! + 1}`);
    }
  }

  // The running order: originals in place, less deleted and moved ones, with moved and
  // inserted slides after their anchors (-1: the start), in the order the edits came.
  const moved = new Map<number, number>();
  for (const r of resolved) if (r.edit.action === "move") moved.set(r.index!, r.anchor!);
  const after = new Map<number, Entry[]>();
  for (const r of resolved) {
    if (r.edit.action === "move") after.set(r.anchor!, [...(after.get(r.anchor!) ?? []), { kind: "existing", index: r.index! }]);
    if (r.edit.action === "insert_after") {
      const entries = inserted.get(r.anchor!) ?? [];
      const entry = entries.find((candidate) => candidate.kind === "new" && candidate.edit === r.order);
      if (entry !== undefined) after.set(r.anchor!, [...(after.get(r.anchor!) ?? []), entry]);
    }
  }
  const order: Entry[] = [];
  const emitAfter = (anchor: number) => {
    for (const entry of after.get(anchor) ?? []) {
      order.push(entry);
      if (entry.kind === "existing") emitAfter(entry.index);
    }
  };
  emitAfter(-1);
  slides.forEach((_, index) => {
    if (deleted.has(index) || moved.has(index)) return;
    order.push({ kind: "existing", index });
    emitAfter(index);
  });
  if (order.length === 0) throw new PptxBuildError("the edits would leave the deck with no slides");

  // The presentation part: the new slide list, and nothing left naming a deleted slide.
  const deletedRids = new Set([...deleted].map((index) => slides[index].rid));
  const deletedIds = new Set([...deleted].map((index) => String(slides[index].id)));
  const listXml = order
    .map((entry) => (entry.kind === "existing" ? slides[entry.index].raw : `<${p}sldId id="${entry.id}" r:id="${entry.rid}"/>`))
    .join("");
  let presentation = presentationXml.replace(/(<(?:\w+:)?sldIdLst\b[^>]*>)[\s\S]*?(<\/(?:\w+:)?sldIdLst>)/, `$1${listXml}$2`);
  if (list === null) {
    const close = new RegExp(`</${p}(?:handoutMasterIdLst|notesMasterIdLst|sldMasterIdLst)>`).exec(presentation);
    if (close === null) throw new PptxBuildError("the deck's presentation part lists no slide master");
    const at = close.index + close[0].length;
    presentation = presentation.slice(0, at) + `<${p}sldIdLst>${listXml}</${p}sldIdLst>` + presentation.slice(at);
  }
  if (deleted.size > 0) {
    // Custom shows and sections name slides; a name for nothing is damage to PowerPoint.
    presentation = presentation.replace(/<(?:\w+:)?sld\b[^>]*?\b\w+:id="([^"]*)"[^>]*\/>/g, (whole, rid: string) => (deletedRids.has(rid) ? "" : whole));
    presentation = presentation.replace(/<(\w+:)?sldId\b[^>]*?\bid="(\d+)"[^>]*\/>/g, (whole, prefix: string | undefined, id: string) =>
      prefix !== undefined && prefix !== p && deletedIds.has(id) ? "" : whole,
    );
  }
  if (addedRels.length > 0) presentation = ensureRelationshipNamespace(presentation);
  out.set(template.presentationPart, Buffer.from(presentation, "utf8"));

  // Its relationships.
  const relsXml = decode(parts, presentationRelsPart) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_REL_PACKAGE}"></Relationships>`;
  const kept: string[] = [];
  scanRawRelationships(relsXml, (raw) => {
    const id = /\bId="([^"]*)"/.exec(raw)?.[1] ?? "";
    if (deletedRids.has(id)) return;
    const target = repointed.get(id);
    kept.push(target === undefined ? raw : raw.replace(/\bTarget="[^"]*"/, `Target="${relativeTarget(template.presentationPart, target)}"`));
  });
  const head = relsXml.slice(0, relsXml.indexOf("<Relationships"));
  const open = /<Relationships\b[^>]*>/.exec(relsXml)?.[0] ?? `<Relationships xmlns="${NS_REL_PACKAGE}">`;
  out.set(presentationRelsPart, Buffer.from(`${head}${open}${kept.join("")}${addedRels.join("")}</Relationships>`, "utf8"));

  // What the edits stopped reaching goes; what the deck already carried unreached stays.
  const before = reachable(parts);
  const now = reachable(out);
  const removed = new Set<string>();
  for (const part of [...out.keys()]) {
    if (part === CONTENT_TYPES || part.endsWith(".rels") || now.has(part) || !before.has(part)) continue;
    out.delete(part);
    removed.add(part);
  }
  for (const part of [...out.keys()]) {
    if (!part.endsWith(".rels") || part === ROOT_RELS) continue;
    if (removed.has(part.replace(/_rels\/([^/]+)\.rels$/, "$1"))) out.delete(part);
  }

  // Content types.
  let types = decode(parts, CONTENT_TYPES)!;
  types = types.replace(/<(?:\w+:)?Override\b[^>]*?\/>/g, (element) => {
    const part = /\bPartName="([^"]*)"/.exec(element)?.[1]?.replace(/^\//, "");
    return part !== undefined && removed.has(part) ? "" : element;
  });
  const declared = new Set([...types.matchAll(/<(?:\w+:)?Default\b[^>]*\bExtension="([^"]*)"/g)].map((match) => match[1].toLowerCase()));
  const defaultType = (extension: string) => (extension === "xlsx" ? CT_XLSX : IMAGE_CONTENT_TYPES[extension as ImageKind]);
  const additions =
    [...extensions].filter((extension) => !declared.has(extension) && defaultType(extension) !== undefined).map((extension) => `<Default Extension="${extension}" ContentType="${defaultType(extension)}"/>`).join("") +
    overrides.filter(([part]) => out.has(part) && !types.includes(`PartName="/${part}"`)).map(([part, type]) => `<Override PartName="/${part}" ContentType="${type}"/>`).join("");
  const close = types.lastIndexOf("</");
  out.set(CONTENT_TYPES, Buffer.from(types.slice(0, close) + additions + types.slice(close), "utf8"));

  const changed = order.flatMap((entry, position) => {
    if (entry.kind === "new") return [position + 1];
    return touched.has(entry.index) ? [position + 1] : [];
  });
  const partOrder = [CONTENT_TYPES, ...[...parts.keys()].filter((name) => name !== CONTENT_TYPES), ...[...out.keys()].filter((name) => !parts.has(name))];
  const entries = [...new Set(partOrder)].filter((name) => out.has(name)).map((name) => ({ name, data: out.get(name)! }));
  return { bytes: writeZip(entries), changed, report, warnings };
}
