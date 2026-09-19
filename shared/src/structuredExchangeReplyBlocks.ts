/**
 * Structured-exchange documents written straight into an assistant reply.
 *
 * Some models answer a request for a diagram by writing the document as a
 * ```` ```json ```` block instead of calling `present_structure`. The browser draws
 * such a block, and the server says whether it conforms to the project's profile.
 * Both have to agree on what a block is and on which block a statement is about,
 * so both go through here.
 *
 * Only a fenced block whose info string is `json`, and whose content declares the
 * contract's schema, is one of these. Nothing is inferred from prose.
 */
import { declaredStructuredExchangeSchema } from "./structuredExchangeDocument.ts";

const OPENING = /^( {0,3}|\t?)(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;

/**
 * The content of every ```` ```json ```` block in `markdown` that declares a
 * structured-exchange schema, in order.
 *
 * An unterminated block — a reply still streaming — is not returned: it is not a
 * document yet. The fence's indentation is removed from the content, as a Markdown
 * renderer removes it, so the text here is the text the reader's renderer holds.
 */
export function structuredExchangeBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const opening = OPENING.exec(lines[i]);
    if (!opening) continue;
    const [, indent, fence, info] = opening;
    const closing = new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`);
    const body: string[] = [];
    let closed = false;
    for (i++; i < lines.length; i++) {
      if (closing.test(lines[i])) {
        closed = true;
        break;
      }
      body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i].trimStart());
    }
    if (!closed || info.toLowerCase() !== "json") continue;
    const content = body.join("\n");
    if (declaredStructuredExchangeSchema(content) !== undefined) blocks.push(content);
  }
  return blocks;
}

/**
 * The key a block's profile statement travels under.
 *
 * Its content, hashed: an assistant reply carries no id, and a block's position
 * shifts with compaction and forks. Two identical blocks share one statement, which
 * is right — the statement depends on the document and the registry alone. Line
 * endings and trailing whitespace are normalised, since a renderer and a raw reader
 * of the same reply do not agree on them.
 */
export function replyBlockKey(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  // FNV-1a, 32-bit: synchronous in the browser and on the server, and collisions
  // between two structured documents in one conversation are not a practical concern.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sx-${(hash >>> 0).toString(16).padStart(8, "0")}-${normalized.length.toString(36)}`;
}
