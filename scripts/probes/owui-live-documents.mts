/**
 * The document tools in a real Open WebUI, with a real model: each request is typed into
 * the chat as a user would, the answer is read back through Open WebUI's API (tool calls
 * and reply), and the file is downloaded from the card the embed shows.
 *
 * Needs an Open WebUI started from openwebui/deploy/docker-compose.yml, an admin account,
 * and the pi-outpost tools attached to the model.
 *
 *   node --import tsx/esm scripts/probes/owui-live-documents.mts <base url> <email> <password> <model> <out dir> <request>...
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Frame } from "@playwright/test";

const [base, email, password, model, outDir, ...requests] = process.argv.slice(2);
if (!base || requests.length === 0) throw new Error("usage: owui-live-documents.mts <base url> <email> <password> <model> <out dir> <request>...");
mkdirSync(outDir!, { recursive: true });

const signin = await fetch(`${base}/api/v1/auths/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
const token = ((await signin.json()) as { token: string }).token;
const api = async (route: string) => (await fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${token}` } })).json();

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, locale: "fr-FR" });
await context.addInitScript((value) => localStorage.setItem("token", value), token);
const report: unknown[] = [];
try {
  for (const [index, request] of requests.entries()) {
    const page = await context.newPage();
    await page.goto(`${base}/?models=${encodeURIComponent(model!)}`);
    const input = page.locator("#chat-input");
    await input.waitFor({ timeout: 60_000 });
    // The release notes Open WebUI shows a new account cover the input.
    for (let attempt = 0; attempt < 5 && (await page.locator('[role="dialog"]').isVisible()); attempt++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
    await input.click();
    await page.keyboard.insertText(request);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/c\//, { timeout: 60_000 });
    const chatId = page.url().split("/c/")[1]!;

    // Done when the last assistant message says so.
    const started = Date.now();
    type Message = { role: string; content: string; done?: boolean };
    let last: Message | undefined;
    while (Date.now() - started < 300_000) {
      // The conversation is a tree: the message shown is history.currentId.
      const chat = (await api(`/api/v1/chats/${chatId}`)) as { chat: { history: { currentId: string; messages: Record<string, Message> } } };
      last = chat.chat.history.messages[chat.chat.history.currentId];
      if (last?.role === "assistant" && last.done === true) break;
      await page.waitForTimeout(3000);
    }
    const reply = last?.content ?? "";
    const toolCalls = [...reply.matchAll(/<details type="tool_calls"[^>]*name="([^"]+)"[^>]*arguments="([^"]*)"[^>]*>/g)].map(([, name, args]) => ({
      name,
      argumentsChars: args!.length,
    }));
    const results = [...reply.matchAll(/<details type="tool_calls"[^>]*name="([^"]+)"[^>]*result="([^"]*)"/g)].map(([, name, result]) => ({
      name,
      result: result!.replace(/&quot;/g, '"').replace(/&amp;/g, "&").slice(0, 400),
    }));
    const text = reply.replace(/<details[\s\S]*?<\/details>/g, "").trim();

    // The card, inside the sandboxed frame Open WebUI draws the embed in.
    await page.waitForTimeout(3000);
    const downloads: string[] = [];
    for (const frame of page.frames()) {
      const button = (frame as Frame).getByRole("button", { name: "Download" });
      if ((await button.count()) === 0) continue;
      for (let at = 0; at < (await button.count()); at++) {
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), button.nth(at).click()]);
        const file = path.join(outDir!, `${index + 1}-${download.suggestedFilename()}`);
        await download.saveAs(file);
        downloads.push(file);
      }
    }
    await page.screenshot({ path: path.join(outDir!, `${index + 1}-chat.png`), fullPage: true });
    report.push({ request, seconds: Math.round((Date.now() - started) / 1000), toolCalls, results, reply: text.slice(0, 1500), downloads });
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(outDir!, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
