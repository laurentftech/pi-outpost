/**
 * The agent, in the running app, asked for an impact analysis of two versions of a
 * cahier des charges that carry no tracked changes (change docx-compare-with-word, 4.2).
 *
 * Drives the page with Playwright, waits on the session transcript rather than the page,
 * then reads the transcript back: which tools were called, with what, and what the
 * agent answered.
 *
 *   node --import tsx/esm scripts/probes/make-cahier-des-charges.mts <project>
 *   (start the server on <project>, sandboxed, on <port>)
 *   node --import tsx/esm scripts/probes/docx-compare-agent.mts <project> <port>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const [project, port = "4410"] = process.argv.slice(2);
if (!project) throw new Error("usage: docx-compare-agent.mts <project> [port]");
const prompt =
  "Le client nous a envoyé une nouvelle version du cahier des charges, sans suivi des modifications : " +
  "cahier-des-charges-v1.docx (l'ancienne) et cahier-des-charges-v2.docx (la nouvelle). " +
  "Fais l'analyse d'impact : qu'est-ce qui a changé, dans quelles sections, et qu'est-ce que ça implique pour nous ?";

const sessions = path.join(os.homedir(), ".pi", "agent", "sessions");
const started = Date.now();
/** The newest transcript written since this run started. */
function transcript(): string | undefined {
  let newest: { file: string; mtime: number } | undefined;
  for (const dir of readdirSync(sessions)) {
    const full = path.join(sessions, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const name of readdirSync(full)) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(full, name);
      const mtime = statSync(file).mtimeMs;
      if (mtime >= started && (newest === undefined || mtime > newest.mtime)) newest = { file, mtime };
    }
  }
  return newest?.file;
}
type Entry = { type: string; message?: { role: string; content: Array<{ type: string; text?: string; name?: string; arguments?: unknown }>; stopReason?: string } };
const entries = (file: string): Entry[] => readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Entry);
function finished(file: string): boolean {
  const last = entries(file).filter((entry) => entry.type === "message" && entry.message?.role === "assistant").pop()?.message;
  if (last === undefined) return false;
  return last.stopReason === "error" || last.stopReason === "aborted" || !last.content.some((part) => part.type === "toolCall");
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await composer.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !(document.querySelector("textarea") as HTMLTextAreaElement | null)?.disabled, undefined, { timeout: 120_000 });
  await composer.fill(prompt);
  await composer.press("Enter");

  let file: string | undefined;
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    file ??= transcript();
    if (file !== undefined && finished(file)) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (file === undefined) throw new Error("no transcript was written");
  console.log(`transcript: ${file} (${((Date.now() - started) / 1000).toFixed(0)} s)`);

  for (const entry of entries(file)) {
    if (entry.type !== "message" || entry.message === undefined) continue;
    const { role, content, stopReason } = entry.message;
    for (const part of content) {
      if (part.type === "toolCall") console.log(`\n[${role} → ${part.name}] ${JSON.stringify(part.arguments)}`);
      else if (part.type === "text" && role === "toolResult") console.log(`\n[tool result] ${part.text!.slice(0, 600)}${part.text!.length > 600 ? " …" : ""}`);
      else if (part.type === "text" && role === "assistant") console.log(`\n[assistant${stopReason ? `, ${stopReason}` : ""}]\n${part.text}`);
    }
  }
  // What the page shows of it: the tool cards, by name.
  const cards = await page.locator("[data-tool-name]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tool-name")));
  console.log(`\ntool cards in the page: ${JSON.stringify(cards)}`);
} finally {
  await browser.close();
}
