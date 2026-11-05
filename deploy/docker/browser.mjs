import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// openlore: scenario=PreservesTheBrowserTerminal spec=docker-python-deployment
export async function checkBrowser({ base, token, workspace }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let output = "";
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", ws => ws.on("framereceived", ({ payload }) => {
    try {
      const message = JSON.parse(String(payload));
      if (message.type === "terminal_data") output += message.data;
    } catch {}
  }));
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 30_000;
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error(`${label}; output: ${output.slice(-2000)}`);
      await page.waitForTimeout(100);
    }
  };
  const tabs = () => page.getByTitle("Double-click to rename tab");
  const terminal = () => page.locator(".xterm-screen:visible").last();
  async function command(text) {
    await terminal().click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }
  try {
    await page.goto(`${base}/?token=${token}`);
    await page.getByRole("button", { name: /terminal$/i }).click({ timeout: 60_000 });
    await terminal().waitFor({ state: "visible" });
    await command("python3 -c \"from pathlib import Path; Path('browser-proof.txt').write_text('from the real UI'); print('BROWSER_'+'PYTHON_OK')\"");
    await waitFor(() => output.includes("BROWSER_PYTHON_OK"), "Browser Python command did not run");
    assert.equal(await readFile(path.join(workspace, "browser-proof.txt"), "utf8"), "from the real UI");
    await command("python3 -c \"import time; print('BROWSER_'+'WAITING',flush=True); time.sleep(60)\"");
    await waitFor(() => output.includes("BROWSER_WAITING"), "No running process to interrupt");
    await page.keyboard.press("Control+c");
    await command("printf 'BROWSER_INTERRUPT_%s\\n' OK");
    await waitFor(() => output.includes("BROWSER_INTERRUPT_OK"), "Ctrl+C broke terminal input");
    // Second pass: burst tab creation/closure followed by a full browser reconnect.
    for (let i = 0; i < 4; i++) await page.getByTitle("New Terminal Tab").click();
    assert.equal(await tabs().count(), 5);
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Close terminal tab", exact: true }).last().click();
    assert.equal(await tabs().count(), 1);
    await page.reload();
    const toggle = page.getByRole("button", { name: /terminal$/i });
    await toggle.waitFor({ state: "visible" });
    if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
    await terminal().waitFor({ state: "visible" });
    assert.equal(await tabs().count(), 1, "Closed tabs must not reappear after reconnect");
    await command("printf 'BROWSER_RECONNECTED_%s\\n' OK");
    await waitFor(() => output.includes("BROWSER_RECONNECTED_OK"), "Terminal could not run after reconnect");
    assert.deepEqual(errors, []);
    console.log("PreservesTheBrowserTerminal passed (Python, host file readback, interrupt, tab burst, reconnect)");
  } finally {
    await browser.close();
  }
}
