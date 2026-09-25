/**
 * Package-level checks shared by the tests that write Office files.
 */
import assert from "node:assert/strict";

const text = (parts: Map<string, Buffer>, name: string) => parts.get(name)?.toString("utf8") ?? "";

/**
 * The package-level promises a reader like PowerPoint enforces: every relationship
 * resolves to a part that exists, every part has a content type, and no part or
 * extension is declared twice — part names compare without case, and a duplicate is a
 * package PowerPoint only opens after offering to repair it.
 */
export function assertIntact(parts: Map<string, Buffer>): void {
  const types = text(parts, "[Content_Types].xml");
  for (const declared of [/PartName="([^"]+)"/g, /Extension="([^"]+)"/g]) {
    const names = [...types.matchAll(declared)].map((match) => match[1].toLowerCase());
    assert.deepEqual(names.filter((name, index) => names.indexOf(name) !== index), [], "declared twice in [Content_Types].xml");
  }
  const overrides = new Set([...types.matchAll(/PartName="\/([^"]+)"/g)].map((match) => match[1]));
  const defaults = new Set([...types.matchAll(/Extension="([^"]+)"/g)].map((match) => match[1].toLowerCase()));
  for (const name of parts.keys()) {
    if (name === "[Content_Types].xml") continue;
    assert.ok(overrides.has(name) || defaults.has(name.split(".").pop()!.toLowerCase()), `no content type for ${name}`);
  }
  for (const override of overrides) assert.ok(parts.has(override), `content type for a missing part: ${override}`);
  for (const [name, data] of parts) {
    if (!name.endsWith(".rels")) continue;
    // `_rels/.rels` belongs to the package root; `dir/_rels/part.rels` to `dir/part`.
    const owner = name === "_rels/.rels" ? "" : name.replace(/_rels\/([^/]+)\.rels$/, "$1");
    const base = owner.includes("/") ? owner.slice(0, owner.lastIndexOf("/")) : "";
    for (const match of data.toString("utf8").matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*\/>/g)) {
      if (/TargetMode="External"/.test(match[0])) continue;
      const segments: string[] = [];
      for (const segment of `${base}/${match[1]}`.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") segments.pop();
        else segments.push(segment);
      }
      assert.ok(parts.has(segments.join("/")), `${name} points at missing ${segments.join("/")}`);
    }
  }
}
