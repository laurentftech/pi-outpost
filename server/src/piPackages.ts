/**
 * The pi packages the agent loads from npm — `pi install npm:…` — and whether a newer
 * version of each is published.
 *
 * Listing and installing go through the SDK's own package manager, so a package is
 * read from, and updated into, exactly where the resource loader looks for it. Looking
 * up the newest version does not: the SDK's check answers "no update" whenever npm
 * cannot be run, which on a machine whose server cannot spawn npm would read as
 * "everything is current". pi-outpost's own registry lookup is used instead — the one
 * that honours the configured registry, falls back to HTTP, and says when it failed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PiPackageInfo } from "@pi-outpost/shared";
import { CHECK_INTERVAL_MS, type VersionCheck } from "./update.ts";

/** An `npm:` source's package name and, when it names one, the version it is pinned to. */
export function parseNpmSource(source: string): { name: string; pinned?: string } | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const spec = source.slice("npm:".length).trim();
  // The version separator is the last `@` that is not the scope's leading one.
  const at = spec.lastIndexOf("@");
  if (at > 0) return { name: spec.slice(0, at), pinned: spec.slice(at + 1) };
  return spec === "" ? undefined : { name: spec };
}

function installedVersion(installedPath: string | undefined): string | undefined {
  if (!installedPath) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(path.join(installedPath, "package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

const managers = new Map<string, { manager: DefaultPackageManager; settings: SettingsManager }>();

/**
 * The package manager for one project directory and the agent directory, kept: it asks
 * `npm root -g` synchronously the first time it looks for a legacy global install, and
 * asking again on every listing would stall the server each time. Its settings are
 * read again before each use, since `pi install` may have changed them.
 */
export async function packageManagerFor(cwd: string, agentDir: string): Promise<DefaultPackageManager> {
  const key = `${agentDir}\0${cwd}`;
  let kept = managers.get(key);
  if (!kept) {
    const settings = SettingsManager.create(cwd, agentDir);
    kept = { settings, manager: new DefaultPackageManager({ cwd, agentDir, settingsManager: settings }) };
    managers.set(key, kept);
  } else {
    await kept.settings.reload();
  }
  return kept.manager;
}

/**
 * Every npm pi package configured for the agent — the agent directory's and this
 * project's — with the version installed. Git and local sources are not listed: they
 * are not updated from here.
 */
export async function listPiPackages(cwd: string, agentDir: string): Promise<PiPackageInfo[]> {
  const manager = await packageManagerFor(cwd, agentDir);
  const packages: PiPackageInfo[] = [];
  for (const configured of manager.listConfiguredPackages()) {
    const parsed = parseNpmSource(configured.source);
    if (!parsed) continue;
    const installed = installedVersion(configured.installedPath);
    packages.push({
      source: configured.source,
      name: parsed.name,
      scope: configured.scope,
      ...(installed ? { installed } : {}),
      ...(parsed.pinned ? { pinned: parsed.pinned } : {}),
    });
  }
  return packages;
}

export interface PackageCheckOptions {
  /** Whether looking anything up is allowed at all, and why not when it is not. */
  enabled: boolean;
  disabledReason: string;
  /** Look past a recent answer — the user asked. */
  force?: boolean;
  /** The newest published version of a package, as pi-outpost looks up its own. */
  lookup: (packageName: string, installed: string) => Promise<VersionCheck>;
  now?: number;
}

/** A recent answer per package name, so each listing does not ask the registry again. */
const answers = new Map<string, { at: number; check: NonNullable<PiPackageInfo["check"]> }>();

/**
 * What is known about a newer version of each package.
 *
 * A pinned package, or one not installed, is not looked up. A lookup that fails says
 * why; nothing that was not compared is reported current. A failed answer is not kept,
 * so the next look tries again.
 */
export async function checkPiPackages(packages: readonly PiPackageInfo[], options: PackageCheckOptions): Promise<PiPackageInfo[]> {
  const now = options.now ?? Date.now();
  return await Promise.all(
    packages.map(async (entry): Promise<PiPackageInfo> => {
      if (entry.pinned !== undefined || entry.installed === undefined) return entry;
      if (!options.enabled) return { ...entry, check: { state: "off", reason: options.disabledReason } };
      const kept = answers.get(`${entry.name}@${entry.installed}`);
      if (!options.force && kept && now - kept.at < CHECK_INTERVAL_MS) return { ...entry, check: kept.check };
      const result = await options.lookup(entry.name, entry.installed);
      const check: NonNullable<PiPackageInfo["check"]> =
        result.status === "newer"
          ? { state: "newer", latest: result.latest }
          : result.status === "current"
            ? { state: "current", latest: result.latest }
            : result.status === "failed"
              ? { state: "failed", reason: result.reason }
              : { state: "failed", reason: `the installed version "${entry.installed}" cannot be compared with ${result.latest}` };
      if (check.state !== "failed") answers.set(`${entry.name}@${entry.installed}`, { at: now, check });
      return { ...entry, check };
    }),
  );
}
