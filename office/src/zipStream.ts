/**
 * Writing a zip archive to a stream: what a folder download needs, where the
 * archive can be far larger than memory.
 *
 * The counterpart of zipWriter.ts, which builds a whole archive in a Buffer for the
 * Office packages. Same stance — deflate, UTF-8 names, no ZIP64, no encryption,
 * written here rather than taken from a package because the deployments are
 * air-gapped — with two differences a stream imposes:
 *
 * - each file's CRC and sizes are only known once its body has gone out, so they
 *   follow it in a data descriptor (general-purpose flag bit 3) and are repeated in
 *   the central directory;
 * - the 65 535-entry and 4 GiB limits must be checked *before* the first byte,
 *   because a response that has started cannot be turned into an error. The caller
 *   passes every entry, with its size, up front; `assertZipStreamFits` is the check.
 */
import zlib from "node:zlib";
import type { Readable, Writable } from "node:stream";

export interface ZipStreamEntry {
  /** `/`-separated name inside the archive, never starting with `/`; no trailing `/`. */
  name: string;
  kind: "file" | "directory";
  /** Uncompressed size, known up front (it is what the limit is checked against). */
  size: number;
  /** A file's bytes; called once, when its turn comes. */
  open?: () => Readable;
}

const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const FLAG_DESCRIPTOR = 0x0008;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** MS-DOS directory attribute, in the low byte of the external attributes. */
const ATTRIBUTE_DIRECTORY = 0x10;

export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_32 = 0xffffffff;

/**
 * The bytes the archive can take at most, with nothing compressing: every header,
 * name and descriptor, and deflate's worst-case expansion (5 bytes per 16 KiB block
 * of stored data, plus a few per stream). Checked against the 32-bit offsets, so a
 * passing archive can never wrap one.
 */
export function worstCaseZipBytes(entries: readonly Pick<ZipStreamEntry, "name" | "size">[], commentBytes = 0): number {
  let total = 22 + commentBytes;
  for (const entry of entries) {
    const name = Buffer.byteLength(entry.name, "utf8") + 1;
    total += 30 + name + 16 + 46 + name + entry.size + Math.ceil(entry.size / 16_384) * 5 + 16;
  }
  return total;
}

/** Throws a plain Error naming the limit an archive of these entries would pass. */
export function assertZipStreamFits(entries: readonly Pick<ZipStreamEntry, "name" | "size">[], commentBytes = 0): void {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`a zip without ZIP64 holds at most ${ZIP_MAX_ENTRIES} entries (got ${entries.length})`);
  }
  if (worstCaseZipBytes(entries, commentBytes) > ZIP_MAX_32) {
    throw new Error("the archive would pass 4 GiB, which a zip without ZIP64 cannot describe");
  }
}

function writeChunk(out: Writable, chunk: Buffer): Promise<void> {
  if (out.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      out.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      out.off("drain", onDrain);
      reject(error);
    };
    out.once("drain", onDrain);
    out.once("error", onError);
  });
}

/**
 * Write `entries`, in order, as one zip archive to `out`, then end nothing: the
 * caller owns `out`. Names are validated and must be unique. `comment` is stored in
 * the end record (at most 65 535 bytes).
 */
export async function writeZipStream(entries: readonly ZipStreamEntry[], out: Writable, comment = ""): Promise<void> {
  const commentBytes = Buffer.from(comment, "utf8");
  if (commentBytes.length > 0xffff) throw new Error("a zip comment holds at most 65535 bytes");
  assertZipStreamFits(entries, commentBytes.length);
  const seen = new Set<string>();
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (entry.name === "" || entry.name.startsWith("/") || entry.name.endsWith("/") || entry.name.includes("\\")) {
      throw new Error(`invalid zip entry name "${entry.name}"`);
    }
    const stored = entry.kind === "directory" ? `${entry.name}/` : entry.name;
    if (seen.has(stored)) throw new Error(`duplicate zip entry "${stored}"`);
    seen.add(stored);
    const name = Buffer.from(stored, "utf8");
    const isFile = entry.kind === "file";
    const flags = FLAG_UTF8 | (isFile ? FLAG_DESCRIPTOR : 0);
    const method = isFile ? METHOD_DEFLATE : METHOD_STORE;
    const headerOffset = offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    // CRC and sizes stay zero: a file's come after it, a directory's are zero.
    local.writeUInt16LE(name.length, 26);
    await writeChunk(out, local);
    await writeChunk(out, name);
    offset += local.length + name.length;

    let crc = 0;
    let compressed = 0;
    let uncompressed = 0;
    if (isFile) {
      if (!entry.open) throw new Error(`zip entry "${entry.name}" has no content`);
      const source = entry.open();
      const deflate = zlib.createDeflateRaw();
      const done = new Promise<void>((resolve, reject) => {
        source.on("error", (error) => {
          deflate.destroy(error);
          reject(error);
        });
        deflate.on("error", reject);
        deflate.on("end", resolve);
      });
      // The loop below sees the same failure first and throws it; this keeps the
      // promise's own rejection from surfacing again as an unhandled one.
      done.catch(() => {});
      source.on("data", (chunk: Buffer) => {
        crc = zlib.crc32(chunk, crc);
        uncompressed += chunk.length;
      });
      source.pipe(deflate);
      for await (const chunk of deflate as AsyncIterable<Buffer>) {
        compressed += chunk.length;
        await writeChunk(out, chunk);
      }
      await done;
      if (uncompressed > ZIP_MAX_32 || compressed > ZIP_MAX_32) {
        throw new Error(`"${entry.name}" grew past 4 GiB while it was being archived`);
      }
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed, 8);
      descriptor.writeUInt32LE(uncompressed, 12);
      await writeChunk(out, descriptor);
      offset += compressed + descriptor.length;
    }

    const record = Buffer.alloc(46);
    record.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed, 20);
    record.writeUInt32LE(uncompressed, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(isFile ? 0 : ATTRIBUTE_DIRECTORY, 38);
    record.writeUInt32LE(headerOffset, 42);
    central.push(record, name);
  }

  const directory = Buffer.concat(central);
  if (offset > ZIP_MAX_32 || directory.length > ZIP_MAX_32) {
    throw new Error("the archive passed 4 GiB while it was being written");
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  await writeChunk(out, directory);
  await writeChunk(out, end);
  if (commentBytes.length > 0) await writeChunk(out, commentBytes);
}
