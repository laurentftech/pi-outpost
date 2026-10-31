/**
 * Files → Search in files, in the running app: a query across a real project, a text hit and a
 * PDF hit opened at their match, and an answer that arrives after a project switch.
 */
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Page } from "@playwright/test";
// @ts-expect-error -- shared integration harness is JavaScript
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "test", "fixtures");

const PLAN = ["# Plan", "the needle starts here", "", "filler", "", "", "", "", "", "the needle we want", ""].join("\n");

type Workspace = { root: string; other: string; url: string };
const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({}, use) => {
    const root = await makeWorkspace({
      "notes/plan.md": PLAN,
      "node_modules/pkg/index.js": "needle in a dependency\n",
    });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await copyFile(path.join(FIXTURES, "pdf-text.pdf"), path.join(root, "docs", "report.pdf"));
    const other = await makeWorkspace({ "other-root.txt": "the needle in the other project\n" });
    const server = await startServer(
      root,
      { noExtensions: true, openProjects: [other], sandbox: { root, allowWrite: false, allowBash: false } },
      { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } },
    );
    try {
      await use({ root, other, url: server.base });
    } finally {
      await server.stop();
      await Promise.all([root, other].map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })));
    }
  },
});

async function openSearch(page: Page, workspace: Workspace) {
  await page.goto(workspace.url);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByRole("button", { name: "Search in files" }).click();
  return page.getByRole("searchbox", { name: "Text to search for in files" });
}

const files = (page: Page) => page.getByRole("complementary", { name: "Files" });
const results = (page: Page) => files(page).getByRole("list", { name: "Search results" });

// openlore: scenario=SearchAcrossWorkspaceFiles spec=file
// openlore: scenario=OpenMatchingLine spec=file
test("SearchAcrossWorkspaceFiles and OpenMatchingLine: the hit's line opens in the source, matched", async ({ page, workspace }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const input = await openSearch(page, workspace);
  await input.fill("needle");
  await input.press("Enter");

  await expect(files(page).getByRole("status").filter({ hasText: "2 matches in 1 file" })).toBeVisible();
  await expect(results(page)).toContainText("notes/plan.md");
  await expect(results(page)).not.toContainText("node_modules");
  await expect(page.getByRole("button", { name: "notes/plan.md, line 10" }).locator("mark")).toHaveText("needle");

  await page.getByRole("button", { name: "notes/plan.md, line 10" }).click();

  const source = page.getByTestId("file-source");
  const current = source.locator(".find-match-current");
  await expect(current).toHaveText("needle");
  await expect(current).toBeInViewport();
  // The current match is on line 10, not on line 2 where the file's first match is.
  const lineOfCurrent = await source.locator(".cm-line").evaluateAll((lines) =>
    lines.findIndex((line) => line.querySelector(".find-match-current") !== null) + 1,
  );
  expect(lineOfCurrent).toBe(10);
  await expect(page.getByRole("textbox", { name: "Find", exact: true })).toHaveValue("needle");
  await expect(page.getByText("2/2")).toBeVisible();
  expect(errors).toEqual([]);
});

// openlore: scenario=SearchPdfPagesAcrossTheWholeDocument spec=file
// openlore: scenario=OpenMatchingPdfPage spec=file
test("SearchPdfPagesAcrossTheWholeDocument and OpenMatchingPdfPage: the PDF opens on the hit's page, highlighted", async ({ page, workspace }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const input = await openSearch(page, workspace);
  await input.fill("supply chain");
  await input.press("Enter");

  const hit = page.getByRole("button", { name: "docs/report.pdf, page 2" });
  await expect(hit).toContainText("p. 2");
  await expect(hit.locator("mark")).toHaveText("supply chain");

  await hit.click();

  const highlight = page.locator('[data-page="2"] .pdf-text-layer mark.find-match-current');
  await expect(highlight).toHaveText(/supply/i);
  await expect(highlight.first()).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "Find", exact: true })).toHaveValue("supply chain");
  expect(errors).toEqual([]);
});

// openlore: scenario=NoContentMatches spec=file
// openlore: scenario=EmptyContentSearch spec=file
test("NoContentMatches and EmptyContentSearch: nothing found says so; nothing typed searches nothing", async ({ page, workspace }) => {
  const sent: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === "search_content") sent.push(message.query);
    }),
  );
  const input = await openSearch(page, workspace);

  await input.fill("   ");
  await input.press("Enter");
  await expect(files(page).getByRole("status")).toHaveCount(0);
  await expect(results(page)).toHaveCount(0);

  await input.fill("zzz-absent-everywhere");
  await input.press("Enter");
  await expect(files(page).getByRole("status").filter({ hasText: "No matches" })).toBeVisible();
  expect(sent).toEqual(["zzz-absent-everywhere"]);
});

// openlore: scenario=WorkspaceChangesDuringSearch spec=file
test("WorkspaceChangesDuringSearch: an answer arriving after a project switch is not shown", async ({ page, workspace }) => {
  let releaseAnswer: (() => void) | undefined;
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (JSON.parse(String(message)).type === "content_search_results" && releaseAnswer === undefined) {
        releaseAnswer = () => {
          socket.send(message);
          // FIFO checkpoint: once it shows, the held answer has been processed.
          socket.send(JSON.stringify({ type: "extension_ui_request", id: "search-checkpoint", method: "notify", message: "Search answer checkpoint", notifyType: "info" }));
        };
      } else socket.send(message);
    });
  });
  const input = await openSearch(page, workspace);
  await input.fill("needle");
  await input.press("Enter");
  await expect.poll(() => releaseAnswer !== undefined).toBe(true);
  await expect(files(page).getByRole("status").filter({ hasText: "Searching…" })).toBeVisible();

  await page.getByTitle(/^Project:/).click();
  await page.getByRole("menuitem").filter({ hasText: path.basename(workspace.other) }).click();
  await expect(page.getByText("other-root.txt", { exact: true })).toBeAttached();
  releaseAnswer!();
  await expect(page.getByText("Search answer checkpoint")).toBeVisible();

  // Neither the old answer nor its file: the panel is back to the tree of the new project.
  await expect(page.getByRole("button", { name: /notes\/plan\.md/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Search in files" }).click();
  await expect(results(page)).toHaveCount(0);
  await expect(files(page).getByRole("status")).toHaveCount(0);
});
