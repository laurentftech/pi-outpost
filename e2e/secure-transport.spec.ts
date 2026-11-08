import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { makeWorkspace, startServer, type HarnessServer } from "../server/test/harness.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const certFile = path.join(repo, "server", "test", "fixtures", "tls", "test-cert.pem");
const keyFile = path.join(repo, "server", "test", "fixtures", "tls", "test-key.pem");
const token = "https-browser-test-token";
let server: HarnessServer;

test.beforeAll(async () => {
  const root = await makeWorkspace({ "https-proof.txt": "served by the HTTPS workspace" });
  server = await startServer(root, {
    server: { host: "0.0.0.0", token, tls: { certFile, keyFile } },
    updateCheck: false, changelogNotice: false,
  }, { ca: await readFile(certFile), env: { ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" } });
});
test.afterAll(async () => { await server?.stop(); });

test("HttpsBrowserAndReconnect", async ({ browser }) => {
  // TCP forwarding preserves the real TLS/WSS endpoints while letting us cut the wire.
  // Chromium's offline emulation does not reliably close existing WebSockets.
  const wires = new Set<net.Socket>();
  let interrupted = false;
  const relay = net.createServer((incoming) => {
    if (interrupted) { incoming.destroy(); return; }
    const upstream = net.connect(server.port, "127.0.0.1");
    for (const socket of [incoming, upstream]) {
      wires.add(socket);
      socket.on("close", () => wires.delete(socket));
      socket.on("error", () => { incoming.destroy(); upstream.destroy(); });
    }
    incoming.pipe(upstream).pipe(incoming);
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address() as net.AddressInfo;
  const base = `https://127.0.0.1:${address.port}`;
  // Isolated self-signed test identity only; production never changes browser trust.
  // The Node wire suite separately verifies CA trust, hostname refusal and the TLS floor.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const sockets: string[] = [];
  const errors: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${base}/?token=${token}`);
    await expect(page.getByTitle("connected", { exact: true })).toBeVisible();
    const composer = page.locator("textarea");
    await expect(composer).toBeVisible();
    expect(sockets.length).toBeGreaterThan(0);
    expect(sockets.every((url) => url.startsWith("wss://"))).toBe(true);
    expect(new URL(page.url()).searchParams.has("token")).toBe(false);
    await page.getByTitle("Show files", { exact: true }).click();
    await expect(page.getByText("https-proof.txt", { exact: true })).toBeVisible();
    // Socket-open precedes the initial workspace snapshot. Wait for actual project
    // data before drafting: the composer is keyed by that workspace identity.
    await composer.fill("draft survives a disconnected transport");
    await expect(composer).toHaveValue("draft survives a disconnected transport");

    // Adverse pass: cut the active transport, preserve the draft, then reconnect and reload.
    interrupted = true;
    for (const wire of wires) wire.destroy();
    await expect(page.getByTitle("connected", { exact: true })).not.toBeVisible();
    await expect(composer).toBeDisabled();
    await expect(composer).toHaveValue("draft survives a disconnected transport");
    interrupted = false;
    await expect(page.getByTitle("connected", { exact: true })).toBeVisible();
    await expect(composer).toBeEnabled();
    await expect(composer).toHaveValue("draft survives a disconnected transport");
    await composer.fill("draft edited after reconnect");
    await page.reload();
    await expect(page.getByTitle("connected", { exact: true })).toBeVisible();
    expect(sockets.every((url) => url.startsWith("wss://"))).toBe(true);
    expect(errors).toEqual([]);

    // Wrong-token and recovery use the actual auth screen, not a direct tool call.
    await page.goto(`${base}/?token=wrong`);
    await expect(page.getByTitle("connected", { exact: true })).not.toBeVisible();
    await expect(page.getByLabel("Access token", { exact: true })).toBeVisible();
    await page.getByLabel("Access token", { exact: true }).fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByTitle("connected", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTitle("connected", { exact: true })).toBeVisible();
  } finally {
    await context.close();
    for (const wire of wires) wire.destroy();
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  }
});
