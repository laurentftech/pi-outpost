/**
 * The poster embed as Open WebUI 0.12.3 draws it: the tool server's real show_poster page,
 * from its own routes in this process, in a srcdoc frame sandboxed exactly as Open WebUI
 * sandboxes a tool's embed (ToolCallDisplay → FullHeightIframe) — `allow-scripts
 * allow-popups allow-downloads`, plus `allow-same-origin` when the user turned on "iframe
 * Sandbox Allow Same Origin". Checked live on Open WebUI itself on 2026-10-24.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { POSTER_EXAMPLE } from "@pi-outpost/posters/guide";
import { buildApp } from "../openwebui/src/app.ts";
import { planningRoutes } from "../openwebui/src/routes.ts";
import { PlanningStore } from "../openwebui/src/store.ts";

const DEFAULT_SANDBOX = "allow-scripts allow-popups allow-downloads";
const SAME_ORIGIN_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-downloads";

let page: string;
let dataDir: string;
let close: () => Promise<void>;

test.beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "owui-posters-e2e-"));
  const config = {
    host: "127.0.0.1", port: 0, secret: "s", identity: "headers" as const, identityKey: undefined, dataDir,
    maxPlanningBytes: 1_000_000, maxRevisions: 500, maxPlanningsPerUser: 200, templatesDir: undefined,
    maxFileBytes: 5 * 1024 * 1024, maxImageBytes: 1024 * 1024, maxDocuments: 20, documentDays: 30,
  };
  const app = buildApp(config, planningRoutes(new PlanningStore(config), config));
  close = () => app.close();
  const call = (tool: string, body: unknown) => app.inject({ method: "POST", url: `/${tool}`, headers: { authorization: "Bearer s", "x-openwebui-user-id": "u" }, payload: body as object });
  const { id } = (await call("create_poster", { title: "Class rules", html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format })).json();
  page = (await call("show_poster", { id })).body;
});

test.afterAll(async () => {
  await close?.();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

async function embed(tab: Page, sandbox: string) {
  const requests: string[] = [];
  tab.on("request", (request) => {
    if (!/^(data|blob|about):/.test(request.url())) requests.push(request.url());
  });
  await tab.setContent(`<!doctype html><body style="margin:0"><iframe id="embed" sandbox="${sandbox}" style="width:1000px;height:900px;border:0"></iframe></body>`);
  await tab.evaluate((html) => ((document.getElementById("embed") as HTMLIFrameElement).srcdoc = html), page);
  const frame = tab.frameLocator("#embed");
  await expect(frame.locator('button[data-action="word"]')).toBeVisible({ timeout: 30_000 });
  return { frame, requests };
}

// openlore: scenario=TheDefaultSandboxStillShowsThePoster spec=openwebui-posters
// openlore: scenario=TheLimitIsSaid spec=openwebui-posters
test("TheDefaultSandboxStillShowsThePoster: read-only, the setting named, the limit said, no save", async ({ page: tab }) => {
  const { frame } = await embed(tab, DEFAULT_SANDBOX);
  await expect(frame.locator(".poster-readonly")).toBeVisible();
  await expect(frame.locator("iframe.gjs-frame")).toHaveCount(0);
  await expect(frame.locator(".poster-notice")).toContainText("Your changes stay in this page");
  await expect(frame.locator(".poster-notice")).toContainText("iframe Sandbox Allow Same Origin");
  await expect(frame.locator('button[data-action="save"]')).toBeHidden();
});

// openlore: scenario=TheEditorAppearsInTheChat spec=openwebui-posters
test("TheEditorAppearsInTheChat: with the setting on, the editor runs on the poster, still with no save", async ({ page: tab }) => {
  const { frame } = await embed(tab, SAME_ORIGIN_SANDBOX);
  const title = frame.frameLocator("iframe.gjs-frame").locator(".rule.c1 h2");
  await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
  await title.click();
  await title.dblclick();
  await tab.keyboard.press("ControlOrMeta+A");
  await tab.keyboard.type("Edited in the embed");
  await expect(title).toHaveText("Edited in the embed");
  await expect(frame.locator('button[data-action="save"]')).toBeHidden();
  await expect(frame.locator(".poster-notice")).toContainText("Your changes stay in this page");
});

// openlore: scenario=AWordFileFromTheEmbed spec=openwebui-posters
for (const [name, sandbox] of [["the default sandbox", DEFAULT_SANDBOX], ["the same-origin setting", SAME_ORIGIN_SANDBOX]] as const) {
  test(`AWordFileFromTheEmbed, under ${name}: Office files named after the poster, and no request to the tool server`, async ({ page: tab }) => {
    const { frame, requests } = await embed(tab, sandbox);
    for (const [action, file] of [["word", "Class rules.docx"], ["powerpoint", "Class rules.pptx"]] as const) {
      const download = tab.waitForEvent("download", { timeout: 30_000 });
      await frame.locator(`button[data-action="${action}"]`).click();
      const got = await download;
      expect(got.suggestedFilename()).toBe(file);
      expect((await fs.readFile((await got.path())!)).readUInt32LE(0)).toBe(0x04034b50);
    }
    // The page was set by hand: any request at all would be the embed reaching out.
    expect(requests).toEqual([]);
  });
}
