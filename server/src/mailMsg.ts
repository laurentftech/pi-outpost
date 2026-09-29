/**
 * Reading an Outlook `.msg`: a compound file holding a message as properties.
 *
 * Nothing about this format resembles MIME. A `.msg` is an OLE compound file — the
 * same container an encrypted OOXML package uses — whose root storage holds one
 * stream per message property (`__substg1.0_0037001F` is the subject) and one
 * sub-storage per attachment (`__attach_version1.0_#00000000`). There is no
 * multipart tree, no transfer encoding and no boundary: the reader walks a
 * directory and looks properties up by tag.
 *
 * SECURITY: the input is attacker-controlled and the container is a structure of
 * offsets into itself. Every sector chain is followed with a visited set and a
 * length ceiling, so a file whose FAT points in a circle terminates instead of
 * hanging, and a directory that claims a stream longer than the file yields what is
 * actually there. The reader never allocates on a claimed length alone.
 */
import {
  decodeText,
  MailError,
  parseAddresses,
  splitHeaders,
  type MailAddress,
  type MailAttachment,
  type MailMessage,
  type ParseState,
} from "./mail.ts";
import { reduceHtmlToMarkdown } from "./mailHtml.ts";

/* ── The compound file ──────────────────────────────────────────────────────── */

const SECTOR_HEADER = 512;
const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
/** A directory entry is 128 bytes, whatever the sector size. */
const DIRECTORY_ENTRY_BYTES = 128;
const ENTRY_TYPE_STORAGE = 1;
const ENTRY_TYPE_STREAM = 2;
const ENTRY_TYPE_ROOT = 5;
const NO_ENTRY = 0xffffffff;
/** A chain longer than this is a loop the visited set has not caught yet. */
const MAX_CHAIN_SECTORS = 1 << 22;
/** Directories deeper or wider than this are not Outlook's. */
const MAX_DIRECTORY_ENTRIES = 1 << 16;

interface DirectoryEntry {
  name: string;
  type: number;
  /** First sector of the stream, or of the mini-FAT chain for a small stream. */
  start: number;
  size: number;
  left: number;
  right: number;
  child: number;
}

interface CompoundFile {
  entries: DirectoryEntry[];
  read(entry: DirectoryEntry): Buffer;
}

function readUInt32(bytes: Buffer, at: number): number {
  return at + 4 <= bytes.length ? bytes.readUInt32LE(at) : END_OF_CHAIN;
}

/**
 * Follow a sector chain, stopping at the end marker, at a sector that has already
 * been seen, or at the ceiling.
 */
function chainOf(fat: number[], start: number, state: ParseState): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let sector = start;
  while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && sector < fat.length) {
    if (seen.has(sector)) break; // a FAT that points in a circle
    if (chain.length >= MAX_CHAIN_SECTORS) break;
    if (chain.length % 4096 === 0) state.deadline();
    seen.add(sector);
    chain.push(sector);
    sector = fat[sector];
  }
  return chain;
}

/**
 * Parse the container: its FAT, its mini-FAT, and its directory.
 *
 * Only what a `.msg` needs. Version 3 (512-byte sectors) and version 4 (4096) are
 * both read, because Outlook writes version 3 and a few exporters write version 4.
 */
function openCompoundFile(bytes: Buffer, state: ParseState): CompoundFile {
  if (bytes.length < SECTOR_HEADER + 4) throw new MailError("unreadable", "this file is too short to be an Outlook message");

  const sectorShift = bytes.readUInt16LE(30);
  const sectorSize = 1 << sectorShift;
  if (sectorSize !== 512 && sectorSize !== 4096) {
    throw new MailError("unreadable", `this compound file declares a ${sectorSize}-byte sector size, which is not one this reader knows`);
  }
  const miniSectorSize = 1 << bytes.readUInt16LE(32);
  const directoryStart = bytes.readUInt32LE(48);
  const miniFatStart = bytes.readUInt32LE(60);
  const difatStart = bytes.readUInt32LE(68);
  const difatCount = bytes.readUInt32LE(72);

  const sectorAt = (sector: number): Buffer => {
    const offset = SECTOR_HEADER + sector * sectorSize;
    if (offset < 0 || offset >= bytes.length) return Buffer.alloc(0);
    return bytes.subarray(offset, Math.min(offset + sectorSize, bytes.length));
  };

  // The FAT's own sectors are listed in the header (first 109) and then in the
  // DIFAT chain.
  const fatSectors: number[] = [];
  for (let index = 0; index < 109; index++) {
    const sector = bytes.readUInt32LE(76 + index * 4);
    if (sector === FREE_SECTOR || sector === END_OF_CHAIN) break;
    fatSectors.push(sector);
  }
  let difat = difatStart;
  const seenDifat = new Set<number>();
  const perDifat = sectorSize / 4 - 1;
  for (let index = 0; index < difatCount && difat !== END_OF_CHAIN && difat !== FREE_SECTOR; index++) {
    if (seenDifat.has(difat)) break;
    seenDifat.add(difat);
    state.deadline();
    const sector = sectorAt(difat);
    for (let slot = 0; slot < perDifat; slot++) {
      const value = readUInt32(sector, slot * 4);
      if (value === FREE_SECTOR || value === END_OF_CHAIN) continue;
      fatSectors.push(value);
    }
    difat = readUInt32(sector, perDifat * 4);
  }

  const fat: number[] = [];
  for (const sector of fatSectors) {
    const chunk = sectorAt(sector);
    for (let at = 0; at + 4 <= chunk.length; at += 4) fat.push(chunk.readUInt32LE(at));
  }
  if (fat.length === 0) throw new MailError("unreadable", "this compound file has no allocation table");

  const readChain = (start: number, size: number): Buffer => {
    const pieces = chainOf(fat, start, state).map(sectorAt);
    const joined = Buffer.concat(pieces);
    // `size` is what the directory claims; the file is what it actually holds.
    return joined.subarray(0, Math.min(size, joined.length));
  };

  const miniFat: number[] = [];
  if (miniFatStart !== END_OF_CHAIN && miniFatStart !== FREE_SECTOR) {
    for (const sector of chainOf(fat, miniFatStart, state)) {
      const chunk = sectorAt(sector);
      for (let at = 0; at + 4 <= chunk.length; at += 4) miniFat.push(chunk.readUInt32LE(at));
    }
  }

  const directoryBytes = readChain(directoryStart, Number.MAX_SAFE_INTEGER);
  const entries: DirectoryEntry[] = [];
  for (let at = 0; at + DIRECTORY_ENTRY_BYTES <= directoryBytes.length && entries.length < MAX_DIRECTORY_ENTRIES; at += DIRECTORY_ENTRY_BYTES) {
    const record = directoryBytes.subarray(at, at + DIRECTORY_ENTRY_BYTES);
    const nameLength = Math.max(0, Math.min(64, record.readUInt16LE(64)) - 2);
    entries.push({
      name: record.subarray(0, nameLength).toString("utf16le"),
      type: record[66],
      left: record.readUInt32LE(68),
      right: record.readUInt32LE(72),
      child: record.readUInt32LE(76),
      start: record.readUInt32LE(116),
      // A stream's size is 64-bit; the high half is meaningless for a message.
      size: record.readUInt32LE(120),
    });
  }
  if (entries.length === 0) throw new MailError("unreadable", "this compound file has no directory");

  // Small streams live in the mini-FAT, inside the root entry's own stream.
  const root = entries[0];
  const miniStream = root.type === ENTRY_TYPE_ROOT ? readChain(root.start, root.size) : Buffer.alloc(0);
  const miniCutoff = bytes.readUInt32LE(56);

  const read = (entry: DirectoryEntry): Buffer => {
    if (entry.size === 0) return Buffer.alloc(0);
    if (entry.size < miniCutoff && entry.type !== ENTRY_TYPE_ROOT) {
      const pieces: Buffer[] = [];
      for (const sector of chainOf(miniFat, entry.start, state)) {
        const offset = sector * miniSectorSize;
        if (offset >= miniStream.length) continue;
        pieces.push(miniStream.subarray(offset, Math.min(offset + miniSectorSize, miniStream.length)));
      }
      return Buffer.concat(pieces).subarray(0, entry.size);
    }
    return readChain(entry.start, entry.size);
  };

  return { entries, read };
}

/**
 * The entries directly inside a storage, walked through its red-black tree.
 *
 * The tree's ordering is irrelevant here — every child is wanted — so this is a
 * traversal with a visited set, which also contains a directory whose sibling
 * pointers form a loop.
 */
function childrenOf(file: CompoundFile, storage: DirectoryEntry, state: ParseState): DirectoryEntry[] {
  const out: DirectoryEntry[] = [];
  if (storage.child === NO_ENTRY) return out;
  const pending = [storage.child];
  const seen = new Set<number>();
  while (pending.length > 0) {
    state.deadline();
    const index = pending.pop();
    if (index === undefined || index === NO_ENTRY || seen.has(index)) continue;
    seen.add(index);
    const entry = file.entries[index];
    if (entry === undefined) continue;
    out.push(entry);
    pending.push(entry.left, entry.right);
  }
  return out;
}

/* ── Properties ─────────────────────────────────────────────────────────────── */

/**
 * Property tags this reader looks up, by the MAPI names they are known under.
 *
 * A property stream is named `__substg1.0_` followed by the four-digit tag and the
 * four-digit type, so the same property appears as `…001F` (Unicode string) or
 * `…001E` (a string in the message's code page) depending on the client that wrote
 * it. `propertyText` accepts either.
 */
const TAG = {
  subject: "0037",
  body: "1000",
  bodyHtml: "1013",
  bodyRtfCompressed: "1009",
  senderName: "0C1A",
  senderEmail: "0C1F",
  sentRepresentingName: "0042",
  sentRepresentingEmail: "0065",
  displayTo: "0E04",
  displayCc: "0E03",
  displayBcc: "0E02",
  transportHeaders: "007D",
  internetCodepage: "3FDE",
  messageCodepage: "3FFD",
  attachFilename: "3704",
  attachLongFilename: "3707",
  attachExtension: "3703",
  attachMimeTag: "370E",
  attachData: "3701",
  attachContentId: "3712",
  attachFlags: "3714",
  attachMethod: "3705",
  recipientType: "0C15",
  emailAddress: "3003",
  displayName: "3001",
  smtpAddress: "39FE",
} as const;

/** Windows code page identifiers, in the spelling `decodeText` understands. */
const CODEPAGES = new Map<number, string>([
  [65001, "utf-8"],
  [1200, "utf-16le"],
  [1252, "windows-1252"],
  [1250, "windows-1250"],
  [1251, "windows-1251"],
  [1253, "windows-1253"],
  [1254, "windows-1254"],
  [1255, "windows-1255"],
  [1256, "windows-1256"],
  [1257, "windows-1257"],
  [1258, "windows-1258"],
  [28591, "iso-8859-1"],
  [28592, "iso-8859-2"],
  [28605, "iso-8859-15"],
  [932, "shift_jis"],
  [936, "gbk"],
  [949, "euc-kr"],
  [950, "big5"],
]);

/** A storage's property streams, indexed by the tag+type suffix of their names. */
type Properties = Map<string, Buffer>;

function propertiesOf(file: CompoundFile, storage: DirectoryEntry, state: ParseState): { properties: Properties; storages: DirectoryEntry[] } {
  const properties: Properties = new Map();
  const storages: DirectoryEntry[] = [];
  for (const entry of childrenOf(file, storage, state)) {
    if (entry.type === ENTRY_TYPE_STORAGE) {
      storages.push(entry);
      continue;
    }
    if (entry.type !== ENTRY_TYPE_STREAM) continue;
    const match = /^__substg1\.0_([0-9A-Fa-f]{8})/.exec(entry.name);
    if (match === null) continue;
    properties.set(match[1].toUpperCase(), file.read(entry));
  }
  return { properties, storages };
}

/**
 * A string property, whichever of the two spellings the writer used.
 *
 * `001F` is UTF-16, which needs no code page. `001E` is 8-bit and is decoded with
 * the message's own code page — the property that names it is itself a number, so
 * it is read first. Getting this wrong is exactly how an accented French subject
 * turns into mojibake, which is why the code page is threaded through rather than
 * assumed.
 */
function propertyText(properties: Properties, tag: string, codepage: string | undefined): { text: string; note?: string } | undefined {
  const unicode = properties.get(`${tag}001F`);
  if (unicode !== undefined) return { text: unicode.toString("utf16le").replace(/\0+$/, "") };
  const ansi = properties.get(`${tag}001E`);
  if (ansi !== undefined) {
    const decoded = decodeText(ansi, codepage ?? "windows-1252");
    return { text: decoded.text.replace(/\0+$/, ""), ...(decoded.note === undefined ? {} : { note: decoded.note }) };
  }
  return undefined;
}

function propertyNumber(properties: Properties, tag: string): number | undefined {
  const bytes = properties.get(`${tag}0003`);
  if (bytes === undefined || bytes.length < 4) return undefined;
  return bytes.readUInt32LE(0);
}

function propertyBytes(properties: Properties, tag: string): Buffer | undefined {
  return properties.get(`${tag}0102`);
}

/* ── Compressed rich text ───────────────────────────────────────────────────── */

/**
 * The dictionary every LZFu stream starts from: RTF a mail body is bound to use.
 *
 * Outlook stores an HTML body as RTF with the HTML encapsulated inside it, and
 * compresses that with LZFu — a byte-oriented LZ77 whose window is preloaded with
 * this string. Without the preload the first few hundred bytes of every body
 * decompress to nothing.
 */
const LZFU_DICTIONARY =
  "{\\rtf1\\ansi\\mac\\pca\\pch\\pcbi\\pcgreek\\pctt\\deff0{\\fonttbl{\\f0\\fnil \\froman \\fswiss " +
  "\\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0" +
  "\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

const LZFU_COMPRESSED = 0x75465a4c; // "LZFu"
const LZFU_UNCOMPRESSED = 0x414c454d; // "MELA"

/**
 * Decompress a `PR_RTF_COMPRESSED` stream.
 *
 * The header gives the compressed and uncompressed sizes and a magic number saying
 * whether the body is compressed at all. The window is 4096 bytes, preloaded with
 * the dictionary above and written round-robin; a reference is a 12-bit offset and a
 * 4-bit length, and an offset pointing at the write cursor marks the end.
 *
 * Returns `null` rather than throwing: a body that will not decompress is one of
 * several things a message may hold, and the caller has other forms to try.
 */
export function decompressRtf(stream: Buffer): Buffer | null {
  if (stream.length < 16) return null;
  const compressedSize = stream.readUInt32LE(0);
  const uncompressedSize = stream.readUInt32LE(4);
  const magic = stream.readUInt32LE(8);

  if (magic === LZFU_UNCOMPRESSED) return stream.subarray(16, Math.min(stream.length, 16 + uncompressedSize));
  if (magic !== LZFU_COMPRESSED) return null;
  // A declared size wildly past the stream is a lie; cap the output at something a
  // body could be rather than allocating on the claim.
  const ceiling = Math.min(uncompressedSize, 64 * 1024 * 1024);
  if (ceiling <= 0) return null;

  const window = Buffer.alloc(4096);
  const dictionary = Buffer.from(LZFU_DICTIONARY, "latin1");
  dictionary.copy(window, 0, 0, Math.min(dictionary.length, window.length));
  let writeAt = dictionary.length % window.length;

  const out = Buffer.alloc(ceiling);
  let length = 0;
  // The compressed data runs from after the header to the declared compressed size,
  // which counts everything after its own field.
  const end = Math.min(stream.length, 4 + compressedSize);
  let at = 16;

  while (at < end && length < ceiling) {
    const control = stream[at++];
    for (let bit = 0; bit < 8 && at < end && length < ceiling; bit++) {
      if ((control & (1 << bit)) === 0) {
        const byte = stream[at++];
        out[length++] = byte;
        window[writeAt] = byte;
        writeAt = (writeAt + 1) % window.length;
        continue;
      }
      if (at + 1 >= end + 1 || at + 1 > stream.length - 1) return out.subarray(0, length);
      const reference = (stream[at] << 8) | stream[at + 1];
      at += 2;
      const offset = reference >> 4;
      const runLength = (reference & 0x0f) + 2;
      if (offset === writeAt) return out.subarray(0, length); // the end marker
      for (let index = 0; index < runLength && length < ceiling; index++) {
        const byte = window[(offset + index) % window.length];
        out[length++] = byte;
        window[writeAt] = byte;
        writeAt = (writeAt + 1) % window.length;
      }
    }
  }
  return out.subarray(0, length);
}

/**
 * The HTML a body's RTF encapsulates, or `null` when the RTF is genuine rich text.
 *
 * Outlook wraps an HTML body in RTF rather than storing it as HTML: the markup sits
 * in `\*\htmltag` destinations, and the RTF also carries a plain-text rendering in
 * `\htmlrtf … \htmlrtf0` runs that must *not* be taken — including it duplicates
 * every sentence. `\*\mhtmltag` holds rewritten URLs and is skipped for the same
 * reason.
 */
export function htmlFromEncapsulatedRtf(rtf: string): string | null {
  if (!/\\from(html|text)|\\\*\\htmltag/.test(rtf)) return null;
  let out = "";
  let at = 0;
  /** Inside `\htmlrtf`: the RTF rendering, which the HTML already says. */
  let suppressed = 0;
  /** Depth of a group being skipped whole, such as `\*\mhtmltag`. */
  let skipUntilDepth: number | null = null;
  let depth = 0;

  while (at < rtf.length) {
    const char = rtf[at];

    if (char === "{") {
      depth++;
      at++;
      // `{\*\mhtmltag…}` and `{\*\…}` destinations that are not htmltag are skipped.
      const ahead = rtf.slice(at, at + 12);
      if (skipUntilDepth === null && /^\\\*\\(mhtmltag|htmlbase)/.test(ahead)) skipUntilDepth = depth;
      continue;
    }
    if (char === "}") {
      if (skipUntilDepth !== null && depth <= skipUntilDepth) skipUntilDepth = null;
      depth--;
      at++;
      continue;
    }
    if (char === "\\") {
      const control = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(at));
      if (control === null) {
        // `\*` marks the destination that follows as ignorable. It is a control
        // symbol, not an escaped character — reading it as one put a literal
        // asterisk in front of every tag this function recovered.
        if (rtf[at + 1] === "*") {
          at += 2;
          continue;
        }
        // An escaped character: \{ \} \\ — or \'xx, a byte in the RTF's code page.
        const hex = /^\\'([0-9a-fA-F]{2})/.exec(rtf.slice(at));
        if (hex !== null) {
          if (suppressed === 0 && skipUntilDepth === null) out += String.fromCharCode(Number.parseInt(hex[1], 16));
          at += 4;
          continue;
        }
        if (suppressed === 0 && skipUntilDepth === null && at + 1 < rtf.length) out += rtf[at + 1];
        at += 2;
        continue;
      }
      const word = control[1];
      const parameter = control[2];
      at += control[0].length;
      if (word === "htmlrtf") {
        // `\htmlrtf` opens the suppressed run, `\htmlrtf0` closes it.
        if (parameter === "0") suppressed = Math.max(0, suppressed - 1);
        else suppressed++;
        continue;
      }
      if (word === "par" || word === "line") {
        if (suppressed === 0 && skipUntilDepth === null) out += "\n";
        continue;
      }
      if (word === "tab") {
        if (suppressed === 0 && skipUntilDepth === null) out += "\t";
        continue;
      }
      if (word === "u" && parameter !== undefined) {
        if (suppressed === 0 && skipUntilDepth === null) {
          const code = Number(parameter);
          out += String.fromCharCode(code < 0 ? code + 65536 : code);
        }
        continue;
      }
      // Every other control word is formatting the HTML does not need.
      continue;
    }

    if (char === "\r" || char === "\n") {
      at++;
      continue;
    }
    if (suppressed === 0 && skipUntilDepth === null) out += char;
    at++;
  }

  const html = out.trim();
  return html === "" ? null : html;
}

/** Genuine rich text reduced to the text it renders, best-effort. */
export function textFromRtf(rtf: string): string {
  let out = "";
  let at = 0;
  let skipUntilDepth: number | null = null;
  let depth = 0;
  while (at < rtf.length) {
    const char = rtf[at];
    if (char === "{") {
      depth++;
      at++;
      // Font and colour tables, and `\*\…` destinations, carry no prose.
      if (skipUntilDepth === null && /^\\(\*|fonttbl|colortbl|stylesheet|info|pict)/.test(rtf.slice(at, at + 12))) {
        skipUntilDepth = depth;
      }
      continue;
    }
    if (char === "}") {
      if (skipUntilDepth !== null && depth <= skipUntilDepth) skipUntilDepth = null;
      depth--;
      at++;
      continue;
    }
    const writable = skipUntilDepth === null;
    if (char === "\\") {
      // The ignorable-destination marker, as above: a control symbol, not a letter.
      if (rtf[at + 1] === "*") {
        at += 2;
        continue;
      }
      const hex = /^\\'([0-9a-fA-F]{2})/.exec(rtf.slice(at));
      if (hex !== null) {
        if (writable) out += String.fromCharCode(Number.parseInt(hex[1], 16));
        at += 4;
        continue;
      }
      const control = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(at));
      if (control === null) {
        if (writable && at + 1 < rtf.length) out += rtf[at + 1];
        at += 2;
        continue;
      }
      at += control[0].length;
      if (!writable) continue;
      if (control[1] === "par" || control[1] === "line") out += "\n";
      else if (control[1] === "tab") out += "\t";
      else if (control[1] === "u" && control[2] !== undefined) {
        const code = Number(control[2]);
        out += String.fromCharCode(code < 0 ? code + 65536 : code);
      }
      continue;
    }
    if (char === "\r" || char === "\n") {
      at++;
      continue;
    }
    if (writable) out += char;
    at++;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/* ── Attachments ────────────────────────────────────────────────────────────── */

/** `ATTACH_BY_VALUE`. Anything else has no bytes here to unpack. */
const ATTACH_BY_VALUE = 1;
const ATTACH_EMBEDDED_MESSAGE = 5;
/** `PR_ATTACHMENT_HIDDEN`-adjacent: the flag marking an inline, body-referenced part. */
const ATTACH_RENDERED_IN_BODY = 4;

function attachmentsOf(
  file: CompoundFile,
  storages: DirectoryEntry[],
  codepage: string | undefined,
  state: ParseState,
  notes: string[],
): MailAttachment[] {
  const out: MailAttachment[] = [];
  // `#00000000`, `#00000001`, … — sorted so the identifiers follow the message's
  // own order rather than the directory tree's shape.
  const attachmentStorages = storages
    .filter((entry) => /^__attach_version1\.0_#/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const storage of attachmentStorages) {
    state.deadline();
    const { properties, storages: inner } = propertiesOf(file, storage, state);
    const id = String(out.length + 1);
    const name =
      propertyText(properties, TAG.attachLongFilename, codepage)?.text ??
      propertyText(properties, TAG.attachFilename, codepage)?.text;
    const mimeTag = propertyText(properties, TAG.attachMimeTag, codepage)?.text;
    const contentId = propertyText(properties, TAG.attachContentId, codepage)?.text;
    const flags = propertyNumber(properties, TAG.attachFlags) ?? 0;
    const method = propertyNumber(properties, TAG.attachMethod) ?? ATTACH_BY_VALUE;
    const data = propertyBytes(properties, TAG.attachData);

    const attachment: MailAttachment = {
      id,
      mediaType: (mimeTag ?? "").toLowerCase() || mediaTypeForName(name),
      size: data?.length ?? 0,
      inline: (flags & ATTACH_RENDERED_IN_BODY) !== 0 || (contentId !== undefined && (mimeTag ?? "").startsWith("image/")),
    };
    if (name !== undefined && name !== "") attachment.claimedName = name;
    if (contentId !== undefined && contentId !== "") attachment.contentId = contentId;

    if (method === ATTACH_EMBEDDED_MESSAGE) {
      // An embedded message is a whole compound-file message of its own, held as a
      // sub-storage rather than as bytes. Its subject names it; unpacking it is not
      // offered, because there are no bytes to write — said plainly rather than
      // silently leaving it out of the inventory.
      const embedded = inner.find((entry) => entry.name === "__substg1.0_3701000D");
      if (embedded !== undefined) {
        const { properties: innerProperties } = propertiesOf(file, embedded, state);
        const subject = propertyText(innerProperties, TAG.subject, codepage)?.text;
        if (subject !== undefined) attachment.messageSubject = subject;
      }
      attachment.mediaType = "message/rfc822";
      attachment.unreadable = "it is a message embedded as Outlook properties rather than as a file, so it has no bytes to unpack";
      out.push(attachment);
      continue;
    }

    if (data === undefined) {
      attachment.unreadable = "its content is not stored in this file";
      notes.push(`attachment ${id}${name === undefined ? "" : ` (${name})`} carries no content stream`);
    } else {
      attachment.content = data;
      attachment.size = data.length;
    }
    out.push(attachment);
  }
  return out;
}

/** A media type from a file name, for the attachments Outlook does not label. */
function mediaTypeForName(name: string | undefined): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(name ?? "")?.[1]?.toLowerCase();
  const known: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    txt: "text/plain",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    zip: "application/zip",
    msg: "application/vnd.ms-outlook",
    eml: "message/rfc822",
  };
  return known[extension ?? ""] ?? "application/octet-stream";
}

/* ── The message ────────────────────────────────────────────────────────────── */

/** Recipient types, as `PR_RECIPIENT_TYPE` records them. */
const RECIPIENT_TO = 1;
const RECIPIENT_CC = 2;
const RECIPIENT_BCC = 3;

function recipientsOf(
  file: CompoundFile,
  storages: DirectoryEntry[],
  codepage: string | undefined,
  state: ParseState,
): { to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[] } {
  const to: MailAddress[] = [];
  const cc: MailAddress[] = [];
  const bcc: MailAddress[] = [];
  const recipientStorages = storages
    .filter((entry) => /^__recip_version1\.0_#/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const storage of recipientStorages) {
    state.deadline();
    const { properties } = propertiesOf(file, storage, state);
    const address =
      propertyText(properties, TAG.smtpAddress, codepage)?.text ??
      propertyText(properties, TAG.emailAddress, codepage)?.text ??
      "";
    const name = propertyText(properties, TAG.displayName, codepage)?.text;
    if (address === "" && (name === undefined || name === "")) continue;
    const mailbox: MailAddress = { address: address === "" ? (name ?? "") : address };
    if (name !== undefined && name !== "" && name !== mailbox.address) mailbox.name = name;
    const kind = propertyNumber(properties, TAG.recipientType);
    if (kind === RECIPIENT_CC) cc.push(mailbox);
    else if (kind === RECIPIENT_BCC) bcc.push(mailbox);
    else if (kind === RECIPIENT_TO || kind === undefined) to.push(mailbox);
  }
  return { to, cc, bcc };
}

/**
 * Read an Outlook message.
 *
 * Shares `ParseState` with the MIME reader, so one time budget covers a message
 * whichever form it arrived in, and notes reach the caller the same way.
 */
export function readOutlookMessage(bytes: Buffer, state: ParseState): MailMessage {
  const file = openCompoundFile(bytes, state);
  const root = file.entries[0];
  if (root === undefined || root.type !== ENTRY_TYPE_ROOT) {
    throw new MailError("unreadable", "this compound file has no root storage");
  }
  const { properties, storages } = propertiesOf(file, root, state);
  if (properties.size === 0 && storages.length === 0) {
    throw new MailError("unreadable", "this compound file holds no message properties; it is not an Outlook message");
  }

  const message: MailMessage = { format: "msg", to: [], cc: [], bcc: [], attachments: [], notes: [], signed: false };
  const notes: string[] = [];

  // The code page decides how every 8-bit property reads, so it is read first.
  const codepageId = propertyNumber(properties, TAG.internetCodepage) ?? propertyNumber(properties, TAG.messageCodepage);
  const codepage = codepageId === undefined ? undefined : CODEPAGES.get(codepageId);
  if (codepageId !== undefined && codepage === undefined) {
    notes.push(`this message declares code page ${codepageId}, which is not one this reader knows; its 8-bit properties were read as windows-1252`);
  }

  const take = (tag: string): string | undefined => {
    const value = propertyText(properties, tag, codepage);
    if (value?.note !== undefined && !notes.includes(value.note)) notes.push(value.note);
    return value?.text === "" ? undefined : value?.text;
  };

  const subject = take(TAG.subject);
  if (subject !== undefined) message.subject = subject;

  const senderAddress = take(TAG.senderEmail) ?? take(TAG.sentRepresentingEmail);
  const senderName = take(TAG.senderName) ?? take(TAG.sentRepresentingName);
  if (senderAddress !== undefined || senderName !== undefined) {
    message.from = { address: senderAddress ?? senderName ?? "" };
    if (senderName !== undefined && senderName !== message.from.address) message.from.name = senderName;
  }

  // Recipient storages carry addresses; the display headers carry only names, so
  // they stand in when a message was saved without its recipient table.
  const recipients = recipientsOf(file, storages, codepage, state);
  message.to = recipients.to.length > 0 ? recipients.to : parseAddresses(take(TAG.displayTo));
  message.cc = recipients.cc.length > 0 ? recipients.cc : parseAddresses(take(TAG.displayCc));
  message.bcc = recipients.bcc.length > 0 ? recipients.bcc : parseAddresses(take(TAG.displayBcc));

  // The transport headers, when the message kept them, are the only place a `.msg`
  // records when it was sent in the form a reader expects.
  const transport = take(TAG.transportHeaders);
  if (transport !== undefined) {
    const { headers } = splitHeaders(Buffer.from(transport, "utf8"));
    const date = headers.get("date")?.[0];
    if (date !== undefined) {
      const parsed = new Date(date);
      message.date = Number.isNaN(parsed.getTime()) ? date : parsed.toISOString();
    }
    if (message.from === undefined) {
      const from = parseAddresses(headers.get("from")?.[0]);
      if (from.length > 0) message.from = from[0];
    }
    if (headers.has("dkim-signature") || headers.has("content-type")) {
      const contentType = headers.get("content-type")?.[0] ?? "";
      if (/pkcs7|pgp-signature/i.test(contentType)) {
        message.signed = true;
        notes.push("this message carries a signature, which was not verified");
      }
    }
  }

  const formsHeld: string[] = [];
  const html = take(TAG.bodyHtml) ?? htmlFromBytesProperty(properties, codepage, notes);
  const plain = take(TAG.body);
  const compressedRtf = propertyBytes(properties, TAG.bodyRtfCompressed);
  if (plain !== undefined) formsHeld.push("plain text");
  if (html !== undefined) formsHeld.push("HTML");
  if (compressedRtf !== undefined) formsHeld.push("compressed rich text");

  if (plain !== undefined && plain.trim() !== "") {
    message.body = { markdown: plain.replace(/\r\n/g, "\n").trim(), form: "plain text" };
  } else if (html !== undefined && html.trim() !== "") {
    message.body = { markdown: reduceHtmlToMarkdown(html, { deadline: state.deadline }), form: "HTML" };
  } else if (compressedRtf !== undefined) {
    const decompressed = decompressRtf(compressedRtf);
    if (decompressed === null) {
      message.bodyUnreadable = { reason: "its compressed rich-text body could not be decompressed", formsHeld };
    } else {
      const rtf = decodeText(decompressed, codepage ?? "windows-1252").text;
      const encapsulated = htmlFromEncapsulatedRtf(rtf);
      if (encapsulated !== null) {
        message.body = {
          markdown: reduceHtmlToMarkdown(encapsulated, { deadline: state.deadline }),
          form: "HTML recovered from rich text",
        };
      } else {
        message.body = { markdown: textFromRtf(rtf), form: "rich text" };
      }
    }
  } else {
    message.bodyUnreadable = {
      reason: formsHeld.length === 0 ? "this message carries no body property" : "no body property could be read",
      formsHeld,
    };
  }

  // A body that decoded to nothing is not a body: say so rather than return "".
  if (message.body !== undefined && message.body.markdown.trim() === "") {
    delete message.body;
    message.bodyUnreadable = { reason: "its body property decoded to no text", formsHeld };
  }

  message.attachments = attachmentsOf(file, storages, codepage, state, notes);

  for (const note of [...notes, ...state.notes]) {
    if (!message.notes.includes(note)) message.notes.push(note);
  }
  return message;
}

/**
 * An HTML body stored as bytes rather than as a string.
 *
 * `PR_HTML` is a binary property in most messages — the HTML's own `<meta charset>`
 * is what a client uses — so it arrives as `10130102` rather than as a string tag.
 */
function htmlFromBytesProperty(properties: Properties, codepage: string | undefined, notes: string[]): string | undefined {
  const bytes = propertyBytes(properties, TAG.bodyHtml);
  if (bytes === undefined || bytes.length === 0) return undefined;
  // The document's own declaration wins over the message's code page: the two
  // disagree often, and the bytes were written to match the declaration.
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString("latin1"))?.[1];
  const decoded = decodeText(bytes, declared ?? codepage);
  if (decoded.note !== undefined && !notes.includes(decoded.note)) notes.push(decoded.note);
  return decoded.text;
}
