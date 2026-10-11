/**
 * The viewer's Word export of a Mermaid diagram, driven in the running bench: a Markdown
 * file with a flowchart is opened in the file viewer, exported with the button, and the
 * .docx the browser receives is read back.
 *
 * Checks what the shared SVG sizing (`shared/src/docx/svgSize.ts`) is for: the picture
 * in the file carries its own width and height, its styles written onto its elements,
 * and a PNG behind it.
 *
 *   npm run bench            (in another terminal; prints the workspace folder)
 *   node --import tsx/esm scripts/probes/bench-docx-mermaid.mts <bench workspace> [server url]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";

const [workspace, server = "http://127.0.0.1:4322"] = process.argv.slice(2);
if (!workspace) throw new Error("usage: bench-docx-mermaid.mts <bench workspace> [server url]");
await mkdir(path.join(workspace, "docs"), { recursive: true });
await writeFile(path.join(workspace, "docs", "flow.md"), "# Flow\n\n```mermaid\nflowchart LR\n  A[Ask] --> B{Clear?}\n  B -->|yes| C[Write]\n```\n");

const browser = await chromium.launch();
const errors: string[] = [];
try {
  const page = await browser.newPage();
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(server);
  await page.getByTitle("Show files").click();
  await page.getByText("docs", { exact: true }).click();
  await page.getByText("flow.md", { exact: true }).click();
  const button = page.getByRole("button", { name: /download as a word document/i }).first();
  await button.waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const bytes = await readFile((await download.path())!);
  const parts = readAllZipEntries(bytes, { maxEntries: 500, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
  const media = [...parts.keys()].filter((name) => name.startsWith("word/media/"));
  const svgName = media.find((name) => name.endsWith(".svg"));
  const svg = svgName ? parts.get(svgName)!.toString("utf8") : "";
  const root = /^[\s\S]*?<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  console.log(
    JSON.stringify(
      {
        file: download.suggestedFilename(),
        media,
        rootHasWidthAndHeight: /\swidth="[\d.]+"/.test(root) && /\sheight="[\d.]+"/.test(root),
        rootKeepsPercentWidth: /width="100%"/.test(root),
        stylesInlined: !/<style/.test(svg) && /\sfill="/.test(svg),
        labels: ["Ask", "Clear?", "yes", "Write"].filter((label) => [...svg.matchAll(/>([^<]*)</g)].map((match) => match[1]).join("").includes(label)),
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
