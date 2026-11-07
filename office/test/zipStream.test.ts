/**
 * The streaming zip writer: what it writes must read back, byte for byte, both with
 * our own reader and with an independent one (JSZip) — a writer checked only against
 * its sibling reader could share its mistakes.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { describe, test } from "node:test";
import JSZip from "jszip";
import { readAllZipEntries } from "../src/zip.ts";
import { assertZipStreamFits, writeZipStream, ZIP_MAX_ENTRIES, type ZipStreamEntry } from "../src/zipStream.ts";

async function archive(entries: ZipStreamEntry[], comment?: string): Promise<Buffer> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (chunk: Buffer) => chunks.push(chunk));
  await writeZipStream(entries, out, comment);
  out.end();
  return Buffer.concat(chunks);
}

const file = (name: string, data: Buffer): ZipStreamEntry => ({
  name,
  kind: "file",
  size: data.length,
  // Several small chunks, so the CRC and sizes are carried across chunk boundaries.
  open: () => Readable.from(Array.from({ length: Math.ceil(data.length / 7) || 1 }, (_, i) => data.subarray(i * 7, i * 7 + 7))),
});

describe("writeZipStream", () => {
  const text = Buffer.from("hello, archive\n".repeat(200), "utf8");
  const noise = randomBytes(70_000);
  const entries: ZipStreamEntry[] = [
    { name: "reports", kind: "directory", size: 0 },
    file("reports/notes.txt", text),
    file("reports/q3 résumé.bin", noise),
    { name: "reports/empty", kind: "directory", size: 0 },
    file("reports/zero.txt", Buffer.alloc(0)),
  ];

  test("reads back with our reader: every file's bytes", async () => {
    const bytes = await archive(entries);
    // Our reader hands back files only; the directory entries are checked with JSZip below.
    const read = readAllZipEntries(bytes, { maxEntries: 100, maxInflatedBytes: 1e7, maxTotalBytes: 1e8 });

    assert.deepEqual([...read.keys()], ["reports/notes.txt", "reports/q3 résumé.bin", "reports/zero.txt"]);
    assert.ok(read.get("reports/notes.txt")!.equals(text));
    assert.ok(read.get("reports/q3 résumé.bin")!.equals(noise));
    assert.equal(read.get("reports/zero.txt")!.length, 0);
  });

  test("reads back with JSZip, which checks every CRC, and keeps the comment", async () => {
    const bytes = await archive(entries, "1 entry left out");
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });

    assert.deepEqual(Object.keys(zip.files), ["reports/", "reports/notes.txt", "reports/q3 résumé.bin", "reports/empty/", "reports/zero.txt"]);
    assert.equal(zip.files["reports/"].dir, true);
    assert.equal(zip.files["reports/empty/"].dir, true);
    assert.ok(Buffer.from(await zip.file("reports/notes.txt")!.async("uint8array")).equals(text));
    assert.ok(Buffer.from(await zip.file("reports/q3 résumé.bin")!.async("uint8array")).equals(noise));
    // JSZip reads the end record's comment but its types do not declare it.
    assert.equal((zip as unknown as { comment: string }).comment, "1 entry left out");
  });

  test("a duplicate or a malformed name is refused", async () => {
    await assert.rejects(archive([file("a.txt", text), file("a.txt", text)]), /duplicate/);
    await assert.rejects(archive([file("/abs.txt", text)]), /invalid/);
    await assert.rejects(archive([file("dir\\x.txt", text)]), /invalid/);
  });

  test("a read failure mid-file rejects instead of writing a short entry as if whole", async () => {
    const broken: ZipStreamEntry = {
      name: "broken.bin",
      kind: "file",
      size: 10,
      open: () =>
        new Readable({
          read() {
            this.destroy(new Error("disk went away"));
          },
        }),
    };
    await assert.rejects(archive([broken]), /disk went away/);
  });
});

describe("assertZipStreamFits", () => {
  test("past 65 535 entries or 4 GiB is refused before anything is written", () => {
    const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}`, size: 0 }));
    assert.throws(() => assertZipStreamFits(many), /65535 entries/);
    assert.throws(() => assertZipStreamFits([{ name: "huge.bin", size: 4 * 1024 ** 3 }]), /4 GiB/);
    assert.doesNotThrow(() => assertZipStreamFits([{ name: "fine.bin", size: 3 * 1024 ** 3 }]));
  });
});
