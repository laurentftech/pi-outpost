/**
 * The template a deck is built from when the user named none, as .potx bytes.
 *
 * The parts themselves — Office's own theme, its master and layouts — and why they are
 * generated rather than shipped are in defaultTemplateParts.ts, which has no Node in it
 * so a browser can use them too. This zips them.
 */
import { defaultTemplateParts } from "./defaultTemplateParts.ts";
import { writeZip } from "./zipWriter.ts";

export { DEFAULT_TEMPLATE_NAME } from "./defaultTemplateParts.ts";

/** Built once: the bytes never change, and every caller only reads them. */
let cached: Buffer | undefined;

/**
 * The built-in template, as .potx bytes. Deterministic — `writeZip` stamps every entry
 * with the same timestamp — so the same build always produces the same package.
 */
export function defaultTemplateBytes(): Buffer {
  cached ??= writeZip(defaultTemplateParts().map(({ name, text }) => ({ name, data: Buffer.from(text, "utf8") })));
  return cached;
}
