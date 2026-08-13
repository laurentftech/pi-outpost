/**
 * The one zip operation a document reader needs: read one entry, by exact name.
 *
 * Written here rather than taken from a package because the deployments this
 * serves are air-gapped, where a dependency is something a security team vendors
 * and re-reviews rather than something you install (see the docx change,
 * decision 1). The scope is deliberately tiny: no writing, no listing for the
 * caller, no path handling — an entry name never becomes a filesystem path, so
 * the classic zip-slip has no reachable sink here.
 *
 * SECURITY: the bytes are attacker-controlled. Every loop below is bounded, and
 * inflation runs against a byte budget so a compression bomb is stopped while it
 * expands rather than measured once it has.
 */
import zlib from "node:zlib";

export type ZipErrorReason =
  /** Not a zip at all, or damaged past reading. */
  | "unreadable"
  /** More entries than we will look at. */
  | "too-many-entries"
  /** A part expanded past the budget. */
  | "too-large";

export class ZipError extends Error {
  constructor(
    readonly reason: ZipErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipLimits {
  /** Entries in the central directory. A package with more is refused unread. */
  maxEntries: number;
  /** Ceiling on what one entry may expand to. */
  maxInflatedBytes: number;
}

/** Offsets and sizes of one entry, as the central directory states them. */
interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The end-of-central-directory record, plus the largest comment it may carry. */
const EOCD_MAX_SEARCH = 22 + 0xffff;

/**
 * Find the end-of-central-directory record, scanning back from the end.
 *
 * The record is last in the file but its length varies with a trailing comment,
 * so it has to be searched for — bounded to the largest comment a zip may hold.
 */
function findEndOfCentralDirectory(bytes: Buffer): number {
  const earliest = Math.max(0, bytes.length - EOCD_MAX_SEARCH);
  for (let at = bytes.length - 22; at >= earliest; at--) {
    if (bytes.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw new ZipError("unreadable", "not a zip archive (no end-of-central-directory record)");
}

/** Read within the buffer or fail — never read past the end of attacker-supplied bytes. */
function slice(bytes: Buffer, start: number, length: number): Buffer {
  if (start < 0 || length < 0 || start + length > bytes.length) {
    throw new ZipError("unreadable", "the archive ends in the middle of a record");
  }
  return bytes.subarray(start, start + length);
}

/**
 * The archive's entries, as its central directory declares them. Names are
 * decoded as UTF-8, which is what OOXML packages use.
 */
export function readCentralDirectory(bytes: Buffer, limits: ZipLimits): ZipEntry[] {
  if (bytes.length < 22) throw new ZipError("unreadable", "too short to be a zip archive");
  const eocd = findEndOfCentralDirectory(bytes);
  const count = bytes.readUInt16LE(eocd + 10);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);

  if (count > limits.maxEntries) {
    throw new ZipError("too-many-entries", `the archive declares ${count} entries (limit ${limits.maxEntries})`);
  }

  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    const header = slice(bytes, at, 46);
    if (header.readUInt32LE(0) !== CENTRAL_SIGNATURE) {
      throw new ZipError("unreadable", "the central directory is malformed");
    }
    const nameLength = header.readUInt16LE(28);
    const extraLength = header.readUInt16LE(30);
    const commentLength = header.readUInt16LE(32);
    entries.push({
      name: slice(bytes, at + 46, nameLength).toString("utf8"),
      compressionMethod: header.readUInt16LE(10),
      compressedSize: header.readUInt32LE(20),
      uncompressedSize: header.readUInt32LE(24),
      localHeaderOffset: header.readUInt32LE(42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inflate with a ceiling, so a bomb dies while it expands rather than after. */
function inflateBounded(compressed: Buffer, maxBytes: number, name: string): Buffer {
  try {
    return zlib.inflateRawSync(compressed, { maxOutputLength: maxBytes });
  } catch (error) {
    // zlib reports the ceiling as a buffer-size error; everything else is damage.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength/i.test(String(error))) {
      throw new ZipError("too-large", `"${name}" expands past the ${maxBytes} byte limit`);
    }
    throw new ZipError("unreadable", `"${name}" could not be decompressed`);
  }
}

/**
 * The contents of one entry, or null when the archive does not carry it.
 *
 * The entry is located through the central directory and then read from its
 * local header, whose name and extra-field lengths are the ones that count —
 * the two records disagree often enough that trusting the wrong one truncates
 * real files.
 */
export function readZipEntry(bytes: Buffer, name: string, limits: ZipLimits): Buffer | null {
  const entry = readCentralDirectory(bytes, limits).find((candidate) => candidate.name === name);
  if (entry === undefined) return null;

  const local = slice(bytes, entry.localHeaderOffset, 30);
  if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new ZipError("unreadable", `"${name}" does not start with a local file header`);
  }
  const dataAt = entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);

  if (entry.uncompressedSize > limits.maxInflatedBytes) {
    throw new ZipError("too-large", `"${name}" declares ${entry.uncompressedSize} bytes (limit ${limits.maxInflatedBytes})`);
  }
  const compressed = slice(bytes, dataAt, entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed; // stored
  if (entry.compressionMethod !== 8) {
    throw new ZipError("unreadable", `"${name}" uses an unsupported compression method`);
  }
  return inflateBounded(compressed, limits.maxInflatedBytes, name);
}

/** Whether the archive carries an entry with this exact name. */
export function hasZipEntry(bytes: Buffer, name: string, limits: ZipLimits): boolean {
  return readCentralDirectory(bytes, limits).some((entry) => entry.name === name);
}
