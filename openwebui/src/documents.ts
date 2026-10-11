/**
 * The Word and PowerPoint files the document tools wrote, kept so a later call can change
 * one rather than write it again.
 *
 *     <dataDir>/documents/<sha256(owner)>/<sha256(file name)>.bin    the file
 *     <dataDir>/documents/<sha256(owner)>/<sha256(file name)>.json   its name, type, template, date
 *
 * A file is found by the name the model gave it — the model never sees the embed, so a
 * name is the only handle it has, and the user sees the same one. Writing a name again
 * replaces that file. Each user keeps at most `maxDocuments`, the oldest going first, and
 * none older than `documentDays`: the files are working copies, not an archive.
 *
 * Kept apart from the plannings' tree, whose user folders hold one folder per planning.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface StoredDocumentMeta {
  fileName: string;
  mediaType: string;
  template: string;
  updated: string;
  size: number;
}

export interface DocumentStoreConfig {
  dataDir: string;
  maxDocuments: number;
  documentDays: number;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export class DocumentStore {
  /** One change at a time per document, so two updates cannot each start from the same file. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly config: DocumentStoreConfig) {}

  private dir(owner: string): string {
    return path.join(this.config.dataDir, "documents", sha256(owner));
  }

  /** The key a file name is kept under: case does not make two documents. */
  private key(fileName: string): string {
    return sha256(fileName.normalize("NFC").toLowerCase());
  }

  /** Runs `task` after every earlier task on the same document has finished. */
  async exclusive<T>(owner: string, fileName: string, task: () => Promise<T>): Promise<T> {
    const id = `${sha256(owner)}/${this.key(fileName)}`;
    const previous = this.queues.get(id) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(id, settled);
    try {
      return await run;
    } finally {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    }
  }

  async save(owner: string, file: { fileName: string; mediaType: string; template: string; bytes: Buffer }): Promise<void> {
    const dir = this.dir(owner);
    await fs.mkdir(dir, { recursive: true });
    const key = this.key(file.fileName);
    const meta: StoredDocumentMeta = { fileName: file.fileName, mediaType: file.mediaType, template: file.template, updated: new Date().toISOString(), size: file.bytes.length };
    // Each part replaced through a sibling and a rename: a reader never sees half a file.
    const suffix = randomBytes(6).toString("hex");
    await fs.writeFile(path.join(dir, `${key}.bin.${suffix}`), file.bytes);
    await fs.rename(path.join(dir, `${key}.bin.${suffix}`), path.join(dir, `${key}.bin`));
    await fs.writeFile(path.join(dir, `${key}.json.${suffix}`), JSON.stringify(meta));
    await fs.rename(path.join(dir, `${key}.json.${suffix}`), path.join(dir, `${key}.json`));
    await this.prune(owner);
  }

  async get(owner: string, fileName: string): Promise<{ meta: StoredDocumentMeta; bytes: Buffer } | undefined> {
    await this.prune(owner);
    const dir = this.dir(owner);
    const key = this.key(fileName);
    try {
      const meta = JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), "utf8")) as StoredDocumentMeta;
      return { meta, bytes: await fs.readFile(path.join(dir, `${key}.bin`)) };
    } catch {
      return undefined;
    }
  }

  /** The user's documents, the most recently written first. */
  async list(owner: string): Promise<StoredDocumentMeta[]> {
    await this.prune(owner);
    return (await this.entries(owner)).map((entry) => entry.meta);
  }

  private async entries(owner: string): Promise<{ key: string; meta: StoredDocumentMeta }[]> {
    const dir = this.dir(owner);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const entries: { key: string; meta: StoredDocumentMeta }[] = [];
    for (const name of names.filter((candidate) => candidate.endsWith(".json"))) {
      try {
        entries.push({ key: name.slice(0, -".json".length), meta: JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as StoredDocumentMeta });
      } catch {
        // A half-written or damaged entry is not a document; pruning removes it later.
      }
    }
    return entries.sort((a, b) => b.meta.updated.localeCompare(a.meta.updated));
  }

  /** Removes what is past its days, and the oldest past the count. */
  private async prune(owner: string): Promise<void> {
    const dir = this.dir(owner);
    const cutoff = Date.now() - this.config.documentDays * 24 * 60 * 60 * 1000;
    const entries = await this.entries(owner);
    const removed = entries.filter((entry, index) => index >= this.config.maxDocuments || Date.parse(entry.meta.updated) < cutoff);
    for (const { key } of removed) {
      await fs.rm(path.join(dir, `${key}.json`), { force: true });
      await fs.rm(path.join(dir, `${key}.bin`), { force: true });
    }
  }
}
