/**
 * Plannings on disk: one directory per owner, one per planning, one file per revision.
 *
 *     <dataDir>/<sha256(owner)>/<planning id>/meta.json
 *                                            /1.json, 2.json, …
 *
 * Each revision file is a complete structured-exchange document, so any of them opens
 * in pi-outpost as it is, and a backup is a copy of the directory. The owner's
 * directory is named by a hash of the user id, so an identifier Open WebUI forwards
 * never becomes a path; planning ids are generated here and checked against a fixed
 * pattern before they are joined to one.
 *
 * Writes cannot tear and cannot overwrite history. A revision file is created with
 * `wx`, so a number is never written twice; `meta.json` is replaced by writing a
 * temporary file and renaming it over the old one. Changes to one planning — and the
 * creations of one owner, which are counted against a ceiling — are serialised by an
 * in-process lock, which is enough because one process owns the directory.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PlanningServerConfig } from "./config.ts";
import { judgePlanning, nameEveryItem, type TimelineDocument } from "./planning.ts";

export interface PlanningMeta {
  id: string;
  title: string;
  revision: number;
  created: string;
  updated: string;
}

export interface PlanningRevision {
  id: string;
  title: string;
  revision: number;
  current: number;
  document: TimelineDocument;
}

/** A refusal the caller can show as it is: what went wrong, and why. */
export class PlanningRefusal extends Error {
  constructor(
    readonly status: 404 | 409 | 413 | 422,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const PLANNING_ID = /^pl_[A-Za-z0-9_-]{16}$/;

export function notFound(id: string): PlanningRefusal {
  // Identical for an unknown id and for another user's planning: existence is not disclosed.
  return new PlanningRefusal(404, `no planning "${id}"`);
}

function titleOf(document: TimelineDocument): string {
  return document.data.title?.trim() || "Untitled planning";
}

async function writeAtomically(file: string, content: string): Promise<void> {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temporary, content, { flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export class PlanningStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly config: Pick<PlanningServerConfig, "dataDir" | "maxPlanningBytes" | "maxRevisions" | "maxPlanningsPerUser">) {}

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

  private ownerDir(owner: string): string {
    return path.join(this.config.dataDir, createHash("sha256").update(owner).digest("hex"));
  }

  private planningDir(owner: string, id: string): string {
    if (!PLANNING_ID.test(id)) throw notFound(id);
    return path.join(this.ownerDir(owner), id);
  }

  private async readMeta(owner: string, id: string): Promise<PlanningMeta> {
    const file = path.join(this.planningDir(owner, id), "meta.json");
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as PlanningMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound(id);
      throw error;
    }
  }

  private async readRevision(owner: string, id: string, revision: number): Promise<TimelineDocument | undefined> {
    const file = path.join(this.planningDir(owner, id), `${revision}.json`);
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as TimelineDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  /** The judged document, or a refusal carrying the diagnostics. */
  judge(candidate: unknown): { document: TimelineDocument; serialized: string } {
    const verdict = judgePlanning(candidate, this.config.maxPlanningBytes);
    if (!verdict.valid) {
      const tooLarge = verdict.issues.find((issue) => issue.rule === "planning-too-large");
      throw new PlanningRefusal(tooLarge ? 413 : 422, tooLarge ? tooLarge.message : "the planning was refused", { issues: verdict.issues });
    }
    return verdict;
  }

  async list(owner: string): Promise<PlanningMeta[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.ownerDir(owner));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const metas: PlanningMeta[] = [];
    for (const entry of entries) {
      if (!PLANNING_ID.test(entry)) continue;
      try {
        metas.push(await this.readMeta(owner, entry));
      } catch (error) {
        if (!(error instanceof PlanningRefusal)) throw error;
      }
    }
    return metas.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async create(owner: string, candidate: unknown): Promise<PlanningRevision> {
    const { document, serialized } = this.judge(nameEveryItem(candidate));
    return this.locked(`owner:${owner}`, async () => {
      const existing = await this.list(owner);
      if (existing.length >= this.config.maxPlanningsPerUser) {
        throw new PlanningRefusal(422, `you already have ${existing.length} plannings, this server's ceiling`, {
          limit: this.config.maxPlanningsPerUser,
        });
      }
      const id = `pl_${randomBytes(12).toString("base64url")}`;
      const dir = this.planningDir(owner, id);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "1.json"), serialized, { flag: "wx" });
      const now = new Date().toISOString();
      const meta: PlanningMeta = { id, title: titleOf(document), revision: 1, created: now, updated: now };
      await writeAtomically(path.join(dir, "meta.json"), JSON.stringify(meta));
      return { id, title: meta.title, revision: 1, current: 1, document };
    });
  }

  async get(owner: string, id: string, revision?: number): Promise<PlanningRevision> {
    const meta = await this.readMeta(owner, id);
    const wanted = revision ?? meta.revision;
    const document = Number.isInteger(wanted) && wanted >= 1 && wanted <= meta.revision ? await this.readRevision(owner, id, wanted) : undefined;
    if (!document) {
      throw new PlanningRefusal(404, `planning "${id}" has no revision ${wanted}; its current revision is ${meta.revision}`, {
        current: meta.revision,
      });
    }
    return { id, title: titleOf(document), revision: wanted, current: meta.revision, document };
  }

  /**
   * Stores `next(current document)` as a new revision, if `baseRevision` is still the
   * current one. `next` may throw a refusal; nothing is written then.
   */
  async revise(
    owner: string,
    id: string,
    baseRevision: number,
    next: (current: TimelineDocument) => unknown,
  ): Promise<PlanningRevision> {
    return this.locked(`planning:${owner}:${id}`, async () => {
      const meta = await this.readMeta(owner, id);
      if (baseRevision !== meta.revision) {
        throw new PlanningRefusal(409, `planning "${id}" is at revision ${meta.revision}, not ${baseRevision}: read it again before changing it`, {
          current: meta.revision,
        });
      }
      if (meta.revision >= this.config.maxRevisions) {
        throw new PlanningRefusal(422, `planning "${id}" already has ${meta.revision} revisions, this server's ceiling`, {
          limit: this.config.maxRevisions,
        });
      }
      const current = await this.readRevision(owner, id, meta.revision);
      if (!current) throw notFound(id);
      const { document, serialized } = this.judge(next(structuredClone(current)));
      const revision = meta.revision + 1;
      const dir = this.planningDir(owner, id);
      await fs.writeFile(path.join(dir, `${revision}.json`), serialized, { flag: "wx" });
      const updated: PlanningMeta = { ...meta, title: titleOf(document), revision, updated: new Date().toISOString() };
      await writeAtomically(path.join(dir, "meta.json"), JSON.stringify(updated));
      return { id, title: updated.title, revision, current: revision, document };
    });
  }
}

