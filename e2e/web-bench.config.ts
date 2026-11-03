import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Browser compatibility gate for the main app, assistant-rendered content and
 * embedded widget. The complete existing E2E suite remains Chromium-only; these
 * selected high-value user paths also run in Firefox and WebKit.
 */
export default defineConfig({
  testDir: HERE,
  grep: /loads and connects to the server that served it|nothing in the same reply executes|mounts inside a shadow root and connects across origins|monkey: repeated send-now interrupts deliver each queued batch once and in order|narrow viewport automatically compacts the Work Plan and keeps the conversation visible|Reuse the tool after four exchanges and a session reload extracts the presentation again|standalone app meets WCAG 2\.2 AA on its initial screen|settings panel meets WCAG 2\.2 AA/,
  outputDir: path.join(HERE, "test-results-webbench"),
  globalSetup: "./global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
