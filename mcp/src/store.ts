/**
 * Plannings in the folder the person chose: one readable file per planning, its history
 * hidden beside it.
 *
 *     <folder>/Travaux maison.planning.json          the current document, pretty-printed
 *     <folder>/.history/travaux-maison/1.json …      every revision, written once
 *     <folder>/.history/travaux-maison/meta.json     id, title, revision, file name, dates
 *
 * The planning file is what the person sees, opens, copies and backs up: a complete
 * structured-exchange document that pi-outpost opens as it is. The history is what
 * updates and comparisons need, kept out of a casual listing.
 *
 * The id is a slug of the title at creation, and the file name the title itself, made
 * safe; both are fixed then, so renaming a planning does not move its file. Every path
 * written is checked to resolve inside the folder.
 *
 * The file can be edited by hand, so it is judged each time it is read. A valid edit is
 * the current document; an invalid one is reported with the gate's diagnostics, and an
 * update then starts from the last revision in history and keeps a copy of the edited
 * file there, so nothing the person wrote is lost. A file deleted from the folder
 * removes the planning from the listing; its history stays.
 *
 * The folder stays the person's: a planning file renamed there is found again by its
 * content, and a timeline file put there is adopted as a planning (see `reconcile`).
 *
 * Writes are serialised in-process: the host runs one server per folder.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { StructuredExchangeIssue } from "@pi-outpost/shared/structured-exchange/parse";
import { judgePlanning, nameEveryItem, type TimelineDocument } from "@pi-outpost/apps-core/planning";

export const HISTORY_DIR = ".history";
export const PLANNING_SUFFIX = ".planning.json";
/** A ceiling on one planning, far above any real one: a guard, not a quota. */
export const MAX_PLANNING_BYTES = 1_000_000;
/** A ceiling on a saved figure: a timeline's SVG is tens of kilobytes. */
export const MAX_FIGURE_BYTES = 5_000_000;

const PLANNING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const MAX_FILE_STEM_LENGTH = 80;
// Names Windows refuses for a file, whatever the extension.
const RESERVED_STEM = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export interface PlanningMeta {
  id: string;
  title: string;
  revision: number;
  /** The planning file's name in the folder, fixed at creation. */
  file: string;
  created: string;
  updated: string;
}

export interface PlanningRevision {
  id: string;
  title: string;
  file: string;
  revision: number;
  current: number;
  document: TimelineDocument;
  /** The current file was changed outside the server since its last revision, and is valid. */
  editedOutside?: true;
  /** The current file was changed outside the server into an invalid document; `document` is the last revision. */
  invalidFile?: StructuredExchangeIssue[];
}

export interface PlanningListing {
  id: string;
  title: string;
  revision: number;
  file: string;
  updated: string;
  /** Set when the file no longer holds a valid planning. */
  unreadable?: StructuredExchangeIssue[];
}

/** A refusal written for the model: what went wrong, and what to do. Nothing was changed. */
export class PlanningRefusal extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function notFound(id: string): PlanningRefusal {
  return new PlanningRefusal(
    `no planning "${id}". Nothing was shown — do not tell the user it was. Planning ids come from the answers of create_planning or list_plannings: use one of those, after it has answered.`,
  );
}

function titleOf(document: TimelineDocument): string {
  return document.data.title?.trim() || "Untitled planning";
}

/** `Travaux maison` → `travaux-maison`: lower case, no accents, words joined by dashes. */
export function slugOf(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_ID_LENGTH - 4)
    .replace(/^-+|-+$/g, "");
  return slug || "planning";
}

/**
 * The title as a file name stem: separators, `..`, control and reserved characters
 * removed, length capped. What is left can only name a file directly in the folder.
 */
export function fileStemOf(title: string): string {
  const stem = title
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, MAX_FILE_STEM_LENGTH)
    .trim();
  if (!stem) return "Planning";
  return RESERVED_STEM.test(stem) ? `Planning ${stem}` : stem;
}

/** The text a revision is stored as, in history and in the planning file: the document as given, indented. */
function textOf(serialized: string): string {
  return `${JSON.stringify(JSON.parse(serialized), null, 2)}\n`;
}

/** A visible JSON file directly in the folder: what a planning file can be called, once renamed. */
function isPlanningFileName(name: string): boolean {
  return name.endsWith(".json") && !name.startsWith(".");
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

type FileState =
  | { state: "missing" }
  | { state: "valid"; document: TimelineDocument }
  | { state: "invalid"; issues: StructuredExchangeIssue[]; raw: string };

export class LocalPlanningStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  private constructor(readonly root: string) {}

  /** The store over `root`, an absolute folder, created if it does not exist. */
  static async open(root: string): Promise<LocalPlanningStore> {
    const resolved = path.resolve(root);
    await fs.mkdir(resolved, { recursive: true });
    return new LocalPlanningStore(resolved);
  }

  /** Runs `work` after every earlier holder of `key` has finished. */
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
      throw new Error(`refusing a path outside the plannings folder: ${resolved}`);
    }
    return resolved;
  }

  private historyDir(id: string): string {
    if (id.length > MAX_ID_LENGTH || !PLANNING_ID.test(id)) throw notFound(id);
    return this.inside(path.join(this.root, HISTORY_DIR, id));
  }

  private planningFile(meta: PlanningMeta): string {
    // meta.json is ours, but it sits in a folder the person can edit: check it anyway.
    if (path.basename(meta.file) !== meta.file || !isPlanningFileName(meta.file)) {
      throw new PlanningRefusal(`planning "${meta.id}" names an unusable file, "${meta.file}"`);
    }
    return this.inside(path.join(this.root, meta.file));
  }

  /**
   * `<stem><suffix>`, or `<stem> (n)<suffix>` with the first free n: free regardless of
   * case, as on macOS and Windows, so a folder copied or synced there never collides.
   */
  private async freeName(stem: string, suffix: string): Promise<string> {
    const taken = new Set((await fs.readdir(this.root)).map((name) => name.normalize("NFC").toLowerCase()));
    const free = (name: string) => !taken.has(name.normalize("NFC").toLowerCase());
    let name = `${stem}${suffix}`;
    for (let n = 2; !free(name); n += 1) name = `${stem} (${n})${suffix}`;
    return name;
  }

  private async writeAtomically(file: string, content: string): Promise<void> {
    const target = this.inside(file);
    const temporary = this.inside(path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`));
    await fs.writeFile(temporary, content, { flag: "wx" });
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  private async readMeta(id: string): Promise<PlanningMeta> {
    const file = path.join(this.historyDir(id), "meta.json");
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as PlanningMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound(id);
      throw error;
    }
  }

  private async readHistory(id: string, revision: number): Promise<TimelineDocument | undefined> {
    const file = path.join(this.historyDir(id), `${revision}.json`);
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as TimelineDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  /** The planning file, judged by the gate as it is now. */
  private async readPlanningFile(meta: PlanningMeta): Promise<FileState> {
    let raw: string;
    try {
      raw = await fs.readFile(this.planningFile(meta), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { state: "invalid", raw, issues: [{ rule: "not-json", path: "", message: `the file is not JSON: ${(error as Error).message}` }] };
    }
    const verdict = judgePlanning(parsed, MAX_PLANNING_BYTES);
    return verdict.valid ? { state: "valid", document: verdict.document } : { state: "invalid", raw, issues: verdict.issues };
  }

  private removed(meta: PlanningMeta): PlanningRefusal {
    return new PlanningRefusal(
      `the file "${meta.file}" of planning "${meta.id}" is no longer in the plannings folder: it was removed, or renamed and changed. Tell the user; its earlier revisions are kept in the folder's hidden ${HISTORY_DIR} folder.`,
    );
  }

  /** The judged document and the text it is stored as, or a refusal carrying the diagnostics. */
  judge(candidate: unknown): { document: TimelineDocument; text: string } {
    const verdict = judgePlanning(candidate, MAX_PLANNING_BYTES);
    if (!verdict.valid) throw new PlanningRefusal("the planning was refused", { issues: verdict.issues });
    return { document: verdict.document, text: textOf(verdict.serialized) };
  }

  /**
   * Saves an exported figure beside the plannings, as `<stem>.svg`, never over an
   * existing file. Returns the file name used.
   */
  async saveFigure(fileName: string, svg: string): Promise<string> {
    if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg)) throw new PlanningRefusal("only an SVG figure can be saved");
    if (Buffer.byteLength(svg, "utf8") > MAX_FIGURE_BYTES) throw new PlanningRefusal("the figure is too large to save");
    const stem = fileStemOf(fileName.replace(/\.svg$/i, ""));
    return this.locked("folder", async () => {
      const name = await this.freeName(stem, ".svg");
      await fs.writeFile(this.inside(path.join(this.root, name)), svg, { flag: "wx" });
      return name;
    });
  }

  /** Every planning's meta in history, skipping what cannot be read. */
  private async allMetas(): Promise<PlanningMeta[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(this.root, HISTORY_DIR));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const metas: PlanningMeta[] = [];
    for (const entry of entries) {
      if (entry.length > MAX_ID_LENGTH || !PLANNING_ID.test(entry)) continue;
      try {
        metas.push(await this.readMeta(entry));
      } catch (error) {
        if (error instanceof PlanningRefusal || error instanceof SyntaxError) continue;
        throw error;
      }
    }
    return metas;
  }

  /**
   * Brings the history in line with the folder, which is the person's:
   * - a planning whose file is gone follows an unclaimed file holding exactly its current
   *   revision — the file was renamed;
   * - any other unclaimed file holding a valid timeline is adopted as a new planning, its
   *   file left as it is.
   * Nothing else is touched: other files are not plannings, and a planning whose file is
   * gone without trace keeps its history and is no longer listed.
   */
  private async reconcile(): Promise<void> {
    await this.locked("folder", async () => {
      const metas = await this.allMetas();
      const claimed = new Set(metas.map((meta) => meta.file.normalize("NFC")));
      const orphans: Array<{ meta: PlanningMeta; text: string }> = [];
      for (const meta of metas) {
        if (await exists(this.planningFile(meta))) continue;
        const current = await this.readHistory(meta.id, meta.revision);
        if (current) orphans.push({ meta, text: JSON.stringify(current) });
      }
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !isPlanningFileName(entry.name) || claimed.has(entry.name.normalize("NFC"))) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(await fs.readFile(this.inside(path.join(this.root, entry.name)), "utf8"));
        } catch {
          continue;
        }
        const verdict = judgePlanning(parsed, MAX_PLANNING_BYTES);
        if (!verdict.valid) continue;
        const renamed = orphans.findIndex((orphan) => orphan.text === JSON.stringify(verdict.document));
        if (renamed >= 0) {
          const { meta } = orphans.splice(renamed, 1)[0]!;
          await this.writeAtomically(path.join(this.historyDir(meta.id), "meta.json"), `${JSON.stringify({ ...meta, file: entry.name }, null, 2)}\n`);
          continue;
        }
        const title = titleOf(verdict.document);
        const base = slugOf(title);
        let id = base;
        for (let n = 2; await exists(this.historyDir(id)); n += 1) id = `${base}-${n}`;
        const dir = this.historyDir(id);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "1.json"), textOf(verdict.serialized), { flag: "wx" });
        const now = new Date().toISOString();
        const meta: PlanningMeta = { id, title, revision: 1, file: entry.name, created: now, updated: now };
        await this.writeAtomically(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
      }
    });
  }

  /** The planning file as it is now, after looking for it once more if it is not where it was. */
  private async locate(id: string): Promise<{ meta: PlanningMeta; file: FileState }> {
    let meta = await this.readMeta(id);
    let file = await this.readPlanningFile(meta);
    if (file.state === "missing") {
      await this.reconcile();
      meta = await this.readMeta(id);
      file = await this.readPlanningFile(meta);
    }
    return { meta, file };
  }

  /** Every planning whose file is in the folder, the most recently changed first. */
  async list(): Promise<PlanningListing[]> {
    await this.reconcile();
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(this.root, HISTORY_DIR));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const listings: PlanningListing[] = [];
    for (const entry of entries) {
      if (entry.length > MAX_ID_LENGTH || !PLANNING_ID.test(entry)) continue;
      let meta: PlanningMeta;
      try {
        meta = await this.readMeta(entry);
      } catch (error) {
        if (error instanceof PlanningRefusal || error instanceof SyntaxError) continue;
        throw error;
      }
      const file = await this.readPlanningFile(meta);
      if (file.state === "missing") continue;
      listings.push({
        id: meta.id,
        title: file.state === "valid" ? titleOf(file.document) : meta.title,
        revision: meta.revision,
        file: meta.file,
        updated: meta.updated,
        ...(file.state === "invalid" ? { unreadable: file.issues } : {}),
      });
    }
    return listings.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async create(candidate: unknown): Promise<PlanningRevision> {
    const { document, text } = this.judge(nameEveryItem(candidate));
    return this.locked("folder", async () => {
      const title = titleOf(document);
      const base = slugOf(title);
      let id = base;
      for (let n = 2; await exists(this.historyDir(id)); n += 1) id = `${base}-${n}`;
      const stem = fileStemOf(title);
      const file = await this.freeName(stem, PLANNING_SUFFIX);

      const dir = this.historyDir(id);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "1.json"), text, { flag: "wx" });
      const now = new Date().toISOString();
      const meta: PlanningMeta = { id, title, revision: 1, file, created: now, updated: now };
      await this.writeAtomically(this.planningFile(meta), text);
      await this.writeAtomically(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
      return { id, title, file, revision: 1, current: 1, document };
    });
  }

  async get(id: string, revision?: number): Promise<PlanningRevision> {
    const { meta, file } = await this.locate(id);
    const wanted = revision ?? meta.revision;
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > meta.revision) {
      throw new PlanningRefusal(`planning "${id}" has no revision ${wanted}; its current revision is ${meta.revision}`, { current: meta.revision });
    }
    const recorded = await this.readHistory(id, wanted);
    if (!recorded) throw new PlanningRefusal(`planning "${id}" has lost its revision ${wanted} from history`, { current: meta.revision });
    const answer = { id, file: meta.file, revision: wanted, current: meta.revision };
    if (wanted !== meta.revision) return { ...answer, title: titleOf(recorded), document: recorded };

    if (file.state === "missing") throw this.removed(meta);
    if (file.state === "invalid") return { ...answer, title: titleOf(recorded), document: recorded, invalidFile: file.issues };
    const edited = JSON.stringify(file.document) !== JSON.stringify(recorded);
    return { ...answer, title: titleOf(file.document), document: file.document, ...(edited ? { editedOutside: true as const } : {}) };
  }

  /**
   * Stores `next(current document)` as a new revision, if `baseRevision` is still the
   * current one. `next` may throw; nothing is written then.
   */
  async revise(id: string, baseRevision: number, next: (current: TimelineDocument) => unknown): Promise<PlanningRevision> {
    return this.locked(`planning:${id}`, async () => {
      const { meta, file } = await this.locate(id);
      if (baseRevision !== meta.revision) {
        throw new PlanningRefusal(`planning "${id}" is at revision ${meta.revision}, not ${baseRevision}: read it again before changing it`, {
          current: meta.revision,
        });
      }
      if (file.state === "missing") throw this.removed(meta);
      let current: TimelineDocument | undefined;
      if (file.state === "valid") current = file.document;
      else current = await this.readHistory(id, meta.revision);
      if (!current) throw new PlanningRefusal(`planning "${id}" has lost its revision ${meta.revision} from history`);

      const { document, text } = this.judge(next(structuredClone(current)));
      const revision = meta.revision + 1;
      const dir = this.historyDir(id);
      if (file.state === "invalid") {
        // The person's edit is replaced by this revision; keep it, as they wrote it.
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await fs.writeFile(path.join(dir, `edited-before-${revision}-${stamp}.txt`), file.raw, { flag: "wx" });
      }
      await fs.writeFile(path.join(dir, `${revision}.json`), text, { flag: "wx" });
      const updated: PlanningMeta = { ...meta, title: titleOf(document), revision, updated: new Date().toISOString() };
      await this.writeAtomically(this.planningFile(updated), text);
      await this.writeAtomically(path.join(dir, "meta.json"), `${JSON.stringify(updated, null, 2)}\n`);
      return { id, title: updated.title, file: updated.file, revision, current: revision, document };
    });
  }
}
