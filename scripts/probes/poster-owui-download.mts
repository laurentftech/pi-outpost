/**
 * Probe: ↓ word and ↓ powerpoint in an Open WebUI embed (he saw no Office file come out).
 * The real show_poster page, from the tool server's own routes in this process, in a
 * srcdoc frame sandboxed exactly as Open WebUI 0.12.3 draws tool embeds — with and without
 * the same-origin setting — then each download button clicked, and what came out reported.
 *
 * Run: node --import tsx scripts/probes/poster-owui-download.mts
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { buildApp } from "../../openwebui/src/app.ts";
import { planningRoutes } from "../../openwebui/src/routes.ts";
import { PlanningStore } from "../../openwebui/src/store.ts";
import { POSTER_EXAMPLE } from "../../posters/src/guide.ts";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "poster-owui-"));
const config = {
  host: "127.0.0.1", port: 0, secret: "s", identity: "headers" as const, identityKey: undefined, dataDir,
  maxPlanningBytes: 1_000_000, maxRevisions: 500, maxPlanningsPerUser: 200, templatesDir: undefined,
  maxFileBytes: 5 * 1024 * 1024, maxImageBytes: 1024 * 1024, maxDocuments: 20, documentDays: 30,
};
const app = buildApp(config, planningRoutes(new PlanningStore(config), config));
const call = (tool: string, body: unknown) => app.inject({ method: "POST", url: `/${tool}`, headers: { authorization: "Bearer s", "x-openwebui-user-id": "u" }, payload: body as object });
const { id } = (await call("create_poster", { title: "Class rules", html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format })).json();
const page = (await call("show_poster", { id })).body;

const browser = await chromium.launch();
for (const sandbox of ["allow-scripts allow-popups allow-downloads", "allow-scripts allow-same-origin allow-popups allow-downloads"]) {
  const context = await browser.newContext({ acceptDownloads: true });
  const tab = await context.newPage();
  const errors: string[] = [];
  tab.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(m.text()));
  tab.on("pageerror", (e) => errors.push(e.message));
  await tab.setContent(`<!doctype html><body style="margin:0"><iframe id="embed" sandbox="${sandbox}" style="width:1000px;height:900px;border:0"></iframe></body>`);
  await tab.evaluate((html) => ((document.getElementById("embed") as HTMLIFrameElement).srcdoc = html), page);
  const embed = tab.frameLocator("#embed");
  await embed.locator('button[data-action="word"]').waitFor({ timeout: 30_000 });
  await tab.waitForTimeout(1500);
  const results: Record<string, unknown> = {};
  for (const action of ["word", "powerpoint", "html"]) {
    const download = tab.waitForEvent("download", { timeout: 15_000 }).catch(() => undefined);
    await embed.locator(`button[data-action="${action}"]`).click();
    const file = await download;
    let head = "";
    if (file) head = (await fs.readFile((await file.path())!)).subarray(0, 4).toString("hex");
    results[action] = { name: file?.suggestedFilename() ?? "(no download)", head, status: await embed.locator(".poster-status").textContent() };
  }
  console.log(JSON.stringify({ sandbox, editable: await embed.locator(".gjs-frame").count() > 0, results, errors: errors.slice(0, 4) }, null, 1));
  await context.close();
}
await browser.close();
await app.close();
await fs.rm(dataDir, { recursive: true, force: true });
