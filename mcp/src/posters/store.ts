/**
 * Posters in the folder the person chose: one printable page per poster, its history
 * hidden beside it.
 *
 *     <folder>/Class rules.poster.html            the poster, as @pi-outpost/posters writes it
 *     <folder>/Class rules.docx, … .pptx          exports, never written over one already there
 *     <folder>/.posters/class-rules/1.json …      every revision: { html, css, format, by, at }
 *     <folder>/.posters/class-rules/meta.json     id, title, revision, file name, dates
 *
 * A revision keeps the poster's markup and stylesheet apart, which is what the editor
 * loads and saves; the page in the folder is written from the latest one. A revision
 * says who made it — the model through a tool, or the person in the editor — so the
 * model can tell her touch-ups from its own work.
 *
 * The history is `.posters`, not `.history`: the plannings extension owns that name, and
 * both may be pointed at one folder. The page is written, never read back, so a hand
 * edit of it is replaced by the next revision. Writes are serialised in-process: the
 * host runs one server per folder.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { POSTER_SUFFIX, PosterRefusal, checkPoster, pageOf, slugOf, type PosterContent } from "@pi-outpost/posters/format";
import { fileStemOf } from "../store.ts";

export { PosterRefusal } from "@pi-outpost/posters/format";

export const HISTORY_DIR = ".posters";

export type Author = "model" | "user";

export interface PosterRevision extends PosterContent {
  id: string;
  title: string;
  file: string;
  revision: number;
  current: number;
  by: Author;
  at: string;
}

interface PosterMeta {
  id: string;
  title: string;
  revision: number;
  file: string;
  created: string;
  updated: string;
}

const POSTER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function notFound(id: string): PosterRefusal {
  return new PosterRefusal(`no poster "${id}". Poster ids come from the answers of create_poster or list_posters.`);
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

export class LocalPosterStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  private constructor(readonly root: string) {}

  static async open(root: string): Promise<LocalPosterStore> {
    const resolved = path.resolve(root);
    await fs.mkdir(resolved, { recursive: true });
    return new LocalPosterStore(resolved);
  }

  private async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  /** `target`, resolved, if it lies inside the folder; never anything else. */
  private inside(target: string): string {
    const resolved = path.resolve(target);
    if (resolved === this.root || !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`refusing a path outside the posters folder: ${resolved}`);
    }
    return resolved;
  }

  private historyDir(id: string): string {
    if (id.length > 64 || !POSTER_ID.test(id)) throw notFound(id);
    return this.inside(path.join(this.root, HISTORY_DIR, id));
  }

  private async readMeta(id: string): Promise<PosterMeta> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.historyDir(id), "meta.json"), "utf8")) as PosterMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound(id);
      throw error;
    }
  }

  private posterFile(meta: PosterMeta): string {
    // meta.json is ours, but it sits in a folder the person can edit: check it anyway.
    if (path.basename(meta.file) !== meta.file || !meta.file.endsWith(POSTER_SUFFIX)) {
      throw new PosterRefusal(`poster "${meta.id}" names an unusable file, "${meta.file}"`);
    }
    return this.inside(path.join(this.root, meta.file));
  }

  private async write(meta: PosterMeta, content: PosterContent, by: Author): Promise<PosterRevision> {
    const dir = this.historyDir(meta.id);
    const at = meta.updated;
    await fs.writeFile(path.join(dir, `${meta.revision}.json`), `${JSON.stringify({ ...content, by, at }, null, 1)}\n`, { flag: "wx" });
    await fs.writeFile(this.posterFile(meta), pageOf(meta.title, content));
    await fs.writeFile(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    return { id: meta.id, title: meta.title, file: meta.file, revision: meta.revision, current: meta.revision, by, at, ...content };
  }

  async create(title: string, content: PosterContent): Promise<PosterRevision> {
    checkPoster(content);
    const base = slugOf(title);
    return this.locked("create", async () => {
      await fs.mkdir(this.inside(path.join(this.root, HISTORY_DIR)), { recursive: true });
      let id = base;
      for (let n = 2; ; n++) {
        try {
          await fs.mkdir(this.historyDir(id));
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          id = `${base}-${n}`;
        }
      }
      const stem = fileStemOf(title);
      let file = `${stem}${POSTER_SUFFIX}`;
      for (let n = 2; await exists(path.join(this.root, file)); n++) file = `${stem} (${n})${POSTER_SUFFIX}`;
      const now = new Date().toISOString();
      return this.write({ id, title: title.trim() || "Poster", revision: 1, file, created: now, updated: now }, content, "model");
    });
  }

  async get(id: string, revision?: number): Promise<PosterRevision> {
    const meta = await this.readMeta(id);
    const wanted = revision ?? meta.revision;
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > meta.revision) {
      throw new PosterRefusal(`poster "${id}" has revisions 1 to ${meta.revision}, not ${wanted}`);
    }
    const stored = JSON.parse(await fs.readFile(path.join(this.historyDir(id), `${wanted}.json`), "utf8")) as PosterContent & { by: Author; at: string };
    return { id, title: meta.title, file: meta.file, revision: wanted, current: meta.revision, ...stored };
  }

  /** A new revision from `base`, refused when someone else saved since: nothing is overwritten unseen. */
  async revise(id: string, base: number, content: PosterContent, by: Author): Promise<PosterRevision> {
    checkPoster(content);
    return this.locked(id, async () => {
      const meta = await this.readMeta(id);
      if (base !== meta.revision) {
        const latest = await this.get(id);
        throw new PosterRefusal(
          `nothing was changed: poster "${id}" is at revision ${meta.revision}, not ${base}; revision ${meta.revision} was made by ${latest.by === "user" ? "the user in the editor" : "the model"}. Read it with get_poster and start from it.`,
          { current_revision: meta.revision, by: latest.by },
        );
      }
      return this.write({ ...meta, revision: meta.revision + 1, updated: new Date().toISOString() }, content, by);
    });
  }

  /**
   * Writes an exported file beside the poster, named after it, never over a file already
   * there — the person may have added to an earlier export in Word or PowerPoint.
   */
  async saveExport(id: string, extension: "docx" | "pptx", bytes: Uint8Array): Promise<string> {
    const meta = await this.readMeta(id);
    const stem = meta.file.slice(0, -POSTER_SUFFIX.length);
    return this.locked(`export:${stem}`, async () => {
      for (let n = 1; ; n++) {
        const name = n === 1 ? `${stem}.${extension}` : `${stem} (${n}).${extension}`;
        try {
          await fs.writeFile(this.inside(path.join(this.root, name)), bytes, { flag: "wx" });
          return name;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
    });
  }

  async list(): Promise<Array<{ id: string; title: string; revision: number; file: string; updated: string }>> {
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(this.root, HISTORY_DIR));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const posters = [];
    for (const id of entries) {
      if (!POSTER_ID.test(id)) continue;
      try {
        const meta = await this.readMeta(id);
        posters.push({ id, title: meta.title, revision: meta.revision, file: meta.file, updated: meta.updated });
      } catch {
        // A folder without a readable meta.json is not a poster.
      }
    }
    return posters.sort((a, b) => b.updated.localeCompare(a.updated));
  }
}
