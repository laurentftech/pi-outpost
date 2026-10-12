/**
 * The file viewer's Edit mode as a code editor (CodeMirror), driven with the keyboard
 * as somebody edits: numbered lines, colours as typed, brackets closed and matched,
 * Tab, several cursors, undo — and Ctrl+S saving without leaving the editor, CRLF kept.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SOURCE = "const answer = 42;\n// a comment\nfunction ask() {\n  return answer;\n}\n";

async function openEditor(page: Page, name: string, content = SOURCE) {
  const directory = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, "editor");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await writeFile(file, content);
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("editor", { exact: true }).click();
  await page.getByText(name, { exact: true }).click();
  await page.getByRole("button", { name: "✎ edit" }).click();
  const editor = page.getByTestId("file-editor");
  const content_ = editor.locator(".cm-content");
  await expect(content_).toBeFocused();
  return { file, editor, content: content_ };
}

/** The draft as the editor shows it: one `.cm-line` per line (the files here are short enough to be drawn whole). */
const text = (page: Page) => page.getByTestId("file-editor").locator(".cm-line").allTextContents().then((lines) => lines.join("\n"));

// openlore: scenario=TheEditorNumbersAndColoursLines spec=file
test("TheEditorNumbersAndColoursLines: numbers, colours as typed, brackets, Tab, several cursors and undo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const { editor, content } = await openEditor(page, "numbers.ts");
  // Five lines and the empty one after the last newline.
  await expect(editor.locator(".cm-lineNumbers .cm-gutterElement:not([style*='visibility: hidden'])")).toHaveText(["1", "2", "3", "4", "5", "6"]);
  const keyword = editor.locator(".tok-keyword").first();
  await expect(keyword).toHaveText("const");
  const plainColour = await content.evaluate((element) => getComputedStyle(element).color);
  expect(await keyword.evaluate((element) => getComputedStyle(element).color)).not.toBe(plainColour);
  await expect(editor.locator(".tok-comment")).toHaveText("// a comment");

  // Typed text is coloured as it arrives; a bracket is closed as it is opened.
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("let typed = 'yes';");
  await expect(editor.locator(".tok-string").last()).toHaveText("'yes'");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ask(");
  await expect(editor.locator(".cm-activeLine")).toHaveText("ask()");
  // The cursor sits between the pair, which is shown matched.
  await expect(editor.locator(".cm-matchingBracket")).toHaveCount(2);
  await page.keyboard.press("End");

  // Tab types the file's own unit (two spaces here); Shift+Tab takes it back.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("x");
  expect((await text(page)).endsWith("ask()\n  x")).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect((await text(page)).endsWith("ask()\nx")).toBe(true);

  // Several cursors: select "answer", Ctrl+D adds the next one, typing renames both.
  // Double click selects the word, Ctrl+D the next occurrence.
  await editor.locator(".cm-line").first().getByText("answer").dblclick();
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.type("reply");
  expect(await text(page)).toContain("const reply = 42;");
  expect(await text(page)).toContain("return reply;");

  // Undo takes the rename back.
  await page.keyboard.press("ControlOrMeta+z");
  expect(await text(page)).toContain("return answer;");

  // A long line wraps and keeps one number.
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(`const long = "${"word ".repeat(80)}";`);
  const lines = (await text(page)).split("\n").length;
  const numbers = await editor.locator(".cm-lineNumbers .cm-gutterElement:not([style*='visibility: hidden'])").allTextContents();
  expect(numbers.at(-1)).toBe(String(lines));
  const lastLine = editor.locator(".cm-line").last();
  const box = await lastLine.boundingBox();
  const first = await editor.locator(".cm-line").first().boundingBox();
  expect(box!.height).toBeGreaterThan(first!.height * 2);
  expect(errors).toEqual([]);
});

// openlore: scenario=SavingKeepsTheEditorOpen spec=file
test("SavingKeepsTheEditorOpen: Ctrl+S writes the file and stays in the editor; done leaves without asking", async ({ page }) => {
  const { file, content } = await openEditor(page, "save.ts");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("export {};");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => readFile(file, "utf8")).toBe(`${SOURCE}export {};`);
  await expect(content).toBeVisible();
  await expect(content).toBeFocused();
  await expect(page.getByRole("button", { name: "save", exact: true })).toBeDisabled();
  // A second save from the same editor carries the new baseline: no conflict.
  await page.keyboard.type("\n// again");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => readFile(file, "utf8")).toBe(`${SOURCE}export {};\n// again`);
  await expect(page.getByText(/changed on disk|conflict/i)).toHaveCount(0);
  let asked = false;
  page.on("dialog", (dialog) => {
    asked = true;
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "done", exact: true }).click();
  await expect(content).toHaveCount(0);
  expect(asked).toBe(false);
});

// openlore: scenario=ACrlfFileStaysCrlf spec=file
test("ACrlfFileStaysCrlf: a CRLF file is saved with CRLF, the new line included", async ({ page }) => {
  const crlf = "first\r\nsecond\r\n";
  const { file } = await openEditor(page, "windows.txt", crlf);
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("third");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => readFile(file, "utf8")).toBe("first\r\nsecond\r\nthird\r\n");
});

// openlore: scenario=TheSourceIsReadInTheEditor spec=file
test("TheSourceIsReadInTheEditor: the source shows as the editor does, and typing changes nothing", async ({ page }) => {
  const directory = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, "editor");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "read.ts"), SOURCE);
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("editor", { exact: true }).click();
  await page.getByText("read.ts", { exact: true }).click();
  const source = page.getByTestId("file-source");
  await expect(source.locator(".cm-lineNumbers .cm-gutterElement:not([style*='visibility: hidden'])")).toHaveText(["1", "2", "3", "4", "5", "6"]);
  await expect(source.locator(".tok-keyword").first()).toHaveText("const");
  await expect(source.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await source.locator(".cm-line").first().click();
  await page.keyboard.type("typed");
  await expect(source.locator(".cm-line").first()).toHaveText("const answer = 42;");
  await expect(page.getByTestId("file-editor")).toHaveCount(0);
});

// openlore: scenario=SwitchingViewKeepsTheCurrentMatch spec=viewer-find-in-page
test("SwitchingViewKeepsTheCurrentMatch: every match marked in the source, the reader's match kept from the rendering", async ({ page }) => {
  const directory = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, "editor");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "find.md"), "# Fox\n\nThe fox, a fox, the last fox.\n");
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("editor", { exact: true }).click();
  await page.getByText("find.md", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fox" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("fox");
  const search = page.getByRole("search", { name: "Find in file" });
  await expect(search).toContainText("1/4");
  await page.getByLabel("Next match").click();
  await page.getByLabel("Next match").click();
  await expect(search).toContainText("3/4");

  await page.getByRole("button", { name: /source/ }).click();
  const source = page.getByTestId("file-source");
  await expect(source.locator(".find-match, .find-match-current")).toHaveCount(4);
  await expect(search).toContainText("3/4");
  // The third "fox" of the text is the current one: "a fox" on line 3.
  const current = source.locator(".find-match-current");
  await expect(current).toHaveCount(1);
  const marks = await source.locator(".find-match, .find-match-current").evaluateAll((elements) => elements.map((element) => element.className.includes("find-match-current")));
  expect(marks).toEqual([false, false, true, false]);
});

test("editing from the rendering moves beside it, and done brings the rendering back — Markdown, HTML and a diagram", async ({ page }) => {
  const directory = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, "editor");
  await mkdir(directory, { recursive: true });
  const graph = JSON.stringify({ schema: "urn:structured-exchange:2", kind: "graph", data: { nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], edges: [{ from: "a", to: "b" }] } }, null, 2);
  await writeFile(path.join(directory, "rendered.md"), "# Rendered heading\n\nBody.\n");
  await writeFile(path.join(directory, "rendered.html"), "<h1 id='t'>Rendered page</h1>\n");
  await writeFile(path.join(directory, "rendered.json"), graph);
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("editor", { exact: true }).click();
  const pressed = (name: RegExp) => page.getByRole("group", { name: "How to show this document" }).getByRole("button", { name });

  for (const name of ["rendered.md", "rendered.html", "rendered.json"]) {
    await page.getByText(name, { exact: true }).click();
    await expect(pressed(/rendered/)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "✎ edit" }).click();
    await expect(pressed(/split/)).toHaveAttribute("aria-pressed", "true");
    const split = page.getByTestId("file-split");
    await expect(split.getByTestId("file-editor").locator(".cm-content")).toBeVisible();
    await expect(page.getByTestId("file-split-rendering")).toBeVisible();
    await page.getByRole("button", { name: "done", exact: true }).click();
    await expect(pressed(/rendered/)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("file-editor")).toHaveCount(0);
  }
});
