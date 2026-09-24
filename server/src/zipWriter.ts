/**
 * Writing a zip archive: what the presentation builder needs to produce a .pptx.
 *
 * The reading half lives in zip.ts and stays read-only; this is its counterpart,
 * kept apart so a reader never imports a writer. Written here rather than taken
 * from a package for the same reason as the reader — the deployments this serves
 * are air-gapped (see the docx change, decision 1).
 *
 * Deliberately narrow: deflated entries, no ZIP64, no encryption, no comments. An
 * Office package never needs more, and the sizes involved are capped long before
 * the 4 GiB a 32-bit field can describe — which is checked rather than assumed.
 *
 * Deterministic: every entry carries the same timestamp (1980-01-01, the earliest a
 * DOS date can say), so the same input always produces the same bytes.
 */
import zlib from "node:zlib";

export interface ZipInput {
  /** Entry name inside the archive, `/`-separated, never starting with `/`. */
  name: string;
  data: Buffer;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
/** General-purpose flag bit 11: the name is UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;
/** 1980-01-01 00:00:00 in DOS date/time encoding. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Past this, a 32-bit size or offset field would silently wrap. */
const MAX_32 = 0xffffffff;

export function writeZip(entries: ZipInput[]): Buffer {
  if (entries.length > 0xffff) throw new Error(`a zip without ZIP64 holds at most 65535 entries (got ${entries.length})`);
  const seen = new Set<string>();
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (entry.name === "" || entry.name.startsWith("/") || entry.name.includes("\\")) {
      throw new Error(`invalid zip entry name "${entry.name}"`);
    }
    if (seen.has(entry.name)) throw new Error(`duplicate zip entry "${entry.name}"`);
    seen.add(entry.name);

    const name = Buffer.from(entry.name, "utf8");
    const body = zlib.deflateRawSync(entry.data);
    const crc = zlib.crc32(entry.data);
    if (entry.data.length > MAX_32 || body.length > MAX_32 || offset > MAX_32) {
      throw new Error("the archive is too large to write without ZIP64");
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(FLAG_UTF8, 8);
    record.writeUInt16LE(METHOD_DEFLATE, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);

    chunks.push(local, name, body);
    central.push(record, name);
    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  if (offset > MAX_32 || directory.length > MAX_32) throw new Error("the archive is too large to write without ZIP64");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
