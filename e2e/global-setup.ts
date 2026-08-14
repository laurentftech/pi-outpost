import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The same harness the server's own integration tests use: a real server, in its
// own process group, against a throwaway workspace, with PI_OFFLINE set so the
// SDK's model runtime never reaches the network.
// @ts-expect-error -- .mjs harness, no types; the shape is asserted below
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_DIST = path.join(HERE, "dist-host");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
};

/**
 * Serves the built host page on its own origin.
 *
 * Its own origin matters: a widget loaded same-origin with the backend would
 * never exercise the cross-origin path that every real host application takes.
 */
function serveHostPage(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://localhost").pathname;
    const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
    // Name arithmetic, then a containment check: this serves a build directory
    // to a browser we control, and it still does not get to read outside it.
    const file = path.join(HOST_DIST, relative);
    if (!file.startsWith(HOST_DIST + path.sep) && file !== path.join(HOST_DIST, "index.html")) {
      response.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (bytes) => {
        response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        response.end(bytes);
      },
      () => response.writeHead(404).end(),
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * The environment the test server gets: no provider key except one that is not
 * real.
 *
 * Both halves matter. Without the removals the run inherits whatever the
 * developer has configured, and the suite passes on their machine and fails on a
 * runner that has nothing — which is exactly what happened the first time this
 * job ran in CI: with no key at all the app renders the onboarding screen ("No
 * model provider is set up yet") and there is no composer to find. Without the
 * fake key it would now fail everywhere instead.
 *
 * The key is never used: PI_OFFLINE keeps the runtime off the network and no
 * test sends a message. It exists so the interface under test is the interface,
 * not the setup wizard.
 */
function onlyOneFakeProvider(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const name of Object.keys(process.env)) {
    if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) env[name] = undefined;
  }
  env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";
  return env;
}

/**
 * Boots what both specs need and hands the URLs to the workers through the
 * environment. Returning a function registers it as the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // Both specs read a built artifact rather than source. Saying which one is
  // missing beats the cascade of 404s and blank pages that follows otherwise.
  const required = [
    [path.join(HERE, "..", "web/dist/index.html"), "npm run build --workspace web"],
    [path.join(HERE, "..", "embed/dist/pi-outpost-embed.js"), "npm run build --workspace @pi-outpost/embed"],
    [path.join(HOST_DIST, "index.html"), "npm run build:e2e-host"],
  ] as const;
  for (const [file, command] of required) {
    await access(file).catch(() => {
      throw new Error(`missing ${path.relative(path.join(HERE, ".."), file)} — run \`${command}\` first`);
    });
  }

  const host = await serveHostPage();

  const root = await makeWorkspace({
    "readme.md": "# workspace\n\nA file the browser is allowed to see.\n",
  });
  const server = await startServer(
    root,
    {
      // The host page is a different origin, which is the whole point of the widget.
      server: { allowedOrigins: [host.url] },
      branding: { title: "embed smoke" },
    },
    { env: onlyOneFakeProvider() },
  );

  process.env.PI_E2E_HOST_URL = host.url;
  process.env.PI_E2E_SERVER_URL = server.base;

  return async () => {
    await server.stop();
    await host.close();
  };
}
