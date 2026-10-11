/**
 * The file editor (CodeMirror) driven destructively in the running bench: in the embed's
 * Shadow DOM under hostile host CSS and in the plain app, with edit/done spammed, a file
 * switched mid-edit, find in edit mode, a split Markdown draft, a file deleted under the
 * editor, and the dark theme.
 *
 *   npm run bench            (in another terminal)
 *   node --import tsx/esm scripts/probes/bench-code-editor.mts <bench workspace>
 */
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const [workspace, host = "http://127.0.0.1:4321", server = "http://127.0.0.1:4322"] = process.argv.slice(2);
if (!workspace) throw new Error("usage: bench-code-editor.mts <bench workspace> [host url] [server url]");
await writeFile(path.join(workspace, "code", "doomed.ts"), "export const doomed = true;\n");
await writeFile(path.join(workspace, "code", "notes.md"), "# Notes\n\nSome text.\n");

const browser = await chromium.launch();
const seen: Record<string, unknown> = {};
const errors: string[] = [];

async function openFile(page: Page, name: string) {
  await page.getByText(name, { exact: true }).click();
}

try {
  // 1. Inside the embed: Shadow DOM, hostile CSS.
  {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(`embed: ${error}`));
    await page.goto(`${host}/?server=${encodeURIComponent(server)}&theme=light`);
    await page.getByTitle("Show files").first().click();
    await page.getByText("code", { exact: true }).first().click();
    await openFile(page, "example.tsx");
    await page.getByRole("button", { name: "✎ edit" }).click();
    const editor = page.locator(".cm-editor").first();
    await editor.waitFor();
    seen.embed = await editor.evaluate((element) => {
      const content = element.querySelector(".cm-content")!;
      const keyword = element.querySelector(".tok-keyword");
      const gutter = element.querySelector(".cm-gutters");
      return {
        inShadowRoot: element.getRootNode() instanceof ShadowRoot,
        // CodeMirror's base theme reached the shadow root: the editor is a flex column.
        baseThemeApplied: getComputedStyle(element).display === "flex",
        gutterShown: gutter !== null && (gutter as HTMLElement).offsetWidth > 10,
        keywordColour: keyword ? getComputedStyle(keyword).color : null,
        textColour: getComputedStyle(content).color,
        fontFamily: getComputedStyle(content).fontFamily,
      };
    });
    await page.screenshot({ path: path.join(workspace, "editor-embed.png") });
    await page.close();
  }

  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(`app: ${error}`));
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(server);
  await page.getByTitle("Show files").click();
  await page.getByText("code", { exact: true }).click();

  // 2. edit/done spammed.
  await openFile(page, "example.tsx");
  for (let index = 0; index < 8; index++) {
    await page.getByRole("button", { name: "✎ edit" }).click();
    await page.getByRole("button", { name: "done", exact: true }).click();
  }
  seen.afterSpam = { editors: await page.locator(".cm-editor").count(), editButton: await page.getByRole("button", { name: "✎ edit" }).count() };

  // 3. Typing, then switching file with the draft unsaved (the confirm is accepted).
  await page.getByRole("button", { name: "✎ edit" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n// unsaved");
  await openFile(page, "doomed.ts");
  await page.waitForTimeout(500);
  seen.switchedMidEdit = { editors: await page.locator(".cm-editor").count(), heading: await page.locator("header, [data-testid=file-viewer-header]").first().innerText().catch(() => "") };

  // 4. Find in edit mode, on a match far down the file.
  await openFile(page, "example.tsx");
  await page.getByRole("button", { name: "✎ edit" }).click();
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("cancelled = true");
  await page.waitForTimeout(400);
  seen.findInEdit = await page.locator(".cm-editor").evaluate((element) => {
    const selection = element.querySelector(".cm-selectionBackground");
    const scroller = element.querySelector(".cm-scroller")!;
    return { selectionDrawn: selection !== null, scrolled: scroller.scrollTop > 0 };
  });
  (seen.findInEdit as Record<string, unknown>).count = await page.getByRole("search").innerText();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "done", exact: true }).click();

  // 5. The file deleted on disk while edited, then saved.
  await openFile(page, "doomed.ts");
  await page.getByRole("button", { name: "✎ edit" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("// edited ");
  await rm(path.join(workspace, "code", "doomed.ts"));
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(800);
  seen.deletedThenSaved = {
    editorStillOpen: (await page.locator(".cm-editor").count()) === 1,
    message: await page.locator(".text-red-600, .text-amber-700, [role=alert]").allInnerTexts(),
    fileBack: await import("node:fs/promises").then((fs) => fs.readFile(path.join(workspace, "code", "doomed.ts"), "utf8")).catch(() => "(absent)"),
  };
  await page.screenshot({ path: path.join(workspace, "editor-deleted.png") });
  await page.getByRole("button", { name: /done|cancel/ }).click();

  // 6. A Markdown draft in the split mode follows the editor.
  await openFile(page, "notes.md");
  await page.getByRole("button", { name: /split/ }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n## Typed heading\n");
  await page.waitForTimeout(500);
  seen.splitFollows = {
    heading: await page.getByTestId("file-split-rendering").getByRole("heading", { name: "Typed heading" }).count(),
    rendering: await page.getByTestId("file-split-rendering").innerText().catch(() => "(no split)"),
    draft: await page.locator(".cm-line").allTextContents(),
  };
  await page.screenshot({ path: path.join(workspace, "editor-split.png") });

  // 7. Dark theme.
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  seen.dark = await page.locator(".cm-editor").evaluate((element) => ({
    text: getComputedStyle(element.querySelector(".cm-content")!).color,
    gutter: getComputedStyle(element.querySelector(".cm-gutters")!).backgroundColor,
    heading: getComputedStyle(element.querySelector(".tok-heading") ?? element).color,
  }));
  await page.screenshot({ path: path.join(workspace, "editor-dark.png") });
} finally {
  seen.errors = errors;
  console.log(JSON.stringify(seen, null, 2));
  await browser.close();
}
