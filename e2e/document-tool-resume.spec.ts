import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  connect,
  makeWorkspace,
  startServer,
} from "../server/test/harness.mjs";
const provider = fileURLToPath(
  new URL(
    "../server/test/fixtures/scripted-tools-provider.mjs",
    import.meta.url,
  ),
);
const fixture = fileURLToPath(
  new URL("../server/test/fixtures/pptx-order.pptx", import.meta.url),
);

test("Reuse the tool after four exchanges and a session reload extracts the presentation again", async ({
  page,
}) => {
  const root = await makeWorkspace();
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(
    root,
    {
      extensionPaths: [provider],
      allowedModels: [
        { provider: "scripted-tools-test", id: "scripted-tools-test" },
      ],
    },
    { env: { SCRIPTED_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  const records = async () =>
    (await readFile(log, "utf8").catch(() => ""))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((r) => r.tools.length);
  try {
    await client.waitFor("hello", 30_000);
    client.send({
      type: "set_model",
      provider: "scripted-tools-test",
      id: "scripted-tools-test",
    });
    await client.waitFor("model_changed");
    let uploaded = "";
    page.on("websocket", (socket) =>
      socket.on("framereceived", (event) => {
        try {
          const message = JSON.parse(String(event.payload));
          if (message.type === "file_uploaded") uploaded = message.path;
        } catch {
          /* other frames */
        }
      }),
    );
    await page.goto(server.base);
    await expect(page.getByTitle("connected", { exact: true })).toBeVisible();
    const composer = page.getByRole("textbox", { name: /message pi/i });
    async function send(text: string) {
      const seen = client.received.length;
      await composer.fill(text);
      await composer.press("Enter");
      await client.waitFor(
        (m: { type: string }) =>
          client.received.indexOf(m) >= seen && m.type === "agent_end",
        30_000,
      );
      await expect(page.getByText("working…")).toHaveCount(0);
    }
    const bytes = [...(await readFile(fixture))];
    await composer.evaluate((target, data) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(data)], "presentation.pptx", {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }),
      );
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }, bytes);
    await expect.poll(() => uploaded).not.toBe("");
    await send(
      `Read the attached deck. STEPS:${JSON.stringify([{ tool: "pptx_extract", args: { path: uploaded } }])}`,
    );
    for (let i = 0; i < 4; i++) await send(`Quiet ${i}`);
    let seen = client.received.length;
    client.send({ type: "list_sessions" });
    const listed = await client.waitFor(
      (m: { type: string }) =>
        client.received.indexOf(m) >= seen && m.type === "sessions",
    );
    seen = client.received.length;
    client.send({ type: "switch_session", path: listed.sessions[0].path });
    await client.waitFor(
      (m: { type: string }) =>
        client.received.indexOf(m) >= seen && m.type === "session_replaced",
    );
    await page.reload();
    const before = (await records()).length;
    await send("Reuse the tool");
    const reused = (await records()).slice(before);
    expect(reused[0].tools).toContain("pptx_extract");
    expect(reused.at(-1).results).toHaveLength(1);
    expect(reused.at(-1).results[0]).toContain("Third in the file");
    expect(reused.at(-1).results[0]).not.toMatch(
      /not found|does not exist|error/i,
    );
    await expect(
      page.getByText("Reuse the tool", { exact: true }),
    ).toBeVisible();
    // Once aged out, a remembered direct call is still executable, with no file in the new prompt.
    for (let i = 0; i < 5; i++) await send(`Unrelated ${i}`);
    await send("Reuse the tool");
    expect((await records()).at(-1).results[0]).not.toMatch(
      /not found|does not exist|error/i,
    );
    // Repeated page reloads cannot drop the loadout; a genuinely new session must not inherit it.
    await page.reload();
    await page.reload();
    await send("Reuse the tool");
    expect((await records()).at(-1).results[0]).toContain("Third in the file");
    seen = client.received.length;
    await page.getByTitle("new session", { exact: true }).click();
    await client.waitFor(
      (m: { type: string }) =>
        client.received.indexOf(m) >= seen && m.type === "session_replaced",
    );
    await send("Reuse the tool");
    expect((await records()).at(-1).tools).not.toContain("pptx_extract");
    expect((await records()).at(-1).results).toEqual([]);
  } finally {
    client.close();
    await server.stop();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
});
