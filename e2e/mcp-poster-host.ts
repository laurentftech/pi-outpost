/**
 * The posters extension's editor as an MCP Apps host draws it, shared by the specs that drive
 * it: the real server in this process, its `ui://` view in a frame sandboxed as the MCP Apps
 * specification says (`allow-scripts allow-same-origin`; GrapesJS draws in a nested frame it
 * must reach), and the SDK's AppBridge relaying the view's tool calls and recording what it
 * asks the host.
 *
 * Needs the view built (`npm run build:viewer-poster --workspace @pi-outpost/mcp`).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { POSTER_EXAMPLE } from "@pi-outpost/posters/guide";
import { createPosterServer, viewUriFor } from "../mcp/src/posters/server.ts";
import { LocalPosterStore } from "../mcp/src/posters/store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEW_FILE = path.join(HERE, "..", "mcp", "dist", "viewer-poster", "poster.html");
const SAME_ORIGIN = "allow-scripts allow-same-origin";

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

export interface Shown {
  view: FrameLocator;
  canvas: FrameLocator;
}

export interface PosterHost {
  /** The folder the server keeps posters and exports in. */
  folder(): string;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** A poster made from the guide's example, or from the content given. */
  createPoster(title: string, content?: { html: string; css: string; format?: string }): Promise<string>;
  /**
   * Shows `id` in a fresh host page, as Claude Desktop would after the model called show_poster.
   * `sandbox` defaults to the MCP Apps one; without same-origin the poster is shown read-only.
   */
  show(page: Page, id: string, theme?: "light" | "dark", sandbox?: string): Promise<Shown>;
}

export function json(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content.map((block) => block.text ?? "").join("")) as Record<string, unknown>;
}

/** Starts the posters server once for the spec that calls it, and stops it after. */
export function usePosterHost(): PosterHost {
  let hostScript: string;
  let folder: string;
  let client: Client;
  let viewHtml: string;

  test.beforeAll(async () => {
    const bundled = await build({ entryPoints: [path.join(HERE, "mcp-host", "host.ts")], bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent" });
    hostScript = bundled.outputFiles[0]!.text;
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-posters-e2e-"));
    viewHtml = await fs.readFile(VIEW_FILE, "utf8");
    const server = createPosterServer({ store: await LocalPosterStore.open(folder), viewHtml });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: "e2e", version: "1" });
    await client.connect(clientSide);
  });

  test.afterAll(async () => {
    await client?.close();
    if (folder) await fs.rm(folder, { recursive: true, force: true });
  });

  const callTool = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult;

  return {
    folder: () => folder,
    callTool,
    async createPoster(title, content) {
      const { html, css, format } = { format: POSTER_EXAMPLE.format, ...(content ?? POSTER_EXAMPLE) };
      return json(await callTool("create_poster", { title, html, css, format })).id as string;
    },
    async show(page, id, theme = "light", sandbox = SAME_ORIGIN) {
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => callTool(params.name, params.arguments ?? {}));
      await page.setContent(`<!doctype html><body style="margin:0;background:${theme === "dark" ? "#1f1f1f" : "#fff"}"><script>${hostScript}</script></body>`);
      const { contents } = await client.readResource({ uri: viewUriFor(viewHtml) });
      const html = (contents[0] as { text: string }).text;
      const toolResult = await callTool("show_poster", { id });
      expect(toolResult.isError).toBeFalsy();
      await page.evaluate(
        ({ html: view, toolResult: result, theme: hostTheme, sandbox }) => window.startHost({ html: view, toolInput: {}, toolResult: result as never, theme: hostTheme, downloadFile: true, sandbox }),
        { html, toolResult, theme, sandbox },
      );
      // Claude's conversation column is about this wide.
      await page.evaluate(() => ((document.getElementById("view") as HTMLIFrameElement).style.width = "1000px"));
      const view = page.frameLocator("#view");
      const canvas = view.frameLocator("iframe.gjs-frame");
      if (sandbox !== SAME_ORIGIN) {
        await expect(view.locator(".poster-status")).toContainText("read-only", { timeout: 20_000 });
        return { view, canvas };
      }
      await expect(canvas.locator('[data-gjs-type="wrapper"] > *').first()).toBeVisible({ timeout: 20_000 });
      await expect(view.locator(".poster-status")).toContainText("Double-click a text");
      await pageAtRest(view);
      return { view, canvas };
    },
  };
}

/**
 * Waits until the page stops moving. Widening the view above refits the page a frame or
 * more later, and a click aimed while it still moves lands beside its target: on the CI
 * runner a card's colour change went to no card at all.
 */
export async function pageAtRest(view: FrameLocator) {
  const frame = view.locator("iframe.gjs-frame");
  let last = "";
  await expect
    .poll(
      async () => {
        const box = await frame.boundingBox();
        const now = JSON.stringify(box && [box.x, box.y, box.width, box.height].map(Math.round));
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [150], timeout: 10_000 },
    )
    .toBe(true);
}

export const hostLog = (page: Page) => page.evaluate(() => window.hostLog as Array<{ method: string; params: Record<string, unknown> }>);

/** The canvas frame itself, to evaluate in: the one frame holding the poster's page. */
export async function canvasFrame(page: Page) {
  for (const frame of page.frames()) {
    if (await frame.evaluate(() => document.querySelector('[data-gjs-type="wrapper"] > *') !== null).catch(() => false)) return frame;
  }
  throw new Error("no canvas frame holds the poster");
}

/** Replaces the text of `selector` as the person would: select, double-click, type, click away on `away`. */
export async function rewrite(page: Page, canvas: FrameLocator, selector: string, text: string, away = ".motto") {
  const target = canvas.locator(selector);
  await target.click();
  await target.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
  // Leaving the text ends the edit.
  await canvas.locator(away).click();
}
