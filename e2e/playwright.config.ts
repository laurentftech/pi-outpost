import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Browser smoke tests for the two ways this project is consumed: the standalone
 * app the server serves, and the widget a host application mounts.
 *
 * Chromium only, and deliberately: this is a wiring check, not a compatibility
 * matrix. Three browsers would triple the runtime to re-assert the same facts.
 *
 * The server and the host page are started once in global-setup.ts and their
 * URLs arrive through the environment.
 */
export default defineConfig({
  testDir: HERE,
  // Failure artifacts belong beside the tests, not in the repository root, which
  // is where Playwright puts them by default (relative to the working directory).
  outputDir: path.join(HERE, "test-results"),
  globalSetup: "./global-setup.ts",
  // Both specs share one server; parallel workers would race on its session store
  workers: 1,
  fullyParallel: false,
  // A green run is the only acceptable result; a retry that passes hides a race
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    // Kept only for a failure: enough to see what the page looked like
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
