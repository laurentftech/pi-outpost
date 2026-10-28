import path from "node:path";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { expect, test as base, type Page, type Locator } from "@playwright/test";
// @ts-expect-error -- shared integration harness is JavaScript
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

type Workspace = { root: string; other: string; url: string };
const test = base.extend<{ workspace: Workspace; writable: string | null }>({
  writable: ["writable", { option: true }],
  workspace: async ({ writable }, use) => {
    const root = await makeWorkspace({ "writable/target/keep.txt": "keep", "readonly/keep.txt": "readonly" });
    const other = await makeWorkspace({ "other-root.txt": "other", "writable/target/other.txt": "other" });
    const server = await startServer(root, {
      noExtensions: true,
      openProjects: [other],
      sandbox: { root, allowWrite: writable !== null, writableRoot: path.join(root, writable ?? ""), allowBash: false },
    }, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
    try { await use({ root, other, url: server.base }); }
    finally {
      await server.stop();
      await Promise.all([root, other].map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })));
    }
  },
});

async function openTree(page: Page, workspace: Workspace) {
  await page.goto(workspace.url);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await expect(page.locator('[data-drop-directory="writable"]')).toBeVisible();
}
async function target(page: Page) {
  await page.locator('[data-drop-directory="writable"]').getByRole("button").first().click();
  const row = page.locator('[data-drop-directory="writable/target"]');
  await expect(row).toBeVisible();
  return row;
}
type FileSpec = { name: string; bytes: number[]; type?: string; oversized?: boolean; directory?: boolean };
async function transfer(page: Page, files: FileSpec[]) {
  return page.evaluateHandle((specs) => {
    const dt = new DataTransfer();
    const directories = new Set(specs.filter((spec) => spec.directory).map((spec) => spec.name));
    if (directories.size > 0) {
      const original = DataTransferItem.prototype.webkitGetAsEntry;
      DataTransferItem.prototype.webkitGetAsEntry = function () {
        return directories.has(this.getAsFile()?.name ?? "") ? { isDirectory: true } as FileSystemEntry : original.call(this);
      };
    }
    for (const spec of specs) {
      const file = new File([new Uint8Array(spec.bytes)], spec.name, { type: spec.type ?? "application/octet-stream" });
      if (spec.oversized) Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });
      dt.items.add(file);
    }
    return dt;
  }, files);
}
async function drop(page: Page, row: Locator, files: FileSpec[]) {
  const dataTransfer = await transfer(page, files);
  await row.dispatchEvent("dragenter", { dataTransfer });
  await row.dispatchEvent("dragover", { dataTransfer });
  await row.dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
}
function uploadsSent(page: Page) {
  const messages: { name: string; destinationDirectory: string; existingDirectory?: boolean }[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.type === "upload_file") messages.push(message);
  }));
  return messages;
}
async function holdFileReading(page: Page) {
  await page.addInitScript(() => {
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) {
      this.addEventListener("loadend", () => {
        const state = window as unknown as { treeReadsFinished?: number };
        state.treeReadsFinished = (state.treeReadsFinished ?? 0) + 1;
      }, { once: true });
      if (file instanceof File && file.name === "slow.txt") {
        Object.assign(window, { releaseTreeRead: () => original.call(this, file) });
      } else original.call(this, file);
    };
  });
}
async function releaseReading(page: Page) {
  await page.evaluate(() => (window as unknown as { releaseTreeRead: () => void }).releaseTreeRead());
}
async function switchProject(page: Page, other: string) {
  await page.getByTitle(/^Project:/).click();
  await page.getByRole("menuitem").filter({ hasText: path.basename(other) }).click();
  await expect(page.getByText("other-root.txt", { exact: true })).toBeVisible();
}

// openlore: scenario=ImportIntoAFolder spec=file
// openlore: scenario=ImportReportsCollisions spec=file
test("ImportIntoAFolder and ImportReportsCollisions: binary files land in the hovered folder without attachments", async ({ page, workspace }, testInfo) => {
  const messages = uploadsSent(page);
  await openTree(page, workspace);
  const row = await target(page);
  const dt = await transfer(page, [{ name: "report.bin", bytes: [0, 255, 17] }]);
  await row.dispatchEvent("dragenter", { dataTransfer: dt });
  await row.dispatchEvent("dragover", { dataTransfer: dt });
  await expect(row).toHaveClass(/ring-1/);
  await expect(page.getByText(/Drop files to attach/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("tree-drop-target.png") });
  await row.dispatchEvent("drop", { dataTransfer: dt });
  await dt.dispose();
  await expect(page.getByText("Imported: writable/target/report.bin")).toBeVisible();
  await expect(page.getByText("report.bin", { exact: true })).toBeVisible();
  expect(await readFile(path.join(workspace.root, "writable", "target", "report.bin"))).toEqual(Buffer.from([0, 255, 17]));
  await drop(page, row, [{ name: "report.bin", bytes: [1, 2] }]);
  await expect(page.getByText("Imported: writable/target/report-1.bin")).toBeVisible();
  expect(await readFile(path.join(workspace.root, "writable", "target", "report.bin"))).toEqual(Buffer.from([0, 255, 17]));
  expect(await readFile(path.join(workspace.root, "writable", "target", "report-1.bin"))).toEqual(Buffer.from([1, 2]));
  expect(messages).toHaveLength(2);
  expect(messages.every((message) => message.existingDirectory === true && message.destinationDirectory === "writable/target")).toBe(true);
  await expect(page.getByTitle("remove attachment")).toHaveCount(0);
  await expect(page.getByText(/Drop files to attach/)).toHaveCount(0);
});

// openlore: scenario=ReadOnlyDropIsNotAnAttachment spec=file
test("ReadOnlyDropIsNotAnAttachment: a read-only folder refuses images instead of attaching them", async ({ page, workspace }) => {
  const messages = uploadsSent(page);
  await openTree(page, workspace);
  await drop(page, page.locator('[data-drop-directory="readonly"]'), [{ name: "no.png", bytes: [1, 2], type: "image/png" }]);
  await expect(page.getByTitle("remove attachment")).toHaveCount(0);
  expect(messages).toHaveLength(0);
  expect(await readdir(path.join(workspace.root, "readonly"))).toEqual(["keep.txt"]);
  await expect(page.getByText(/Drop files to attach/)).toHaveCount(0);
});

// openlore: scenario=ImportReportsIndividualFailures spec=file
// openlore: scenario=FolderDropsAreRefused spec=file
test("ImportReportsIndividualFailures and FolderDropsAreRefused: continues past invalid items and shows each result", async ({ page, workspace }) => {
  await openTree(page, workspace);
  const row = await target(page);
  await drop(page, row, [{ name: "folder", bytes: [], directory: true }, { name: "big.bin", bytes: [1], oversized: true }, { name: "ok.txt", bytes: [111, 107] }]);
  await expect(page.getByText("Imported: writable/target/ok.txt")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Folders cannot be imported" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "big.bin: Files are limited" })).toBeVisible();
  expect((await readdir(path.join(workspace.root, "writable", "target"))).sort()).toEqual(["keep.txt", "ok.txt"]);
});

test("Monkey: duplicate drops and collapsing a pending destination do not duplicate or lose the import", async ({ page, workspace }) => {
  await holdFileReading(page);
  const messages = uploadsSent(page);
  await openTree(page, workspace);
  const row = await target(page);
  const file = { name: "slow.txt", bytes: [111, 107] };
  await drop(page, row, [file]);
  await expect(page.getByText("Importing files…")).toBeVisible();
  await drop(page, row, [file]);
  await row.getByRole("button").first().click();
  await releaseReading(page);
  await expect(page.getByText("Imported: writable/target/slow.txt")).toBeVisible();
  expect(messages).toHaveLength(1);
  expect((await readdir(path.join(workspace.root, "writable", "target"))).sort()).toEqual(["keep.txt", "slow.txt"]);
});

test.describe("a fully writable workspace", () => {
  test.use({ writable: "" });
  // openlore: scenario=ImportIntoTheRoot spec=file
  test("ImportIntoTheRoot: empty and nonempty files land at the workspace root", async ({ page, workspace }) => {
    await openTree(page, workspace);
    await drop(page, page.locator('[data-drop-directory=""]'), [{ name: "empty.txt", bytes: [] }, { name: "root.txt", bytes: [97] }]);
    await expect(page.getByText("root.txt", { exact: true })).toBeVisible();
    expect(await readFile(path.join(workspace.root, "empty.txt"), "utf8")).toBe("");
    expect(await readFile(path.join(workspace.root, "root.txt"), "utf8")).toBe("a");
    await expect(page.getByTitle("remove attachment")).toHaveCount(0);
  });
  // openlore: scenario=AWorkspaceSwitchDoesNotRedirectImports spec=file
  test("AWorkspaceSwitchDoesNotRedirectImports: a delayed file read never writes into the next project", async ({ page, workspace }) => {
    await holdFileReading(page);
    const messages = uploadsSent(page);
    await openTree(page, workspace);
    await drop(page, await target(page), [{ name: "slow.txt", bytes: [97] }, { name: "later.txt", bytes: [98] }]);
    await expect(page.getByText("Importing files…")).toBeVisible();
    await switchProject(page, workspace.other);
    await releaseReading(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { treeReadsFinished?: number }).treeReadsFinished)).toBe(1);
    await page.getByRole("textbox", { name: /message pi/i }).fill("new project draft");
    await expect(page.getByText("Importing files…")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(messages).toHaveLength(0);
    expect(await readdir(path.join(workspace.root, "writable", "target"))).toEqual(["keep.txt"]);
    expect(await readdir(path.join(workspace.other, "writable", "target"))).toEqual(["other.txt"]);
  });
  test("AWorkspaceSwitchDoesNotRedirectImports: an in-flight reply cannot continue the batch in another project", async ({ page, workspace }) => {
    let releaseReply: (() => void) | undefined;
    const uploaded: string[] = [];
    await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const parsed = JSON.parse(String(message));
        if (parsed.type === "upload_file") uploaded.push(parsed.name);
        server.send(message);
      });
      server.onMessage((message) => {
        if (JSON.parse(String(message)).type === "file_uploaded") {
          releaseReply = () => {
            socket.send(message);
            // A FIFO checkpoint proves the old reply and its promise continuation were processed.
            socket.send(JSON.stringify({ type: "extension_ui_request", id: "import-checkpoint", method: "notify", message: "Upload response checkpoint", notifyType: "info" }));
          };
        } else socket.send(message);
      });
    });
    await openTree(page, workspace);
    await drop(page, await target(page), [{ name: "one.txt", bytes: [97] }, { name: "two.txt", bytes: [98] }]);
    await expect.poll(() => releaseReply !== undefined).toBe(true);
    expect(await readFile(path.join(workspace.root, "writable", "target", "one.txt"), "utf8")).toBe("a");
    await switchProject(page, workspace.other);
    releaseReply!();
    await expect(page.getByText("Upload response checkpoint")).toBeVisible();
    expect(uploaded).toEqual(["one.txt"]);
    expect((await readdir(path.join(workspace.root, "writable", "target"))).sort()).toEqual(["keep.txt", "one.txt"]);
    expect(await readdir(path.join(workspace.other, "writable", "target"))).toEqual(["other.txt"]);
    await expect(page.getByRole("complementary", { name: "Files" }).getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(/^Imported:/)).toHaveCount(0);
  });
});

test("ImportDoesNotResurrectAMissingDirectory: a destination removed during reading is refused", async ({ page, workspace }) => {
  await holdFileReading(page);
  await openTree(page, workspace);
  await drop(page, await target(page), [{ name: "slow.txt", bytes: [97] }]);
  await expect(page.getByText("Importing files…")).toBeVisible();
  await rm(path.join(workspace.root, "writable", "target"), { recursive: true });
  await releaseReading(page);
  await expect(page.getByRole("alert")).toContainText(/slow.txt:.*does not exist/);
  await expect(page.getByText("Importing files…")).toHaveCount(0);
  await expect(stat(path.join(workspace.root, "writable", "target"))).rejects.toMatchObject({ code: "ENOENT" });
});

test.describe("a read-only workspace", () => {
  test.use({ writable: null });
  test("ReadOnlyDropIsNotAnAttachment: the whole tree consumes an external drop", async ({ page, workspace }) => {
    const messages = uploadsSent(page);
    await openTree(page, workspace);
    await drop(page, await target(page), [{ name: "no.png", bytes: [1, 2], type: "image/png" }]);
    await expect(page.getByTitle("remove attachment")).toHaveCount(0);
    expect(messages).toHaveLength(0);
    expect(await readdir(path.join(workspace.root, "writable", "target"))).toEqual(["keep.txt"]);
  });
});
