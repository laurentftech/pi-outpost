/**
 * Where a deletion from the Files tree goes, so it can be undone.
 *
 * The trash lives under pi-outpost's own data directory (`<agentDir>/outpost-trash`),
 * outside every workspace, where the sandbox already forbids the agent to read: a
 * deleted file must not stay reachable by the agent, nor show in `git status`. Each
 * entry sits in its own directory named by a random token — the only handle on it —
 * and is bound to the workspace it came from.
 *
 * The index is in memory only. The directory is emptied when the server starts, so a
 * restart can never restore something it no longer knows, and swept of anything older
 * than a day: the tree offers the undo only until the next operation, and a trash
 * that grew without bound would be a second copy of everything ever deleted.
 */
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const TRASH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface TrashEntry {
  token: string;
  workspaceId: string;
  /** The browser-root-relative path it was deleted from, and is restored to. */
  relPath: string;
  /** Where its bytes are now. */
  trashed: string;
  createdAt: number;
}

/** The filesystem calls a cross-device move needs; replaceable in tests. */
export interface MoveOps {
  rename: (from: string, to: string) => Promise<void>;
}

const realOps: MoveOps = { rename: (from, to) => fs.rename(from, to) };

/**
 * Move a file or a folder to a path that does not exist yet, across filesystems if
 * need be: the workspace and the data directory may be on different disks, where
 * `rename` answers EXDEV. Then it is copied — links as links — and the source removed
 * once the copy is whole. Nothing is ever overwritten: the copy refuses an existing
 * destination.
 */
export async function moveAcross(source: string, destination: string, ops: MoveOps = realOps): Promise<void> {
  try {
    await ops.rename(source, destination);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  const stat = await fs.lstat(source);
  if (stat.isDirectory()) {
    await fs.cp(source, destination, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  } else if (stat.isSymbolicLink()) {
    await fs.symlink(await fs.readlink(source), destination);
  } else {
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  }
  await fs.rm(source, { recursive: true, force: true });
}

export class Trash {
  private readonly entries = new Map<string, TrashEntry>();

  constructor(
    readonly root: string,
    private readonly now: () => number = Date.now,
    private readonly ops: MoveOps = realOps,
  ) {}

  /** Empty the trash for good: what a previous run deleted is not this run's to restore. */
  async reset(): Promise<void> {
    this.entries.clear();
    await fs.rm(this.root, { recursive: true, force: true });
    await fs.mkdir(this.root, { recursive: true });
  }

  /** Move `absolute` (already confined and checked writable) into the trash; answer its token. */
  async put(workspaceId: string, relPath: string, absolute: string): Promise<string> {
    const token = randomBytes(16).toString("hex");
    const dir = path.join(this.root, token);
    await fs.mkdir(dir, { recursive: true });
    const trashed = path.join(dir, "entry");
    try {
      await moveAcross(absolute, trashed, this.ops);
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true });
      throw error;
    }
    this.entries.set(token, { token, workspaceId, relPath, trashed, createdAt: this.now() });
    return token;
  }

  /**
   * The entry a token names, if it belongs to this workspace. It is taken out of the
   * index: a token restores once. `giveBack` returns it after a restore that failed.
   */
  take(token: string, workspaceId: string): TrashEntry | undefined {
    const entry = this.entries.get(token);
    if (!entry || entry.workspaceId !== workspaceId) return undefined;
    this.entries.delete(token);
    return entry;
  }

  giveBack(entry: TrashEntry): void {
    this.entries.set(entry.token, entry);
  }

  /** Forget an entry restored elsewhere: its directory is left empty. */
  async discard(entry: TrashEntry): Promise<void> {
    await fs.rm(path.dirname(entry.trashed), { recursive: true, force: true });
  }

  /** Erase for good every entry older than `maxAgeMs`. */
  async sweep(maxAgeMs = TRASH_MAX_AGE_MS): Promise<number> {
    const limit = this.now() - maxAgeMs;
    let erased = 0;
    for (const entry of [...this.entries.values()]) {
      if (entry.createdAt > limit) continue;
      this.entries.delete(entry.token);
      await this.discard(entry);
      erased++;
    }
    return erased;
  }

  get size(): number {
    return this.entries.size;
  }
}
