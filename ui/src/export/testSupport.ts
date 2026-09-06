/**
 * Opening an exported package, for tests.
 *
 * A `.docx` is a zip of XML parts, and every meaningful claim about one — that a
 * heading really is a heading, that a relationship resolves, that a picture points
 * at the part it says it does — is a claim about those bytes. Asserting on what we
 * handed the writer would only prove that we called it.
 *
 * Imported by tests alone; no application code reaches this file, so it never
 * travels in the export chunk.
 */
import JSZip from "jszip";

export async function openDocx(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

/** The text of a part, or a failure naming the part that was missing. */
export async function partText(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (file === null) {
    throw new Error(`package has no part ${name}; it has: ${Object.keys(zip.files).join(", ")}`);
  }
  return file.async("string");
}

/** The main document part — where every structural assertion is made. */
export async function documentXml(blob: Blob): Promise<string> {
  return partText(await openDocx(blob), "word/document.xml");
}

/**
 * The readable text of the document, with the markup taken away.
 *
 * `<w:t>` holds every piece of text a reader sees. Joining them is how a test asks
 * "does a `#` survive into the export?" without asserting on the shape of the XML
 * around it.
 */
export function visibleText(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeEntities(match[1]))
    .join("");
}

/**
 * Text as a reader sees it, not as the package stores it.
 *
 * `>` inside a document is written `&gt;`, which is correct and is precisely what
 * keeps a document's own text from becoming markup. A test asking whether the
 * reader sees `A-->B` should not have to know that.
 */
function decodeEntities(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Every `<w:p>` element, so a test can ask what a particular paragraph carries. */
export function paragraphs(xml: string): string[] {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
}

/**
 * Everything wrong with a package's own bookkeeping.
 *
 * Word does not say "relationship rId7 is missing"; it says the document is
 * damaged and offers to repair it, which is the same message it gives for a
 * truncated download. This walks the package the way Word opens it — every part
 * declared, every relationship resolving — so a defect names itself here instead
 * of turning into a repair prompt on a reader's machine.
 *
 * Returns the problems rather than throwing, so a test can assert on an empty list
 * and print every fault at once when it is not.
 */
export async function packageFaults(blob: Blob): Promise<string[]> {
  const zip = await openDocx(blob);
  const faults: string[] = [];
  const names = new Set(Object.keys(zip.files));

  // Attribute order is a writer's choice and carries no meaning, so each element is
  // matched first and its attributes read from it.
  const types = await partText(zip, "[Content_Types].xml");
  const defaults = new Set(
    [...types.matchAll(/<Default\b[^>]*>/g)]
      .map((match) => /Extension="([^"]+)"/.exec(match[0])?.[1]?.toLowerCase())
      .filter((extension): extension is string => extension !== undefined),
  );
  const overrides = new Set(
    [...types.matchAll(/<Override\b[^>]*>/g)]
      .map((match) => /PartName="\/([^"]+)"/.exec(match[0])?.[1])
      .filter((part): part is string => part !== undefined),
  );

  for (const name of names) {
    if (name.endsWith("/") || name === "[Content_Types].xml") continue;
    const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (!overrides.has(name) && !defaults.has(extension)) {
      faults.push(`part ${name} has no declared content type`);
    }
  }

  // Every relationships part, against the parts it points at.
  for (const name of names) {
    if (!name.endsWith(".rels")) continue;
    // A relationship target is relative to the folder that *contains* the `_rels`
    // folder: root for `_rels/.rels`, `word/` for `word/_rels/document.xml.rels`.
    const base = name.slice(0, name.indexOf("_rels/"));
    const xml = await partText(zip, name);
    for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const element = match[0];
      // External targets are URLs and are not parts; they are checked by their own
      // test, not here.
      if (/TargetMode="External"/.test(element)) continue;
      const target = /Target="([^"]+)"/.exec(element)?.[1];
      if (target === undefined) continue;
      const resolved = target.startsWith("/") ? target.slice(1) : normalise(base + target);
      if (!names.has(resolved)) {
        faults.push(`${name} points at ${resolved}, which the package does not contain`);
      }
    }
  }
  return faults;
}

/** `word/media/../media/x.png` and the like, as the flat name the zip uses. */
function normalise(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}
