import { constants as fsConstants, type BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type BoundedFileRead =
  | { kind: "missing" }
  | { kind: "not-file" }
  | { kind: "too-large"; size: number }
  | { kind: "error"; error: unknown }
  | { kind: "ok"; size: number; bytes: Buffer };

const READ_ONLY_FILE_FLAGS: string | number =
  process.platform === "win32"
    ? "r"
    : fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW;
const READ_CHUNK_BYTES = 64 * 1024;

function samePath(first: string, second: string): boolean {
  const left = path.resolve(first);
  const right = path.resolve(second);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Read and size-check the same open regular file, without following symlinks or blocking on FIFOs. */
export async function readFileSafely(target: string, maxBytes: number): Promise<BoundedFileRead> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a non-negative safe integer");
  let expected: BigIntStats;
  try {
    const realPath = await fs.realpath(target);
    if (!samePath(realPath, target)) {
      return { kind: "error", error: new Error("File resolves through a symbolic link") };
    }
    expected = await fs.stat(target, { bigint: true });
  } catch {
    return { kind: "missing" };
  }
  const input = await fs.open(target, READ_ONLY_FILE_FLAGS).catch(() => null);
  if (input === null) return { kind: "missing" };
  try {
    const stat = await input.stat();
    if (!stat.isFile()) return { kind: "not-file" };
    const openedIdentity = await input.stat({ bigint: true });
    if (openedIdentity.dev !== expected.dev || openedIdentity.ino === 0n || openedIdentity.ino !== expected.ino) {
      return { kind: "error", error: new Error("File changed while opening") };
    }
    if (stat.size > maxBytes) return { kind: "too-large", size: stat.size };
    // O_NOFOLLOW protects the leaf on POSIX; Node has no equivalent open flag on
    // Windows. Verify the opened file identity and canonical path after opening
    // on every platform, catching a swapped leaf or parent directory as well.
    const [openedStat, pathStat, realPath] = await Promise.all([
      input.stat({ bigint: true }),
      fs.stat(target, { bigint: true }),
      fs.realpath(target),
    ]);
    if (
      openedStat.dev !== pathStat.dev ||
      openedStat.ino === 0n ||
      openedStat.ino !== pathStat.ino ||
      !samePath(realPath, target)
    ) {
      return { kind: "error", error: new Error("File changed or resolved through a symbolic link while opening") };
    }
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    while (bytesRead <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - bytesRead));
      const read = await input.read(chunk, 0, chunk.length, null);
      if (read.bytesRead === 0) break;
      chunks.push(chunk.subarray(0, read.bytesRead));
      bytesRead += read.bytesRead;
    }
    if (bytesRead > maxBytes) return { kind: "too-large", size: bytesRead };
    return { kind: "ok", size: bytesRead, bytes: Buffer.concat(chunks, bytesRead) };
  } catch (error) {
    return { kind: "error", error };
  } finally {
    await input.close().catch(() => undefined);
  }
}
