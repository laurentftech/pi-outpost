/**
 * Opening the interface in the operator's browser, once the server is listening.
 *
 * Anyone who starts this reads an address off the terminal and pastes it into a
 * browser. The software can do that itself — and for an executable launched from a
 * file manager it must, because there is no terminal for that address to be read
 * from at all.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * How the interface is presented once it is opened.
 *
 * `window` is a window of its own — no tabs, no address bar — which is what the
 * interface is: an application that was launched, not a page that was visited.
 * `browser` is what this always did, and is what a machine that cannot present
 * such a window falls back to.
 */
export const OPEN_SHAPES = ["window", "browser"] as const;
export type OpenShape = (typeof OPEN_SHAPES)[number];

export interface OpenDecision {
  /** Set by --open / --no-open, which win over everything. */
  explicit?: boolean;
  /** Set in configuration, for a deployment that never wants one. */
  configured?: boolean;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Whether a browser should be opened at all.
 *
 * The obvious test — "is stdout a terminal" — gets the most important case exactly
 * backwards: a double-clicked executable has no terminal, and is precisely where
 * nobody will read a printed address. So the question is whether a browser can be
 * *shown*: macOS and Windows always have a desktop; on Linux a display server has to
 * be named. A container, a service and a remote shell all fail that test on their
 * own, without needing to be recognised individually.
 */
export function shouldOpenBrowser({
  explicit,
  configured,
  platform = process.platform,
  env = process.env,
}: OpenDecision = {}): boolean {
  if (explicit !== undefined) return explicit;
  if (configured !== undefined) return configured;
  // A CI runner has a display often enough to matter, and never a person watching.
  if (env.CI !== undefined && env.CI !== "" && env.CI !== "false") return false;
  if (platform === "darwin" || platform === "win32") return true;
  return Boolean(env.DISPLAY ?? env.WAYLAND_DISPLAY);
}

/**
 * The address to open, from what the server actually bound.
 *
 * Not from the configuration: a port of 0 means the operating system picks, and the
 * configured value is then a number nobody is listening on. The wildcard addresses
 * are not reachable as themselves either — a browser has to be sent somewhere it can
 * connect, which is the loopback of the same family.
 */
export function browsableUrl(address: { address: string; port: number; family?: string }): string {
  const host =
    address.address === "0.0.0.0" || address.address === "::" || address.address === ""
      ? "127.0.0.1"
      : address.address;
  // A literal IPv6 address needs its brackets back before it is a URL.
  const authority = host.includes(":") ? `[${host}]` : host;
  return `http://${authority}:${address.port}/`;
}

/**
 * Browsers that can present a window of its own, in the order they are tried.
 *
 * This is the one place that names a browser, and it reverses what the rest of
 * this file says: the operating system holds the user's preference, and asking it
 * to open a URL is how that preference is honoured. Presenting a window without
 * tabs cannot go through that door — it needs a browser invoked directly, with the
 * flag that asks for the window.
 *
 * What keeps this from becoming a browser-preference parser is the question it
 * answers. Not "which browser should this user have" but "can this one present the
 * window at all". A machine where none is found gets the ordinary opener, which is
 * exactly today's behaviour.
 *
 * Paths, not names, so the answer is a file that either exists or does not — and
 * so a test can decide what exists without a machine that has any of them.
 */
export const OWN_WINDOW_BROWSERS: Record<string, readonly string[]> = {
  darwin: [
    "/Applications/Microsoft Edge.app",
    "/Applications/Google Chrome.app",
    "/Applications/Chromium.app",
    "/Applications/Brave Browser.app",
  ],
  win32: [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  linux: ["microsoft-edge", "google-chrome", "chromium", "chromium-browser"],
};

/** Whether a candidate is present. Injected so the choice can be tested anywhere. */
export type ExistsProbe = (candidate: string) => boolean;

/** Real answer: an absolute path is a file, a bare name is looked up on PATH. */
const existsOnThisMachine: ExistsProbe = (candidate) => {
  if (path.isAbsolute(candidate)) return fs.existsSync(candidate);
  const entries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return entries.some((entry) => fs.existsSync(path.join(entry, candidate)));
};

/**
 * How to present the interface in a window of its own, or undefined where nothing
 * on this machine can.
 *
 * On macOS the browser is still launched through `open`, because an application
 * bundle is not an executable to spawn; `-n` asks for a new instance so an already
 * running browser does not simply raise its own window instead.
 */
export function ownWindowOpenerFor(
  platform: NodeJS.Platform,
  url: string,
  exists: ExistsProbe = existsOnThisMachine,
): { command: string; args: string[] } | undefined {
  const candidate = (OWN_WINDOW_BROWSERS[platform] ?? []).find((entry) => exists(entry));
  if (candidate === undefined) return undefined;
  if (platform === "darwin") return { command: "open", args: ["-na", candidate, "--args", `--app=${url}`] };
  return { command: candidate, args: [`--app=${url}`] };
}

/** The platform's own opener. Nothing here parses a browser preference — the OS holds it. */
function openerFor(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  // explorer delegates URLs to the user's default browser without passing the URL
  // through cmd.exe's command parser.
  if (platform === "win32") return { command: "explorer.exe", args: [url] };
  return { command: "xdg-open", args: [url] };
}

/**
 * Launch it, detached, and never let it matter.
 *
 * A browser that will not start is not a reason for a server to stop, or even to
 * exit non-zero: the address is printed either way, which is what the operator would
 * have used before this existed.
 */
export function chooseOpener(
  platform: NodeJS.Platform,
  url: string,
  shape: OpenShape,
  exists?: ExistsProbe,
): { command: string; args: string[] } {
  // Falling back rather than failing is what makes a window of its own safe as the
  // default: the worst case is exactly what this did before.
  const own = shape === "window" ? ownWindowOpenerFor(platform, url, exists) : undefined;
  return own ?? openerFor(platform, url);
}

export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  shape: OpenShape = "window",
  exists?: ExistsProbe,
): Promise<boolean> {
  const { command, args } = chooseOpener(platform, url, shape, exists);
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      // Both outcomes are events, and `spawn` is the one that says the child actually
      // started. Resolving straight after the call instead would always report success:
      // `error` fires on the next tick, by which time the promise has already settled,
      // so a missing opener looked exactly like a browser that opened.
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        // Unref'd, or a browser the OS keeps as a child would hold the server open
        // past Ctrl-C — which is how "the process will not die" bugs are born.
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
