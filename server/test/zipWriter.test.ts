/**
 * The zip writer, checked against the reader that already guards untrusted input,
 * and the reader's all-entries mode, checked against the budget it promises.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readAllZipEntries, readZipEntry, ZipError } from "../src/zip.ts";
import { writeZip } from "../src/zipWriter.ts";

const LIMITS = { maxEntries: 100, maxInflatedBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 };

describe("writeZip", () => {
  test("writes entries the reader gets back byte for byte, in order", () => {
    const entries = [
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "ppt/slides/slide1.xml", data: Buffer.from("<p:sld>é ü 漢</p:sld>") },
      { name: "ppt/media/empty.bin", data: Buffer.alloc(0) },
      { name: "ppt/media/big.bin", data: Buffer.alloc(200_000, 7) },
    ];
    const archive = writeZip(entries);
    const read = readAllZipEntries(archive, LIMITS);
    assert.deepEqual([...read.keys()], entries.map((entry) => entry.name));
    for (const entry of entries) assert.ok(read.get(entry.name)!.equals(entry.data), entry.name);
    assert.ok(readZipEntry(archive, "ppt/media/big.bin", LIMITS)!.equals(entries[3].data));
  });

  test("is deterministic: the same input gives the same bytes", () => {
    const entries = [{ name: "a.xml", data: Buffer.from("<a/>") }];
    assert.ok(writeZip(entries).equals(writeZip(entries)));
  });

  test("marks names as UTF-8", () => {
    const archive = writeZip([{ name: "ppt/média.xml", data: Buffer.from("x") }]);
    // General-purpose flag bit 11 in the local header.
    assert.equal(archive.readUInt16LE(6) & 0x0800, 0x0800);
    assert.ok(readAllZipEntries(archive, LIMITS).has("ppt/média.xml"));
  });

  test("refuses names a package must not hold", () => {
    for (const name of ["", "/abs.xml", "ppt\\slide.xml"]) {
      assert.throws(() => writeZip([{ name, data: Buffer.from("x") }]), /invalid zip entry name/, JSON.stringify(name));
    }
    assert.throws(
      () => writeZip([{ name: "a.xml", data: Buffer.from("1") }, { name: "a.xml", data: Buffer.from("2") }]),
      /duplicate zip entry "a.xml"/,
    );
  });
});

describe("readAllZipEntries", () => {
  test("stops a package whose parts add up past the total budget", () => {
    const archive = writeZip([
      { name: "a.bin", data: Buffer.alloc(600, 1) },
      { name: "b.bin", data: Buffer.alloc(600, 2) },
    ]);
    assert.throws(
      () => readAllZipEntries(archive, { maxEntries: 10, maxInflatedBytes: 1000, maxTotalBytes: 1000 }),
      (error: unknown) => error instanceof ZipError && error.reason === "too-large",
    );
    // Each part alone is within the per-entry ceiling: it is the sum that is refused.
    assert.equal(readAllZipEntries(archive, { maxEntries: 10, maxInflatedBytes: 1000, maxTotalBytes: 1200 }).size, 2);
  });

  test("refuses more entries than the limit before reading any", () => {
    const archive = writeZip(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.xml`, data: Buffer.from("x") })));
    assert.throws(
      () => readAllZipEntries(archive, { maxEntries: 4, maxInflatedBytes: 100, maxTotalBytes: 100 }),
      (error: unknown) => error instanceof ZipError && error.reason === "too-many-entries",
    );
  });
});
