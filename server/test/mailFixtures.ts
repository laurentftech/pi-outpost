/**
 * Building the email fixtures the mail tests read.
 *
 * A `.eml` is text and needs no builder. A `.msg` is a compound file, and a fixture
 * per edge case would be a directory of opaque binaries nobody can review — so the
 * container is written here instead, and each test states the properties it cares
 * about in a line or two. The committed fixtures come out of this same writer (see
 * `scripts/build-mail-fixtures.mts`), so what the suite exercises and what a
 * reviewer can open are the same bytes.
 *
 * This writes real compound files: a FAT, a mini-FAT for streams under 4 KiB, a
 * sorted directory, and the sector arithmetic that goes with them. Small streams
 * therefore take the mini-FAT path in the reader and large ones the FAT path, which
 * is the pair of paths a hand-rolled container has to get right.
 */

const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const MINI_CUTOFF = 4096;
const FAT_ENTRIES_PER_SECTOR = SECTOR_SIZE / 4;
const DIRECTORY_ENTRIES_PER_SECTOR = SECTOR_SIZE / 128;

const FREE = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;
const NO_STREAM = 0xffffffff;

/** A node in the compound file: a storage with children, or a stream with bytes. */
export type CfbNode = { name: string; children: CfbNode[] } | { name: string; data: Buffer };

function isStorage(node: CfbNode): node is { name: string; children: CfbNode[] } {
  return "children" in node;
}

interface PlannedEntry {
  name: string;
  type: 1 | 2 | 5;
  data: Buffer;
  children: number[];
  /** Filled in once sectors are assigned. */
  start: number;
  size: number;
  left: number;
  right: number;
  child: number;
}

/**
 * Siblings in a compound file are ordered by name length first, then by the
 * upper-cased name. The reader here walks every child whatever the shape, but real
 * tools binary-search this order, so the fixtures honour it: a chain built through
 * `right` alone is then a valid — if maximally unbalanced — tree.
 */
function compareNames(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  const a = left.toUpperCase();
  const b = right.toUpperCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Flatten the tree into directory entries, linking each storage to its children. */
function planEntries(root: CfbNode[]): PlannedEntry[] {
  const entries: PlannedEntry[] = [
    {
      name: "Root Entry",
      type: 5,
      data: Buffer.alloc(0),
      children: [],
      start: END_OF_CHAIN,
      size: 0,
      left: NO_STREAM,
      right: NO_STREAM,
      child: NO_STREAM,
    },
  ];

  const add = (nodes: CfbNode[], parent: number): void => {
    const indexes: number[] = [];
    for (const node of [...nodes].sort((left, right) => compareNames(left.name, right.name))) {
      const index = entries.length;
      entries.push({
        name: node.name,
        type: isStorage(node) ? 1 : 2,
        data: isStorage(node) ? Buffer.alloc(0) : node.data,
        children: [],
        start: END_OF_CHAIN,
        size: 0,
        left: NO_STREAM,
        right: NO_STREAM,
        child: NO_STREAM,
      });
      indexes.push(index);
      if (isStorage(node)) add(node.children, index);
    }
    entries[parent].children = indexes;
    // A degenerate tree: each sibling is the right child of the one before it.
    for (let at = 0; at < indexes.length; at++) {
      entries[indexes[at]].right = indexes[at + 1] ?? NO_STREAM;
    }
    entries[parent].child = indexes[0] ?? NO_STREAM;
  };

  add(root, 0);
  return entries;
}

/** Write a compound file holding this tree. */
export function writeCompoundFile(tree: CfbNode[]): Buffer {
  const entries = planEntries(tree);

  // Small streams live in the mini stream; large ones get their own sectors.
  const mini = entries.filter((entry) => entry.type === 2 && entry.data.length > 0 && entry.data.length < MINI_CUTOFF);
  const large = entries.filter((entry) => entry.type === 2 && entry.data.length >= MINI_CUTOFF);

  const miniPieces: Buffer[] = [];
  let miniSector = 0;
  for (const entry of mini) {
    entry.start = miniSector;
    entry.size = entry.data.length;
    const padded = Buffer.alloc(Math.ceil(entry.data.length / MINI_SECTOR_SIZE) * MINI_SECTOR_SIZE);
    entry.data.copy(padded);
    miniPieces.push(padded);
    miniSector += padded.length / MINI_SECTOR_SIZE;
  }
  const miniStream = Buffer.concat(miniPieces);

  // The mini-FAT: one chain per small stream, laid out consecutively.
  const miniFat: number[] = [];
  for (const entry of mini) {
    const count = Math.ceil(entry.data.length / MINI_SECTOR_SIZE);
    for (let index = 0; index < count; index++) {
      miniFat.push(index === count - 1 ? END_OF_CHAIN : entry.start + index + 1);
    }
  }
  while (miniFat.length % FAT_ENTRIES_PER_SECTOR !== 0) miniFat.push(FREE);

  const directoryBytes = Buffer.alloc(Math.ceil(entries.length / DIRECTORY_ENTRIES_PER_SECTOR) * SECTOR_SIZE, 0);

  /** Runs of consecutive sectors to chain in the FAT, in allocation order. */
  const runs: { first: number; count: number; assign?: (first: number) => void }[] = [];
  let nextSector = 0;
  const allocate = (bytes: number, assign?: (first: number) => void): number => {
    const count = Math.max(1, Math.ceil(bytes / SECTOR_SIZE));
    const first = nextSector;
    runs.push({ first, count, assign });
    nextSector += count;
    assign?.(first);
    return first;
  };

  const contents: { at: number; data: Buffer }[] = [];
  for (const entry of large) {
    entry.size = entry.data.length;
    const first = allocate(entry.data.length, (start) => {
      entry.start = start;
    });
    contents.push({ at: first, data: entry.data });
  }
  const miniStreamStart = miniStream.length === 0 ? END_OF_CHAIN : allocate(miniStream.length);
  if (miniStream.length > 0) contents.push({ at: miniStreamStart, data: miniStream });
  const miniFatStart = miniFat.length === 0 ? END_OF_CHAIN : allocate(miniFat.length * 4);
  if (miniFat.length > 0) {
    const bytes = Buffer.alloc(Math.ceil(miniFat.length / FAT_ENTRIES_PER_SECTOR) * SECTOR_SIZE, 0xff);
    miniFat.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
    contents.push({ at: miniFatStart, data: bytes });
  }
  const directoryStart = allocate(directoryBytes.length);
  contents.push({ at: directoryStart, data: directoryBytes });

  // The FAT's own sectors are in the FAT, so their count feeds back into the total.
  // Two passes settle it for any file this builder produces.
  let fatSectorCount = 1;
  for (let pass = 0; pass < 8; pass++) {
    const needed = Math.ceil((nextSector + fatSectorCount) / FAT_ENTRIES_PER_SECTOR);
    if (needed === fatSectorCount) break;
    fatSectorCount = needed;
  }
  const fatSectors: number[] = [];
  for (let index = 0; index < fatSectorCount; index++) fatSectors.push(nextSector + index);
  const totalSectors = nextSector + fatSectorCount;

  const fat = new Array<number>(fatSectorCount * FAT_ENTRIES_PER_SECTOR).fill(FREE);
  for (const run of runs) {
    for (let index = 0; index < run.count; index++) {
      fat[run.first + index] = index === run.count - 1 ? END_OF_CHAIN : run.first + index + 1;
    }
  }
  for (const sector of fatSectors) fat[sector] = FAT_SECTOR;

  // Root entry points at the mini stream; that is what makes small streams readable.
  entries[0].start = miniStreamStart;
  entries[0].size = miniStream.length;

  for (const [index, entry] of entries.entries()) {
    const at = index * 128;
    const name = Buffer.from(`${entry.name}\0`, "utf16le");
    name.copy(directoryBytes, at, 0, Math.min(name.length, 64));
    directoryBytes.writeUInt16LE(Math.min(name.length, 64), at + 64);
    directoryBytes[at + 66] = entry.type;
    directoryBytes[at + 67] = 1; // black
    directoryBytes.writeUInt32LE(entry.left, at + 68);
    directoryBytes.writeUInt32LE(entry.right, at + 72);
    directoryBytes.writeUInt32LE(entry.child, at + 76);
    directoryBytes.writeUInt32LE(entry.type === 1 ? 0 : entry.start, at + 116);
    directoryBytes.writeUInt32LE(entry.type === 1 ? 0 : entry.size, at + 120);
  }
  // Unused directory slots must read as free, not as an entry named "".
  for (let index = entries.length; index < directoryBytes.length / 128; index++) {
    directoryBytes[index * 128 + 66] = 0; // unallocated
    directoryBytes.writeUInt32LE(NO_STREAM, index * 128 + 68);
    directoryBytes.writeUInt32LE(NO_STREAM, index * 128 + 72);
    directoryBytes.writeUInt32LE(NO_STREAM, index * 128 + 76);
  }

  const header = Buffer.alloc(SECTOR_SIZE, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 24); // minor version
  header.writeUInt16LE(3, 26); // major version: 512-byte sectors
  header.writeUInt16LE(0xfffe, 28); // little-endian
  header.writeUInt16LE(9, 30); // sector shift
  header.writeUInt16LE(6, 32); // mini sector shift
  header.writeUInt32LE(0, 40); // directory sector count: 0 in version 3
  header.writeUInt32LE(fatSectorCount, 44);
  header.writeUInt32LE(directoryStart, 48);
  header.writeUInt32LE(MINI_CUTOFF, 56);
  header.writeUInt32LE(miniFatStart, 60);
  header.writeUInt32LE(miniFat.length === 0 ? 0 : Math.ceil(miniFat.length / FAT_ENTRIES_PER_SECTOR), 64);
  header.writeUInt32LE(END_OF_CHAIN, 68); // no DIFAT: 109 FAT sectors is plenty here
  header.writeUInt32LE(0, 72);
  for (let index = 0; index < 109; index++) {
    header.writeUInt32LE(fatSectors[index] ?? FREE, 76 + index * 4);
  }

  const body = Buffer.alloc(totalSectors * SECTOR_SIZE, 0);
  for (const { at, data } of contents) data.copy(body, at * SECTOR_SIZE);
  for (const [index, sector] of fatSectors.entries()) {
    const slice = fat.slice(index * FAT_ENTRIES_PER_SECTOR, (index + 1) * FAT_ENTRIES_PER_SECTOR);
    slice.forEach((value, slot) => body.writeUInt32LE(value, sector * SECTOR_SIZE + slot * 4));
  }

  return Buffer.concat([header, body]);
}

/* ── Message properties ─────────────────────────────────────────────────────── */

/** Property stream for a Unicode string: the spelling a modern Outlook writes. */
export function unicodeProperty(tag: string, value: string): CfbNode {
  return { name: `__substg1.0_${tag}001F`, data: Buffer.from(value, "utf16le") };
}

/** Property stream for an 8-bit string, read through the message's code page. */
export function ansiProperty(tag: string, bytes: Buffer): CfbNode {
  return { name: `__substg1.0_${tag}001E`, data: bytes };
}

export function binaryProperty(tag: string, bytes: Buffer): CfbNode {
  return { name: `__substg1.0_${tag}0102`, data: bytes };
}

export function numberProperty(tag: string, value: number): CfbNode {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(value >>> 0);
  return { name: `__substg1.0_${tag}0003`, data };
}

/** Mail property tags, by the names the reader uses for them. */
export const MSG_TAG = {
  subject: "0037",
  body: "1000",
  bodyHtml: "1013",
  bodyRtfCompressed: "1009",
  senderName: "0C1A",
  senderEmail: "0C1F",
  displayTo: "0E04",
  displayCc: "0E03",
  transportHeaders: "007D",
  internetCodepage: "3FDE",
  attachLongFilename: "3707",
  attachFilename: "3704",
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

export interface MsgAttachmentSpec {
  name?: string;
  mediaType?: string;
  content?: Buffer;
  contentId?: string;
  /** `ATTACH_RENDERED_IN_BODY`. */
  renderedInBody?: boolean;
  /** `ATTACH_METHOD`; 5 is an embedded message with no bytes of its own. */
  method?: number;
  embeddedSubject?: string;
}

export interface MsgRecipientSpec {
  name?: string;
  address?: string;
  /** 1 = To, 2 = Cc, 3 = Bcc. */
  type?: number;
}

export interface MsgSpec {
  subject?: string;
  /** Written as an 8-bit property in the message's code page when `codepage` is set. */
  body?: string;
  bodyHtml?: string | Buffer;
  bodyRtfCompressed?: Buffer;
  senderName?: string;
  senderEmail?: string;
  displayTo?: string;
  transportHeaders?: string;
  codepage?: number;
  /** Encode the string properties in the code page rather than as UTF-16. */
  ansi?: boolean;
  attachments?: MsgAttachmentSpec[];
  recipients?: MsgRecipientSpec[];
  /** Extra streams, for a case this interface does not cover. */
  extra?: CfbNode[];
}

/** windows-1252 bytes for a string, for the non-Unicode property tests. */
export function cp1252(text: string): Buffer {
  const high = new Map<string, number>([
    ["\u20ac", 0x80], ["\u201a", 0x82], ["\u0192", 0x83], ["\u201e", 0x84], ["\u2026", 0x85],
    ["\u2020", 0x86], ["\u2021", 0x87], ["\u02c6", 0x88], ["\u2030", 0x89], ["\u0160", 0x8a],
    ["\u2039", 0x8b], ["\u0152", 0x8c], ["\u017d", 0x8e], ["\u2018", 0x91], ["\u2019", 0x92],
    ["\u201c", 0x93], ["\u201d", 0x94], ["\u2022", 0x95], ["\u2013", 0x96], ["\u2014", 0x97],
    ["\u02dc", 0x98], ["\u2122", 0x99], ["\u0161", 0x9a], ["\u203a", 0x9b], ["\u0153", 0x9c],
    ["\u017e", 0x9e], ["\u0178", 0x9f],
  ]);
  const out = Buffer.alloc(text.length);
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    const mapped = high.get(char);
    out[at] = mapped ?? (char.charCodeAt(0) & 0xff);
  }
  return out;
}

/** A `.msg` file holding these properties. */
export function outlookMessage(spec: MsgSpec): Buffer {
  const nodes: CfbNode[] = [];
  const string = (tag: string, value: string): CfbNode =>
    spec.ansi === true ? ansiProperty(tag, cp1252(value)) : unicodeProperty(tag, value);

  if (spec.subject !== undefined) nodes.push(string(MSG_TAG.subject, spec.subject));
  if (spec.body !== undefined) nodes.push(string(MSG_TAG.body, spec.body));
  if (spec.bodyHtml !== undefined) {
    nodes.push(
      typeof spec.bodyHtml === "string"
        ? binaryProperty(MSG_TAG.bodyHtml, Buffer.from(spec.bodyHtml, "utf8"))
        : binaryProperty(MSG_TAG.bodyHtml, spec.bodyHtml),
    );
  }
  if (spec.bodyRtfCompressed !== undefined) nodes.push(binaryProperty(MSG_TAG.bodyRtfCompressed, spec.bodyRtfCompressed));
  if (spec.senderName !== undefined) nodes.push(string(MSG_TAG.senderName, spec.senderName));
  if (spec.senderEmail !== undefined) nodes.push(string(MSG_TAG.senderEmail, spec.senderEmail));
  if (spec.displayTo !== undefined) nodes.push(string(MSG_TAG.displayTo, spec.displayTo));
  if (spec.transportHeaders !== undefined) nodes.push(string(MSG_TAG.transportHeaders, spec.transportHeaders));
  if (spec.codepage !== undefined) nodes.push(numberProperty(MSG_TAG.internetCodepage, spec.codepage));

  for (const [index, attachment] of (spec.attachments ?? []).entries()) {
    const children: CfbNode[] = [];
    if (attachment.name !== undefined) children.push(string(MSG_TAG.attachLongFilename, attachment.name));
    if (attachment.mediaType !== undefined) children.push(string(MSG_TAG.attachMimeTag, attachment.mediaType));
    if (attachment.contentId !== undefined) children.push(string(MSG_TAG.attachContentId, attachment.contentId));
    if (attachment.content !== undefined) children.push(binaryProperty(MSG_TAG.attachData, attachment.content));
    if (attachment.renderedInBody === true) children.push(numberProperty(MSG_TAG.attachFlags, 4));
    if (attachment.method !== undefined) children.push(numberProperty(MSG_TAG.attachMethod, attachment.method));
    if (attachment.embeddedSubject !== undefined) {
      children.push({
        name: "__substg1.0_3701000D",
        children: [unicodeProperty(MSG_TAG.subject, attachment.embeddedSubject)],
      });
    }
    nodes.push({ name: `__attach_version1.0_#${index.toString(16).padStart(8, "0").toUpperCase()}`, children });
  }

  for (const [index, recipient] of (spec.recipients ?? []).entries()) {
    const children: CfbNode[] = [];
    if (recipient.name !== undefined) children.push(string(MSG_TAG.displayName, recipient.name));
    if (recipient.address !== undefined) children.push(string(MSG_TAG.smtpAddress, recipient.address));
    children.push(numberProperty(MSG_TAG.recipientType, recipient.type ?? 1));
    nodes.push({ name: `__recip_version1.0_#${index.toString(16).padStart(8, "0").toUpperCase()}`, children });
  }

  nodes.push(...(spec.extra ?? []));
  return writeCompoundFile(nodes);
}

/* ── Compressed rich text ───────────────────────────────────────────────────── */

const LZFU_DICTIONARY =
  "{\\rtf1\\ansi\\mac\\pca\\pch\\pcbi\\pcgreek\\pctt\\deff0{\\fonttbl{\\f0\\fnil \\froman \\fswiss " +
  "\\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0" +
  "\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

/**
 * Compress RTF the way `PR_RTF_COMPRESSED` holds it.
 *
 * A greedy LZ77 over the same 4096-byte window the reader rebuilds, preloaded with
 * the dictionary. Matches against the preloaded region are what make the fixture
 * worth having: a decompressor that forgot the preload produces the right length and
 * the wrong bytes, and only a stream that actually references the dictionary catches
 * it.
 */
export function compressRtf(rtf: string): Buffer {
  const input = Buffer.from(rtf, "latin1");
  const window = Buffer.alloc(4096);
  const dictionary = Buffer.from(LZFU_DICTIONARY, "latin1");
  dictionary.copy(window, 0, 0, Math.min(dictionary.length, window.length));
  let writeAt = dictionary.length % window.length;

  const tokens: { literal?: number; offset?: number; length?: number }[] = [];
  let at = 0;
  while (at < input.length) {
    let bestOffset = -1;
    let bestLength = 0;
    // 17 bytes is the longest a 4-bit length can express.
    const maximum = Math.min(17, input.length - at);
    if (maximum >= 2) {
      for (let offset = 0; offset < window.length; offset++) {
        let length = 0;
        while (length < maximum && window[(offset + length) % window.length] === input[at + length]) length++;
        if (length > bestLength) {
          bestLength = length;
          bestOffset = offset;
          if (length === maximum) break;
        }
      }
    }
    if (bestLength >= 2 && bestOffset !== writeAt) {
      tokens.push({ offset: bestOffset, length: bestLength });
      for (let index = 0; index < bestLength; index++) {
        window[writeAt] = input[at + index];
        writeAt = (writeAt + 1) % window.length;
      }
      at += bestLength;
      continue;
    }
    tokens.push({ literal: input[at] });
    window[writeAt] = input[at];
    writeAt = (writeAt + 1) % window.length;
    at++;
  }
  // The end marker: a reference whose offset is the write cursor.
  tokens.push({ offset: writeAt, length: 2 });

  const pieces: Buffer[] = [];
  for (let index = 0; index < tokens.length; index += 8) {
    const group = tokens.slice(index, index + 8);
    let control = 0;
    const bytes: number[] = [];
    group.forEach((token, bit) => {
      if (token.literal !== undefined) {
        bytes.push(token.literal);
        return;
      }
      control |= 1 << bit;
      const reference = ((token.offset ?? 0) << 4) | ((token.length ?? 2) - 2);
      bytes.push((reference >> 8) & 0xff, reference & 0xff);
    });
    pieces.push(Buffer.from([control, ...bytes]));
  }

  const data = Buffer.concat(pieces);
  const header = Buffer.alloc(16);
  header.writeUInt32LE(data.length + 12, 0); // compressed size: everything after this field
  header.writeUInt32LE(input.length, 4);
  header.writeUInt32LE(0x75465a4c, 8); // "LZFu"
  header.writeUInt32LE(0, 12); // CRC: not checked by the reader
  return Buffer.concat([header, data]);
}

/** An uncompressed `PR_RTF_COMPRESSED` stream, which the format also allows. */
export function uncompressedRtf(rtf: string): Buffer {
  const input = Buffer.from(rtf, "latin1");
  const header = Buffer.alloc(16);
  header.writeUInt32LE(input.length + 12, 0);
  header.writeUInt32LE(input.length, 4);
  header.writeUInt32LE(0x414c454d, 8); // "MELA"
  header.writeUInt32LE(0, 12);
  return Buffer.concat([header, input]);
}

/* ── Internet messages ──────────────────────────────────────────────────────── */

/**
 * A `.eml` from parts, with `CRLF` line endings as the format requires.
 *
 * `lineEnding` exists because a checked-in fixture arrives with whatever the
 * platform's git gave it, and the reader must accept both — so a test can ask for
 * `LF` and prove it.
 */
export function internetMessage(
  headers: Record<string, string>,
  body: string | Buffer,
  options: { lineEnding?: "\r\n" | "\n" } = {},
): Buffer {
  const newline = options.lineEnding ?? "\r\n";
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  const head = Buffer.from(`${lines.join(newline)}${newline}${newline}`, "latin1");
  // A string body is written as `latin1` — byte for byte, so a fixture can hold the
  // exact bytes a charset test needs. A body that is already encoded comes as a
  // Buffer and is written untouched.
  const tail =
    typeof body === "string" ? Buffer.from(body.replace(/\r?\n/g, newline), "latin1") : body;
  return Buffer.concat([head, tail]);
}

/** An `.emlx`: the byte count Apple Mail writes, the message, then its plist. */
export function appleMailMessage(message: Buffer): Buffer {
  const plist = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>flags</key><integer>8590196737</integer></dict></plist>\n',
    "utf8",
  );
  return Buffer.concat([Buffer.from(`${message.length}\n`, "ascii"), message, plist]);
}
