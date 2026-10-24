/**
 * The planning timeline as Open WebUI embeds it: the page the server answers
 * show_planning with, framed exactly as Open WebUI v0.11.4 frames a tool's embed —
 * `sandbox="allow-scripts allow-popups allow-downloads"`, no same-origin, content in
 * `srcdoc`. The host page records every message the frame posts, which is all Open
 * WebUI ever receives from it.
 *
 * Needs the viewer built (`npm run build --workspace @pi-outpost/openwebui`).
 */
import { expect, test, type Frame, type Page } from "@playwright/test";
import { embedPage } from "../openwebui/src/embed.ts";

const PLANNING = {
  id: "pl_AAAAAAAAAAAAAAAA",
  title: "Programme X",
  revision: 2,
  data: {
    title: "Programme X",
    time: { start: "2027-01-01", end: "2027-12-31", scale: "month" as const },
    rows: [
      { type: "separator" as const, label: "System A" },
      {
        type: "task" as const,
        id: "T1",
        label: "Study",
        items: [
          { type: "activity" as const, id: "study", start: "2027-01-10", end: "2027-03-31", label: "Study" },
          { type: "milestone" as const, id: "srr", date: "2027-04-15", kind: "SRR", label: "Requirements review" },
        ],
      },
      {
        type: "task" as const,
        id: "T2",
        label: "Build",
        items: [{ type: "activity" as const, id: "build", start: "2027-05-01", end: "2027-09-30", label: "Build & test" }],
      },
    ],
    dependencies: [{ from: "srr", to: "build" }],
  },
};

async function host(page: Page): Promise<Frame> {
  await page.setContent(`<!doctype html><body style="margin:0">
    <iframe id="embed" sandbox="allow-scripts allow-popups allow-downloads" style="width:900px;border:0"></iframe>
    <script>
      window.received = [];
      window.addEventListener("message", (event) => window.received.push(event.data));
    </script></body>`);
  await page.locator("#embed").evaluate((frame, html) => {
    (frame as HTMLIFrameElement).srcdoc = html;
  }, embedPage(PLANNING));
  const frame = page.frameLocator("#embed");
  await expect(frame.getByTestId("timeline")).toBeVisible();
  return page.frames().find((candidate) => candidate !== page.mainFrame())!;
}

async function themedHost(page: Page, sandbox: string, dark: boolean, payload = PLANNING): Promise<Frame> {
  await page.setContent(`<!doctype html><html class="${dark ? "dark" : ""}"><body style="margin:0">
    <iframe id="embed" sandbox="${sandbox}" style="width:900px;border:0"></iframe></body></html>`);
  await page.locator("#embed").evaluate((frame, html) => {
    (frame as HTMLIFrameElement).srcdoc = html;
  }, embedPage(payload));
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
  await expect(frame.getByTestId(payload.mode === "download" ? "download-name" : "timeline")).toBeVisible();
  return frame;
}

const received = (page: Page) => page.evaluate(() => (window as unknown as { received: Array<{ type?: string; text?: string; height?: number }> }).received);

// openlore: scenario=TheEmbedRunsInTheDefaultSandbox spec=openwebui-planning-server
test("TheEmbedRunsInTheDefaultSandbox: draws, changes scale, opens details, reports its height", async ({ page }) => {
  const frame = await host(page);
  const embed = page.frameLocator("#embed");

  // Every task and item of the revision, drawn.
  await expect(embed.getByTestId("timeline-task-label")).toHaveText(["Study", "Build"]);
  expect(await frame.locator("[data-row][data-item]").count()).toBe(3);
  // The frame really is sandboxed without same-origin: its origin is opaque.
  expect(await frame.evaluate(() => window.origin)).toBe("null");

  // A scale change redraws.
  await embed.locator("[data-scale=quarter]").click();
  await expect(embed.locator("[data-scale=quarter]")).toHaveAttribute("aria-pressed", "true");

  // Details open on a click.
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await expect(embed.getByTestId("timeline-details")).toContainText("Requirements review");

  // Its height, measured from the timeline, not the frame's default 150 px. Messages
  // from the frame arrive asynchronously, so they are waited for, never read once.
  const drawn = await frame.evaluate(() => Math.ceil(document.getElementById("root")!.getBoundingClientRect().height));
  await expect.poll(async () => (await received(page)).filter((m) => m.type === "iframe:height").map((m) => m.height!).at(-1)).toBe(drawn);
  expect(drawn).toBeGreaterThan(150);
});

// openlore: scenario=DarkOpenWebUIOnALightSystem spec=openwebui-embed-theme
// openlore: scenario=LightOpenWebUIOnADarkSystem spec=openwebui-embed-theme
// openlore: scenario=TheSystemSwitchesWhileOpen spec=openwebui-embed-theme
test("Planning theme follows Open WebUI when readable, otherwise follows the system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  let frame = await themedHost(page, "allow-scripts allow-same-origin allow-popups allow-downloads", true);
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("html").evaluate((element) => element.classList.remove("dark"));
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");

  await page.emulateMedia({ colorScheme: "dark" });
  frame = await themedHost(page, "allow-scripts allow-popups allow-downloads", false);
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
});

// openlore: scenario=TheDefaultFrameFollowsTheSystem spec=openwebui-embed-theme
test("Download card follows the system in Open WebUI's opaque default frame", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const frame = await themedHost(page, "allow-scripts allow-popups allow-downloads", false, {
    mode: "download",
    fileName: "Class rules.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 4,
    data: "UEsDBA==",
    outline: [{ level: 1, text: "Class rules" }],
    figures: [],
    template: "Default",
  });
  expect(await frame.locator("html").evaluate((root) => root.dataset.theme)).toBe("dark");
  const card = frame.getByRole("region", { name: "Class rules.docx" });
  await expect(card).toHaveCSS("background-color", "oklch(0.208 0.042 265.755)");
  await expect(frame.getByRole("button", { name: "Download" })).toBeVisible();
});

// openlore: scenario=ClickingAMilestoneFillsTheInput spec=openwebui-planning-server
test("ClickingAMilestoneFillsTheInput: asks the chat to fill its input, never to send", async ({ page }) => {
  const frame = await host(page);
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await frame.locator('[data-testid="timeline-task-label"]', { hasText: "Build" }).click();
  // Unselecting asks for nothing.
  await frame.locator('[data-testid="timeline-task-label"]', { hasText: "Build" }).click();

  await expect.poll(async () => (await received(page)).filter((m) => m.type?.startsWith("input:"))).toEqual([
    {
      type: "input:prompt",
      text: 'About milestone "Requirements review" (srr, task T1, on 2027-04-15) in planning "Programme X" (pl_AAAAAAAAAAAAAAAA): ',
    },
    { type: "input:prompt", text: 'About task "Build" (T2) in planning "Programme X" (pl_AAAAAAAAAAAAAAAA): ' },
  ]);
  expect((await received(page)).some((m) => m.type === "input:prompt:submit" || m.type === "action:submit")).toBe(false);
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the prompt follows the reader's language", async ({ page }) => {
    const frame = await host(page);
    await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
    await expect.poll(async () => (await received(page)).filter((m) => m.type === "input:prompt").map((m) => m.text)).toEqual([
      "À propos du jalon « Requirements review » (srr, tâche T1, le 2027-04-15) dans le planning « Programme X » (pl_AAAAAAAAAAAAAAAA) : ",
    ]);
  });
});

/**
 * create_document's answer, from the server itself: the page it embeds, and the bytes
 * of the document it built, read back from that page's payload.
 */
async function writtenDocument(): Promise<{ html: string; bytes: Buffer; fileName: string }> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { gunzipSync } = await import("node:zlib");
  const { buildApp } = await import("../openwebui/src/app.ts");
  const { planningRoutes } = await import("../openwebui/src/routes.ts");
  const { PlanningStore } = await import("../openwebui/src/store.ts");
  const dataDir = await mkdtemp(path.join(tmpdir(), "outpost-download-"));
  const config = {
    host: "127.0.0.1",
    port: 0,
    secret: "s",
    identity: "plain" as const,
    identityKey: undefined,
    dataDir,
    maxPlanningBytes: 1_000_000,
    maxRevisions: 10,
    maxPlanningsPerUser: 10,
    templatesDir: undefined,
    maxFileBytes: 5 * 1024 * 1024,
    maxImageBytes: 1024 * 1024,
    maxDocuments: 20,
    documentDays: 30,
  };
  const app = buildApp(config, planningRoutes(new PlanningStore(config), config));
  try {
    const response = await app.inject({
      method: "POST",
      url: "/create_document",
      headers: { authorization: "Bearer s", "x-openwebui-user-id": "alice" },
      payload: { file_name: "R&D report", markdown: "# R&D report\n\n## Findings\n\nAll good.\n\n## Next steps\n\n- ship\n" },
    });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(gunzipSync(Buffer.from(/data-planning="([A-Za-z0-9+/=]*)"/.exec(response.body)![1]!, "base64")).toString("utf8"));
    return { html: response.body, bytes: Buffer.from(payload.data, "base64"), fileName: payload.fileName };
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

// openlore: scenario=TheDownloadIsTheDocument spec=openwebui-office-documents
test("TheDownloadIsTheDocument: the button inside Open WebUI's sandbox hands over the document the server built", async ({ page }) => {
  const written = await writtenDocument();
  // Stored by Open WebUI and read back through its entity decoder: a page with no `&`
  // survives, even with one in the file's name and headings.
  expect(written.html.includes("&")).toBe(false);
  await page.setContent(`<!doctype html><body style="margin:0">
    <iframe id="embed" sandbox="allow-scripts allow-popups allow-downloads" style="width:900px;border:0"></iframe></body>`);
  await page.locator("#embed").evaluate((frame, html) => {
    (frame as HTMLIFrameElement).srcdoc = html;
  }, written.html);
  const embed = page.frameLocator("#embed");
  await expect(embed.getByTestId("download-name")).toHaveText("R&D report.docx");
  await expect(embed.getByTestId("download-outline").locator("li")).toHaveText(["R&D report", "Findings", "Next steps"]);

  const [download] = await Promise.all([page.waitForEvent("download"), embed.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe(written.fileName);
  const { readFile } = await import("node:fs/promises");
  const received = await readFile((await download.path())!);
  expect(received.equals(written.bytes)).toBe(true);
});
