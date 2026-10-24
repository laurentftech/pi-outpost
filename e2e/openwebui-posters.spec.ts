/**
 * The poster embed as Open WebUI 0.12.3 draws it: the tool server's real show_poster page,
 * from its own routes in this process, in a srcdoc frame sandboxed exactly as Open WebUI
 * sandboxes a tool's embed (ToolCallDisplay → FullHeightIframe) — `allow-scripts
 * allow-popups allow-downloads`, plus `allow-same-origin` when the user turned on "iframe
 * Sandbox Allow Same Origin". Checked live on Open WebUI itself on 2026-10-24.
 */
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
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
let app: ReturnType<typeof buildApp>;
let webUiOrigin: string;
let apiOrigin: string;
let posterId: string;
let webUiServer: Server;

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not reserve a local port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test.beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "owui-posters-e2e-"));
  const apiPort = await freePort();
  apiOrigin = `http://127.0.0.1:${apiPort}`;
  webUiServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Open WebUI test host</title>");
  });
  await new Promise<void>((resolve, reject) => webUiServer.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = webUiServer.address();
  if (!address || typeof address === "string") throw new Error("could not start local Open WebUI test host");
  webUiOrigin = `http://127.0.0.1:${address.port}`;
  const config = {
    host: "127.0.0.1", port: apiPort, secret: "s", identity: "headers" as const, identityKey: undefined,
    publicUrl: apiOrigin, webUiOrigin, dataDir,
    maxPlanningBytes: 1_000_000, maxRevisions: 500, maxPlanningsPerUser: 200, templatesDir: undefined,
    maxFileBytes: 5 * 1024 * 1024, maxImageBytes: 1024 * 1024, maxDocuments: 20, documentDays: 30,
  };
  app = buildApp(config, planningRoutes(new PlanningStore(config), config));
  await app.listen({ host: config.host, port: config.port });
  close = async () => {
    await app.close();
    await new Promise<void>((resolve, reject) => webUiServer.close((error) => error ? reject(error) : resolve()));
  };
  posterId = (await call("create_poster", { title: "Class rules", html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format })).json().id;
  page = (await call("show_poster", { id: posterId })).body;
});

function call(tool: string, body: unknown) {
  return app.inject({ method: "POST", url: `/${tool}`, headers: { authorization: "Bearer s", "x-openwebui-user-id": "u" }, payload: body as object });
}

test.afterAll(async () => {
  await close?.();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

async function embed(tab: Page, sandbox: string, hostOrigin = webUiOrigin) {
  const requests: string[] = [];
  await tab.goto(hostOrigin);
  await tab.setContent(`<!doctype html><body style="margin:0"><iframe id="embed" sandbox="${sandbox}" style="width:1000px;height:900px;border:0"></iframe></body>`);
  tab.on("request", (request) => {
    if (!/^(data|blob|about):/.test(request.url())) requests.push(request.url());
  });
  await tab.evaluate((html) => ((document.getElementById("embed") as HTMLIFrameElement).srcdoc = html), page);
  const frame = tab.frameLocator("#embed");
  await expect(frame.locator('button[data-action="word"]')).toBeVisible({ timeout: 30_000 });
  return { frame, requests };
}

async function themedEmbed(tab: Page, sandbox: string, dark: boolean) {
  await tab.goto(webUiOrigin);
  await tab.setContent(`<!doctype html><html class="${dark ? "dark" : ""}"><body style="margin:0"><iframe id="embed" sandbox="${sandbox}" style="width:1000px;height:900px;border:0"></iframe></body></html>`);
  await tab.locator("#embed").evaluate((frame, html) => ((frame as HTMLIFrameElement).srcdoc = html), page);
  const frame = tab.frameLocator("#embed");
  await expect(frame.locator(".poster-shell")).toBeVisible({ timeout: 30_000 });
  return frame;
}

// openlore: scenario=TheDefaultSandboxStillShowsThePoster spec=openwebui-posters
// openlore: scenario=TheLimitIsSaid spec=openwebui-posters
test("TheDefaultSandboxStillShowsThePoster: read-only, the setting named, the limit said, no save", async ({ page: tab }) => {
  const { frame } = await embed(tab, DEFAULT_SANDBOX);
  await expect(frame.locator(".poster-readonly")).toBeVisible();
  await expect(frame.locator("iframe.gjs-frame")).toHaveCount(0);
  await expect(frame.locator(".poster-notice")).toContainText("iframe Sandbox Allow Same Origin");
  await expect(frame.locator(".poster-notice")).toContainText("iframe Sandbox Allow Same Origin");
  await expect(frame.locator('button[data-action="save"]')).toBeHidden();
});

// openlore: scenario=TheEditorAppearsInTheChat spec=openwebui-posters
// openlore: scenario=TheModelStartsFromTheSavedTouchUps spec=openwebui-posters
test("TheEditorAppearsInTheChat: saves a revision that the model reads", async ({ page: tab }) => {
  const { frame } = await embed(tab, SAME_ORIGIN_SANDBOX);
  const title = frame.frameLocator("iframe.gjs-frame").locator(".rule.c1 h2");
  await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
  await title.click();
  await title.dblclick();
  await tab.keyboard.press("ControlOrMeta+A");
  await tab.keyboard.type("Edited in the embed");
  await frame.frameLocator("iframe.gjs-frame").locator(".motto").click();
  await expect(title).toHaveText("Edited in the embed");
  const save = frame.locator('button[data-action="save"]');
  await expect(save).toBeVisible();
  await expect(save).toBeEnabled();
  let releaseSave!: () => void;
  let markSaveStarted!: () => void;
  const held = new Promise<void>((resolve) => { releaseSave = resolve; });
  const started = new Promise<void>((resolve) => { markSaveStarted = resolve; });
  await tab.route(`${apiOrigin}/poster-save`, async (route) => {
    markSaveStarted();
    await held;
    await route.continue();
  });
  await save.click();
  await started;
  await title.click();
  await title.dblclick();
  await tab.keyboard.press("ControlOrMeta+A");
  await tab.keyboard.type("A newer unsaved edit");
  await frame.frameLocator("iframe.gjs-frame").locator(".motto").click();
  await expect(frame.locator(".poster-status")).toContainText("Unsaved changes.");
  releaseSave();
  await expect(frame.locator(".poster-status")).toContainText("Saved as a new version", { timeout: 15_000 });
  await expect(frame.locator(".poster-status")).toContainText("Newer changes are still unsaved");
  const saved = await call("get_poster", { id: posterId });
  expect(saved.json().revision).toBe(2);
  expect(saved.json().html).toContain("Edited in the embed");
  expect(saved.json().html).not.toContain("A newer unsaved edit");
  await expect(frame.locator('button[data-action="save"]')).toBeEnabled();
  await tab.unroute(`${apiOrigin}/poster-save`);
});

// openlore: scenario=AStaleEmbedCannotOverwriteANewerRevision spec=openwebui-posters
test("A stale embed cannot overwrite the saved version", async ({ page: tab }) => {
  const { frame } = await embed(tab, SAME_ORIGIN_SANDBOX);
  const title = frame.frameLocator("iframe.gjs-frame").locator(".rule.c1 h2");
  await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
  await title.click();
  await title.dblclick();
  await tab.keyboard.press("ControlOrMeta+A");
  await tab.keyboard.type("Stale edit");
  await frame.frameLocator("iframe.gjs-frame").locator(".motto").click();
  await frame.locator('button[data-action="save"]').click();
  await expect(frame.locator(".poster-status")).toContainText("out of date", { timeout: 15_000 });
  const saved = await call("get_poster", { id: posterId });
  expect(saved.json().revision).toBe(2);
  expect(saved.json().html).toContain("Edited in the embed");
  expect(saved.json().html).not.toContain("Stale edit");
  await expect(frame.locator('button[data-action="save"]')).toBeEnabled();
});

// openlore: scenario=ADifferentOriginCannotSave spec=openwebui-posters
test("A different browser origin cannot save through an embed capability", async ({ page: tab }) => {
  const { frame } = await embed(tab, SAME_ORIGIN_SANDBOX, apiOrigin);
  const title = frame.frameLocator("iframe.gjs-frame").locator(".rule.c1 h2");
  await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
  await title.click();
  await title.dblclick();
  await tab.keyboard.press("ControlOrMeta+A");
  await tab.keyboard.type("Wrong origin edit");
  await frame.frameLocator("iframe.gjs-frame").locator(".motto").click();
  await frame.locator('button[data-action="save"]').click();
  await expect(frame.locator(".poster-status")).toContainText("origin is not allowed", { timeout: 15_000 });
  const saved = await call("get_poster", { id: posterId });
  expect(saved.json().revision).toBe(2);
  expect(saved.json().html).not.toContain("Wrong origin edit");
  await expect(frame.locator('button[data-action="save"]')).toBeEnabled();
});

// openlore: scenario=DarkOpenWebUIOnALightSystem spec=openwebui-embed-theme
// openlore: scenario=TheUserSwitchesOpenWebUIsTheme spec=openwebui-embed-theme
test("Poster theme follows Open WebUI when readable and preserves poster colours", async ({ page: tab }) => {
  await tab.emulateMedia({ colorScheme: "light" });
  const frame = await themedEmbed(tab, SAME_ORIGIN_SANDBOX, true);
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  const editorFrame = frame.frameLocator("iframe.gjs-frame");
  const posterColor = await editorFrame.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
  await tab.locator("html").evaluate((element) => element.classList.remove("dark"));
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await editorFrame.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(posterColor);
});

// openlore: scenario=TheDefaultFrameFollowsTheSystem spec=openwebui-embed-theme
test("Poster default sandbox follows system theme changes", async ({ page: tab }) => {
  await tab.emulateMedia({ colorScheme: "light" });
  const frame = await themedEmbed(tab, DEFAULT_SANDBOX, false);
  await expect(frame.locator(".poster-readonly")).toBeVisible();
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  await tab.emulateMedia({ colorScheme: "dark" });
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
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
