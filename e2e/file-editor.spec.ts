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
