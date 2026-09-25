/**
 * The two pieces of OOXML packaging every Office reader here needs: the
 * relationship table, and the part name a relationship target denotes.
 *
 * Shared rather than copied. The spreadsheet reader owned this alone until the
 * presentation reader needed the same indirection — `<p:sldId r:id="rId2">` says
 * no more about which file holds the slide than `<sheet r:id="rId3">` says about
 * the sheet. Only the base part differs (`xl/` against `ppt/`), so that is the
 * parameter.
 *
 * SECURITY: a target is a name inside the package, never a filesystem path. It is
 * normalised here — `..` popped, `.` dropped — so a caller can compare the result
 * against the prefix it will accept. Nothing in this module touches the disk.
 */
import { scanXml } from "./xml.ts";

/**
 * A relationship target as a package part name. Targets are relative to the part
 * that declares them, so a base is required; a target starting with `/` is
 * absolute within the package and ignores it. This is name arithmetic, not path
 * resolution — `..` walking above the package root simply runs out of segments.
 */
export function resolvePart(target: string, base: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : `${base}/${target}`;
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

/**
 * Relationship id → part name, from a `_rels/*.rels` part.
 *
 * The indirection matters: assuming `slideN.xml` or `sheetN.xml` matches the Nth
 * element is wrong on any package whose parts have been reordered or deleted. It
 * is the kind of assumption that holds on every fixture one would write by hand.
 */
export function parseRelationships(xml: string, base: string): Map<string, string> {
  const targets = new Map<string, string>();
  scanXml(xml, (event) => {
    if (event.kind !== "open") return;
    if (event.name !== "Relationship" && !event.name.endsWith(":Relationship")) return;
    const id = event.attributes.Id;
    const target = event.attributes.Target;
    if (id !== undefined && target !== undefined) targets.set(id, resolvePart(target, base));
  });
  return targets;
}

/* ── Package parts and relationships, shared by the Office writers ──────────── */

export interface Relationship {
  id: string;
  type: string;
  /** Part name inside the package, or the raw target when external. */
  target: string;
  external: boolean;
}

export function decode(parts: Map<string, Buffer>, name: string): string | undefined {
  return parts.get(name)?.toString("utf8");
}

export function relsPartOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return slash === -1 ? `_rels/${part}.rels` : `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}

export function directoryOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return slash === -1 ? "" : part.slice(0, slash);
}

export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

export function parseRelationshipList(xml: string | undefined, sourcePart: string): Relationship[] {
  if (xml === undefined) return [];
  const base = directoryOf(sourcePart);
  const list: Relationship[] = [];
  scanXml(xml, (event) => {
    if (event.kind !== "open" || localName(event.name) !== "Relationship") return;
    const { Id: id, Type: type, Target: target, TargetMode: mode } = event.attributes;
    if (id === undefined || type === undefined || target === undefined) return;
    const external = mode === "External";
    list.push({ id, type, target: external ? target : resolvePart(target, base), external });
  });
  return list;
}

/** Attributes of an `r:id`-style attribute, whatever prefix the writer bound. */
export function relationshipIdOf(attributes: Record<string, string>): string | undefined {
  if (attributes["r:id"] !== undefined) return attributes["r:id"];
  for (const [name, value] of Object.entries(attributes)) {
    if (name !== "id" && name.endsWith(":id")) return value;
  }
  return undefined;
}


/** The content type the package declares for a part: its override, else its extension's default. */
export function contentTypeOf(contentTypes: string, part: string): string | undefined {
  let override: string | undefined;
  const defaults = new Map<string, string>();
  scanXml(contentTypes, (event) => {
    if (event.kind !== "open") return;
    const local = localName(event.name);
    if (local === "Override" && event.attributes.PartName?.replace(/^\//, "") === part) override = event.attributes.ContentType;
    if (local === "Default" && event.attributes.Extension !== undefined) {
      defaults.set(event.attributes.Extension.toLowerCase(), event.attributes.ContentType);
    }
  });
  return override ?? defaults.get(part.split(".").pop()!.toLowerCase());
}


/** A relationship target from one part to another, relative to the first one's folder. */
export function relativeTarget(from: string, to: string): string {
  const fromDir = directoryOf(from).split("/").filter(Boolean);
  const toParts = to.split("/");
  let common = 0;
  while (common < fromDir.length && common < toParts.length - 1 && fromDir[common] === toParts[common]) common++;
  return [...Array(fromDir.length - common).fill(".."), ...toParts.slice(common)].join("/");
}


export function scanRawRelationships(xml: string, visit: (raw: string, type: string) => void): void {
  for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?Relationship>)/g)) {
    const type = /\bType="([^"]*)"/.exec(match[0])?.[1] ?? "";
    visit(match[0], type);
  }
}
