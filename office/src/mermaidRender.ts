/**
 * Mermaid diagrams as pictures, drawn without a browser.
 *
 * Mermaid runs in a worker thread (`mermaidWorker.ts`), which gives it a jsdom window
 * and text measured with a canvas; this side keeps that worker, hands it one diagram
 * at a time, and draws the raster behind the vector.
 *
 * The raster is drawn from Mermaid's styled SVG (see `svgRaster.ts`): resvg applies its
 * stylesheet, markers and baselines, where a canvas lost every arrowhead.
 *
 * A diagram that does not parse, does not finish in time, or cannot be drawn is an
 * error, never a blank picture: the caller decides what the document does about it.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { DiagramImage } from "@pi-outpost/shared/docx";
import type { MermaidReply, MermaidRequest } from "./mermaidWorker.ts";
import { RasterError, rasterizeSvg } from "./svgRaster.ts";

/** Raised for a diagram that cannot be drawn; the message is Mermaid's own when it has one. */
export class MermaidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MermaidError";
  }
}

/** The longest source drawn: a diagram longer than this is not a figure for a page. */
export const MAX_MERMAID_CHARS = 50_000;

/**
 * The font the text is measured in and drawn with. Both sides must see the same
 * face, or labels are sized for one font and drawn in another; the first family
 * this machine has wins, on both sides.
 */
export const DEFAULT_MERMAID_FONT = '"DejaVu Sans", Helvetica, Arial, sans-serif';

/** The worker's module when running from source; a bundle passes its own (`MermaidRendererOptions.workerUrl`). */
export function defaultMermaidWorkerUrl(): URL {
  return new URL("./mermaidWorker.ts", import.meta.url);
}

/** What the worker loads that cannot be bundled: two native packages and jsdom. */
const RUNTIME_PACKAGES = ["jsdom", "@napi-rs/canvas", "@resvg/resvg-js"];

/**
 * Why Mermaid cannot be drawn by this installation, or `undefined` when it can.
 *
 * Not every build carries the renderer: the single-file executable has no worker file
 * to start, and an install may lack a native package. A caller asks first and keeps
 * its behaviour without diagrams, rather than failing every diagram one by one.
 */
export function mermaidUnavailable(workerUrl: URL = defaultMermaidWorkerUrl()): string | undefined {
  try {
    if (workerUrl.protocol === "file:" && !existsSync(fileURLToPath(workerUrl))) return "this installation does not include the diagram renderer";
    const resolve = createRequire(workerUrl);
    for (const name of RUNTIME_PACKAGES) {
      try {
        resolve.resolve(name);
      } catch {
        return `${name} is not installed`;
      }
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export interface MermaidRendererOptions {
  /** The worker's module. The default suits running from source; a bundle passes its own. */
  workerUrl?: URL;
  font?: string;
  /** How long one diagram may take before its worker is stopped. */
  timeoutMs?: number;
}

export interface MermaidRenderer {
  render(source: string): Promise<DiagramImage>;
  close(): Promise<void>;
}

export function createMermaidRenderer(options: MermaidRendererOptions = {}): MermaidRenderer {
  const workerUrl = options.workerUrl ?? defaultMermaidWorkerUrl();
  const font = options.font ?? DEFAULT_MERMAID_FONT;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let worker: Worker | undefined;
  let nextId = 0;
  // Mermaid keeps global state; one diagram at a time.
  let queue: Promise<unknown> = Promise.resolve();

  const spawn = (): Worker => {
    if (worker !== undefined) return worker;
    const created = new Worker(workerUrl);
    // A worker that is only waiting must not keep the process alive.
    created.unref();
    created.on("exit", () => {
      if (worker === created) worker = undefined;
    });
    worker = created;
    return created;
  };

  const draw = (source: string): Promise<{ svg: string; styled: string; width: number; height: number }> => {
    const id = ++nextId;
    const current = spawn();
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        current.off("message", onMessage);
        current.off("error", onError);
        current.off("exit", onExit);
      };
      const onMessage = (reply: MermaidReply) => {
        if (reply.id !== id) return;
        finish();
        if ("error" in reply) reject(new MermaidError(reply.error));
        else resolve(reply);
      };
      const onError = (error: Error) => {
        finish();
        reject(new MermaidError(`the diagram renderer failed: ${error.message}`));
      };
      const onExit = () => {
        finish();
        reject(new MermaidError("the diagram renderer stopped"));
      };
      const timer = setTimeout(() => {
        finish();
        // Stopped rather than left running: a diagram that does not finish keeps
        // the thread busy for every diagram after it.
        if (worker === current) worker = undefined;
        void current.terminate();
        reject(new MermaidError(`the diagram took longer than ${Math.round(timeoutMs / 1000)} s to draw`));
      }, timeoutMs);
      current.on("message", onMessage);
      current.on("error", onError);
      current.on("exit", onExit);
      current.postMessage({ id, source, font } satisfies MermaidRequest);
    });
  };

  const rasterize = (styled: string): Uint8Array => {
    try {
      return rasterizeSvg(styled, font);
    } catch (error) {
      if (error instanceof RasterError) throw new MermaidError(`the diagram's ${error.message.replace(/^the /, "")}`);
      throw error;
    }
  };

  return {
    render(source) {
      if (source.trim() === "") return Promise.reject(new MermaidError("the diagram is empty"));
      if (source.length > MAX_MERMAID_CHARS) return Promise.reject(new MermaidError(`the diagram is longer than ${MAX_MERMAID_CHARS} characters`));
      const result = queue.then(async () => {
        const drawn = await draw(source);
        return { svg: drawn.svg, png: rasterize(drawn.styled), width: drawn.width, height: drawn.height } satisfies DiagramImage;
      });
      queue = result.catch(() => undefined);
      return result;
    },
    async close() {
      const current = worker;
      worker = undefined;
      if (current !== undefined) await current.terminate();
    },
  };
}
