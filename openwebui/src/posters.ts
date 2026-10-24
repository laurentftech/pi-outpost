/**
 * Posters on the Open WebUI tool server: the model composes them in HTML and CSS through
 * five tools, and the user retouches and exports them in an embed carrying the shared
 * poster editor (@pi-outpost/posters).
 *
 *     <dataDir>/posters/<sha256(owner)>/<poster id>/meta.json
 *                                                  /1.json, 2.json, …   { html, css, format, at }
 *
 * Kept as the plannings are: one directory per owner named by a hash of the user id, ids
 * generated here and checked against a fixed pattern, revisions written once (`wx`), the
 * meta replaced by rename, changes to one poster serialised in-process.
 *
 * Touch-ups made in the embed are not sent back: the user's browser has no route to this
 * server. The model's next change starts from the last version it wrote, and the embed
 * says so (openwebui-posters: TouchUpsStayInTheBrowser). A browser-reachable route with
 * short-lived signed tickets is the later change that would lift this.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import { FORMAT_NAMES, PosterRefusal as FormatRefusal, checkPoster, isPosterFormat, type PosterContent } from "@pi-outpost/posters/format";
import { POSTER_GUIDE } from "@pi-outpost/posters/guide";
// For request.owner, which app.ts declares on Fastify's requests: a program that reaches
// this file without app.ts (the MCP tests, through openapi.ts) would not know it.
import type {} from "./app.ts";
import type { PlanningServerConfig } from "./config.ts";
import { pack } from "./embed.ts";

export interface PosterMeta {
  id: string;
  title: string;
  revision: number;
  created: string;
  updated: string;
}

export interface PosterRevision extends PosterContent {
  id: string;
  title: string;
  revision: number;
  current: number;
}

export class PosterRefusal extends Error {
  readonly status: 404 | 409 | 413 | 422;
  readonly details: Record<string, unknown>;

  constructor(status: 404 | 409 | 413 | 422, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const POSTER_ID = /^po_[A-Za-z0-9_-]{16}$/;

function notFound(id: string): PosterRefusal {
  // The same for an unknown id and for another user's poster: existence is not disclosed.
  return new PosterRefusal(404, `no poster "${id}". Nothing was shown — do not tell the user it was. Poster ids come from the answers of create_poster or list_posters.`);
}

async function writeAtomically(file: string, content: string): Promise<void> {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await fsp.writeFile(temporary, content, { flag: "wx" });
  try {
    await fsp.rename(temporary, file);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

/** The format's own checks, as this server's refusals: 413 for size, 422 for the rest. */
function checked(content: PosterContent): PosterContent {
  try {
    return checkPoster(content);
  } catch (error) {
    if (error instanceof FormatRefusal) throw new PosterRefusal(/too large/.test(error.message) ? 413 : 422, error.message, error.details);
    throw error;
  }
}

export class PosterStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly config: Pick<PlanningServerConfig, "dataDir" | "maxRevisions" | "maxPlanningsPerUser">) {}

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
    return path.join(this.config.dataDir, "posters", createHash("sha256").update(owner).digest("hex"));
  }

  private posterDir(owner: string, id: string): string {
    if (!POSTER_ID.test(id)) throw notFound(id);
    return path.join(this.ownerDir(owner), id);
  }

  private async readMeta(owner: string, id: string): Promise<PosterMeta> {
    try {
      return JSON.parse(await fsp.readFile(path.join(this.posterDir(owner, id), "meta.json"), "utf8")) as PosterMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound(id);
      throw error;
    }
  }

  async list(owner: string): Promise<PosterMeta[]> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.ownerDir(owner));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const metas: PosterMeta[] = [];
    for (const entry of entries) {
      if (!POSTER_ID.test(entry)) continue;
      try {
        metas.push(await this.readMeta(owner, entry));
      } catch (error) {
        if (!(error instanceof PosterRefusal)) throw error;
      }
    }
    return metas.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async create(owner: string, title: string, content: PosterContent): Promise<PosterRevision> {
    checked(content);
    return this.locked(`owner:${owner}`, async () => {
      const existing = await this.list(owner);
      if (existing.length >= this.config.maxPlanningsPerUser) {
        throw new PosterRefusal(422, `you already have ${existing.length} posters, this server's ceiling`, { limit: this.config.maxPlanningsPerUser });
      }
      const id = `po_${randomBytes(12).toString("base64url")}`;
      const dir = this.posterDir(owner, id);
      await fsp.mkdir(dir, { recursive: true });
      const now = new Date().toISOString();
      await fsp.writeFile(path.join(dir, "1.json"), JSON.stringify({ ...content, at: now }), { flag: "wx" });
      const meta: PosterMeta = { id, title: title.trim() || "Poster", revision: 1, created: now, updated: now };
      await writeAtomically(path.join(dir, "meta.json"), JSON.stringify(meta));
      return { id, title: meta.title, revision: 1, current: 1, ...content };
    });
  }

  async get(owner: string, id: string, revision?: number): Promise<PosterRevision> {
    const meta = await this.readMeta(owner, id);
    const wanted = revision ?? meta.revision;
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > meta.revision) {
      throw new PosterRefusal(404, `poster "${id}" has no revision ${wanted}; its current revision is ${meta.revision}`, { current: meta.revision });
    }
    const stored = JSON.parse(await fsp.readFile(path.join(this.posterDir(owner, id), `${wanted}.json`), "utf8")) as PosterContent;
    return { id, title: meta.title, revision: wanted, current: meta.revision, html: stored.html, css: stored.css, format: stored.format };
  }

  /** A new revision from `baseRevision`, refused when another was written since. */
  async revise(owner: string, id: string, baseRevision: number, content: PosterContent): Promise<PosterRevision> {
    checked(content);
    return this.locked(`poster:${owner}:${id}`, async () => {
      const meta = await this.readMeta(owner, id);
      if (baseRevision !== meta.revision) {
        throw new PosterRefusal(409, `poster "${id}" is at revision ${meta.revision}, not ${baseRevision}: read it again with get_poster before changing it`, { current: meta.revision });
      }
      if (meta.revision >= this.config.maxRevisions) {
        throw new PosterRefusal(422, `poster "${id}" already has ${meta.revision} revisions, this server's ceiling`, { limit: this.config.maxRevisions });
      }
      const revision = meta.revision + 1;
      const now = new Date().toISOString();
      await fsp.writeFile(path.join(this.posterDir(owner, id), `${revision}.json`), JSON.stringify({ ...content, at: now }), { flag: "wx" });
      const updated: PosterMeta = { ...meta, revision, updated: now };
      await writeAtomically(path.join(this.posterDir(owner, id), "meta.json"), JSON.stringify(updated));
      return { id, title: meta.title, revision, current: revision, ...content };
    });
  }
}

/* ── The embed ─────────────────────────────────────────────────────────────── */

const POSTER_VIEWER_DIR = new URL("../dist/viewer-poster/", import.meta.url);

export interface PosterViewerAssets {
  script: string;
  style: string;
}

let cachedAssets: PosterViewerAssets | undefined;

/** The built poster viewer, read once. Missing means `npm run build:viewer` was not run. */
export function posterViewerAssets(): PosterViewerAssets {
  if (cachedAssets) return cachedAssets;
  const dir = fileURLToPath(POSTER_VIEWER_DIR);
  const css = fs.readdirSync(dir).find((name) => name.endsWith(".css"));
  cachedAssets = {
    script: fs.readFileSync(path.join(dir, "poster.js"), "utf8"),
    style: css ? fs.readFileSync(path.join(dir, css), "utf8") : "",
  };
  return cachedAssets;
}

/**
 * Inflates the payloads and runs the editor, as the planning embed's bootstrap does:
 * free of `&`, and of `<` after its opening tag. Its text is hashed into the page's
 * policy, so it must not change at run time.
 */
const POSTER_BOOTSTRAP = `
(function () {
  function inflate(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i !== bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }
  var p = document.getElementById("payload").dataset;
  Promise.all([inflate(p.style), inflate(p.poster), inflate(p.script)]).then(function (parts) {
    var style = document.createElement("style");
    style.textContent = parts[0];
    document.head.appendChild(style);
    var data = document.createElement("script");
    data.type = "application/json";
    data.id = "poster";
    data.textContent = parts[1];
    document.body.appendChild(data);
    var editor = document.createElement("script");
    editor.textContent = parts[2];
    document.body.appendChild(editor);
  }, function (error) {
    document.getElementById("root").textContent = "This poster could not be drawn: " + error;
  });
})();
`;

function hashOf(script: string): string {
  return `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;
}

/**
 * The embed's own policy (poster-editor design, decision 6). Open WebUI may allow its
 * frames the same origin, and a srcdoc frame then takes Open WebUI's: only the two scripts
 * this page carries may run — by their hashes, never 'unsafe-inline', which would let a
 * poster's event attributes run — and nothing is fetched. GrapesJS's canvas inherits it.
 */
export function posterEmbedPolicy(assets: PosterViewerAssets): string {
  return [
    "default-src 'none'",
    `script-src ${hashOf(POSTER_BOOTSTRAP)} ${hashOf(assets.script)}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function posterEmbedPage(poster: PosterRevision, assets: PosterViewerAssets = posterViewerAssets()): string {
  const embedded = { id: poster.id, title: poster.title, revision: poster.revision, html: poster.html, css: poster.css, format: poster.format };
  return [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${posterEmbedPolicy(assets)}"></head><body>`,
    '<div id="root"></div>',
    `<div id="payload" hidden data-style="${pack(assets.style)}" data-script="${pack(assets.script)}" data-poster="${pack(JSON.stringify(embedded))}"></div>`,
    `<script>${POSTER_BOOTSTRAP}</script>`,
    "</body></html>",
  ].join("");
}

/* ── The tools ─────────────────────────────────────────────────────────────── */

export const LIST_POSTERS_DESCRIPTION = "Lists the user's posters: id, title, revision, last change. Use an id from here with get_poster, update_poster or show_poster.";
export const CREATE_POSTER_DESCRIPTION = `Creates a poster, a worksheet, a slide or any one-page visual for the user, kept on this server. Then call show_poster so the user sees it: they can retouch it there and download it for Word (to print) or PowerPoint (to show). Their touch-ups stay in their browser: you do not see them.\n\n${POSTER_GUIDE}`;
export const GET_POSTER_DESCRIPTION = "Reads a poster's markup and stylesheet as you last wrote them, with its revision. Read it before changing it. The user's touch-ups in the embed are not here: they stay in their browser.";
export const UPDATE_POSTER_DESCRIPTION = `Replaces a poster's markup and stylesheet with a new version made from the revision you read with get_poster, then call show_poster. If the user describes changes they made in the embed, make them here too.\n\n${POSTER_GUIDE}`;
export const SHOW_POSTER_DESCRIPTION = "Shows a poster to the user in the conversation, in an editor where they can correct texts, move pictograms, change colours, and download it for Word or PowerPoint. You do not see it.";

const idProperty = { type: "string", description: "The poster's id, from create_poster or list_posters." };
const contentProperties = {
  html: { type: "string", description: "The poster's markup: the content of one page, without <html>, <head> or <body>." },
  css: { type: "string", description: "The poster's stylesheet." },
  format: { type: "string", enum: [...FORMAT_NAMES], description: "The paper format, or slide-16:9 for a poster to project." },
};

function operation(operationId: string, summary: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    post: {
      operationId,
      summary,
      description,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties, required } } } },
      responses: { "200": { description: "OK" } },
    },
  };
}

/** The five poster operations, for the server's OpenAPI description. */
export function posterOperations() {
  return {
    "/list_posters": operation("list_posters", "List the user's posters", LIST_POSTERS_DESCRIPTION, {}, []),
    "/create_poster": operation("create_poster", "Create a poster", CREATE_POSTER_DESCRIPTION, { title: { type: "string", description: "The poster's title." }, ...contentProperties }, ["title", "html", "css", "format"]),
    "/get_poster": operation("get_poster", "Read a poster", GET_POSTER_DESCRIPTION, { id: idProperty, revision: { type: "integer", description: "An earlier revision; the latest when omitted." } }, ["id"]),
    "/update_poster": operation(
      "update_poster",
      "Change a poster",
      UPDATE_POSTER_DESCRIPTION,
      { id: idProperty, base_revision: { type: "integer", description: "The revision you read with get_poster." }, ...contentProperties },
      ["id", "base_revision", "html", "css", "format"],
    ),
    "/show_poster": operation("show_poster", "Show a poster to the user", SHOW_POSTER_DESCRIPTION, { id: idProperty }, ["id"]),
  };
}

function refuse(reply: FastifyReply, error: unknown) {
  if (error instanceof PosterRefusal) return reply.code(error.status).send({ error: error.message, ...error.details });
  throw error;
}

function contentOf(body: Record<string, unknown> | undefined): PosterContent {
  const { html, css, format } = body ?? {};
  if (typeof html !== "string" || typeof css !== "string") throw new PosterRefusal(422, "html and css are required: the poster's markup and its stylesheet, as text");
  if (!isPosterFormat(format)) throw new PosterRefusal(422, `format is required, one of: ${FORMAT_NAMES.join(", ")}`, { formats: FORMAT_NAMES });
  return { html, css, format };
}

function answer(poster: PosterRevision) {
  return { id: poster.id, title: poster.title, revision: poster.revision, current_revision: poster.current, format: poster.format };
}

export function registerPosterRoutes(app: FastifyInstance, store: PosterStore): void {
  app.post("/list_posters", async (request) => ({ posters: (await store.list(request.owner)).map(({ id, title, revision, updated }) => ({ id, title, revision, updated })) }));

  app.post<{ Body: Record<string, unknown> }>("/create_poster", async (request, reply) => {
    try {
      const title = request.body?.title;
      if (typeof title !== "string" || title.trim() === "") throw new PosterRefusal(422, "title is required: the poster's title");
      return answer(await store.create(request.owner, title, contentOf(request.body)));
    } catch (error) {
      return refuse(reply, error);
    }
  });

  app.post<{ Body: { id?: unknown; revision?: unknown } }>("/get_poster", async (request, reply) => {
    try {
      const { id, revision } = request.body ?? {};
      if (typeof id !== "string") throw new PosterRefusal(422, "id is required: the poster's identifier, from list_posters");
      if (revision !== undefined && revision !== null && !Number.isInteger(revision)) throw new PosterRefusal(422, "revision, when given, is a revision number");
      const found = await store.get(request.owner, id, typeof revision === "number" ? revision : undefined);
      return { ...answer(found), html: found.html, css: found.css };
    } catch (error) {
      return refuse(reply, error);
    }
  });

  app.post<{ Body: Record<string, unknown> }>("/update_poster", async (request, reply) => {
    try {
      const { id, base_revision: base } = request.body ?? {};
      if (typeof id !== "string") throw new PosterRefusal(422, "id is required: the poster's identifier, from list_posters");
      if (!Number.isInteger(base)) throw new PosterRefusal(422, "base_revision is required: the revision you read with get_poster");
      return answer(await store.revise(request.owner, id, base as number, contentOf(request.body)));
    } catch (error) {
      return refuse(reply, error);
    }
  });

  app.post<{ Body: { id?: unknown } }>("/show_poster", async (request, reply) => {
    try {
      const id = request.body?.id;
      if (typeof id !== "string") throw new PosterRefusal(422, "id is required: the poster's identifier, from list_posters");
      const poster = await store.get(request.owner, id);
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Disposition", "inline")
        .header("Access-Control-Expose-Headers", "Content-Disposition")
        .send(posterEmbedPage(poster));
    } catch (error) {
      return refuse(reply, error);
    }
  });
}
