/**
 * docx_create with a Mermaid diagram, asked of the real agent in the running bench
 * (`BENCH_LIVE=1 npm run bench`): one prompt, then the .docx the agent wrote is read
 * back from the workspace, and the tool's answer from the page.
 *
 *   node --import tsx/esm scripts/probes/live-docx-mermaid.mts <bench workspace> [server url]
 */
import { copyFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";

const [workspace, server = "http://127.0.0.1:4322"] = process.argv.slice(2);
if (!workspace) throw new Error("usage: live-docx-mermaid.mts <bench workspace> [server url]");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await copyFile(path.join(repo, "server/test/fixtures/docx-template.dotx"), path.join(workspace, "brand.dotx"));
const target = path.join(workspace, "process.docx");

const prompt =
  "Use docx_create with the template brand.dotx to write process.docx: a heading \"Release process\", one sentence, " +
  "then a Mermaid flowchart (as a ```mermaid fence in the Markdown) from Build to Test, a decision \"Tests pass?\", yes to Release, no back to Build. " +
  "Do not render it afterwards; just tell me what the tool answered.";

const browser = await chromium.launch();
const started = Date.now();
try {
  const page = await browser.newPage();
  await page.goto(server);
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await composer.waitFor({ timeout: 30_000 });
  await composer.fill(prompt);
  await page.keyboard.press("Enter");
  let written = false;
  while (!written && Date.now() - started < 300_000) {
    written = await stat(target).then(() => true, () => false);
    if (!written) await page.waitForTimeout(2000);
  }
  if (!written) throw new Error("the agent wrote no process.docx within five minutes");
  // The tool card and the reply, once the turn is over.
  await page.waitForTimeout(8000);
  const transcript = await page.locator("main").innerText().catch(() => "");
  const parts = readAllZipEntries(await readFile(target), { maxEntries: 500, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
  const media = [...parts.keys()].filter((name) => name.startsWith("word/media/"));
  const svg = media.find((name) => name.endsWith(".svg"));
  const shown = svg ? [...parts.get(svg)!.toString("utf8").matchAll(/>([^<]*)</g)].map((match) => match[1]).join(" ") : "";
  console.log(
    JSON.stringify(
      {
        seconds: Math.round((Date.now() - started) / 1000),
        media,
        labelsInTheVector: ["Build", "Test", "Tests pass?", "Release"].filter((label) => shown.includes(label)),
        sourceWrittenAsCode: /flowchart|graph (TD|LR)/.test(parts.get("word/document.xml")!.toString("utf8")),
        notesInThePage: transcript.match(/Note:[^\n]*/g) ?? [],
        mentionsMermaidSource: /written as (their|its) source/.test(transcript),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
