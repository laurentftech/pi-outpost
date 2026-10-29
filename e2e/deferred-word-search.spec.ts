import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";
// @ts-expect-error -- shared integration harness is JavaScript
import { connect, makeWorkspace, startServer } from "../server/test/harness.mjs";

const provider = fileURLToPath(new URL("../server/test/fixtures/scripted-tools-provider.mjs", import.meta.url));

test("Word document search loads the extractor in the running app", async ({ page }) => {
  const root = await makeWorkspace({});
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(root, {
    extensionPaths: [provider],
    allowedModels: [{ provider: "scripted-tools-test", id: "scripted-tools-test" }],
  }, { env: { SCRIPTED_TOOLS_LOG: log } });
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello", 30_000);
    client.send({ type: "set_model", provider: "scripted-tools-test", id: "scripted-tools-test" });
    await client.waitFor((message: { type: string }) => message.type === "model_changed");
    await page.goto(server.base);
    const composer = page.getByRole("textbox", { name: /message pi/i });
    await composer.fill('STEPS:[{"tool":"tool_search","args":{"query":"Word document"}}]');
    await composer.press("Enter");
    await expect.poll(async () => {
      const text = await readFile(log, "utf8").catch(() => "");
      return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((request) => request.tools.length > 0);
    }).toEqual([
      expect.objectContaining({ tools: expect.arrayContaining(["tool_search"]) }),
      expect.objectContaining({ tools: expect.arrayContaining(["docx_extract"]) }),
    ]);
    await expect(page.getByText("ok", { exact: true })).toBeVisible();
  } finally {
    client.close();
    await server.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
