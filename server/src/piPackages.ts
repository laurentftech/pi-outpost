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

/**
 * What a listing leaves out without a word: settings the SDK could not read — it then
 * lists their packages as none — and the git and local sources pi-outpost does not
 * update. The update command says both, so "no package" is never a broken file.
 */
export async function unlistedPiPackageSources(cwd: string, agentDir: string): Promise<{ unreadable: string[]; unmanaged: string[] }> {
  const manager = await packageManagerFor(cwd, agentDir);
  const settings = managers.get(`${agentDir}\0${cwd}`)?.settings;
  // Once each: the SDK records a file's error again every time it is read.
  const unreadable = [...new Set((settings?.drainErrors() ?? []).map(({ path: file, scope, error }) => `${file ?? `the ${scope} settings`}: ${error.message}`))];
  const unmanaged = manager.listConfiguredPackages().filter((configured) => !parseNpmSource(configured.source)).map((configured) => configured.source);
  return { unreadable, unmanaged };
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

export type PiPackageInstall =
  | { outcome: "installed"; installed: string; message: string }
  | { outcome: "failed"; message: string };

/**
 * Install the newest version of one listed package, and say what is on disk afterwards.
 *
 * The package manager returns without a word when it decides not to install — in pi's
 * offline mode, or when its own look at the registry failed. What is on disk afterwards
 * is the only answer to "did it update", for Settings and the update command alike.
 */
export async function installNewerPiPackage(cwd: string, agentDir: string, entry: PiPackageInfo): Promise<PiPackageInstall> {
  try {
    await (await packageManagerFor(cwd, agentDir)).update(entry.source);
  } catch (error) {
    return { outcome: "failed", message: `${entry.name} was not updated: ${error instanceof Error ? error.message : String(error)}` };
  }
  const installed = (await listPiPackages(cwd, agentDir)).find((candidate) => candidate.source === entry.source && candidate.scope === entry.scope)?.installed;
  if (installed === undefined || installed === entry.installed) {
    const offline = process.env.PI_OFFLINE ? " — pi's offline mode (PI_OFFLINE) is on" : "";
    return { outcome: "failed", message: `${entry.name} is still at ${entry.installed ?? "no version"}: the package manager installed nothing${offline}` };
  }
  return { outcome: "installed", installed, message: `${entry.name} ${installed} is installed` };
}

// --- from the terminal: `pi-outpost update --extensions` -------------------------

export interface PiPackagesUpdateOptions {
  /** True for `--check`: report and install nothing. */
  checkOnly: boolean;
  /** Configuration said no network — refuse rather than look anything up. */
  checkingDisabled?: boolean;
  disabledReason?: string;
  /** `extensionLock`: report, and install nothing. */
  locked?: boolean;
  /** The packages, as Settings lists them. */
  list: () => Promise<PiPackageInfo[]>;
  /** What the listing left out: unreadable settings, git and local sources. */
  unlisted?: () => Promise<{ unreadable: string[]; unmanaged: string[] }>;
  lookup: PackageCheckOptions["lookup"];
  /** Installs one package and says what is on disk afterwards. Injected so a test installs nothing. */
  install: (entry: PiPackageInfo) => Promise<PiPackageInstall>;
  log?: (line: string) => void;
}

const labelOf = (entry: PiPackageInfo): string => (entry.scope === "project" ? `${entry.name} (this project)` : entry.name);

/**
 * The update command for the agent's npm pi packages: Settings' rules, in a terminal.
 * What the process should exit with — zero only when everything asked for was done.
 */
export async function runPiPackagesUpdate(options: PiPackagesUpdateOptions): Promise<number> {
  const say = options.log ?? ((line: string) => console.log(line));
  const packages = await options.list();
  const unlisted = (await options.unlisted?.()) ?? { unreadable: [], unmanaged: [] };
  // A settings file the SDK could not read lists as no package at all: never "nothing to do".
  for (const problem of unlisted.unreadable) say(`[pi] could not read ${problem}`);
  if (unlisted.unmanaged.length > 0) say(`[pi] not updated by pi-outpost (git or local): ${unlisted.unmanaged.join(", ")}`);
  const unreadable = unlisted.unreadable.length > 0 ? 1 : 0;
  if (packages.length === 0) {
    say(`[pi] no npm pi package is configured for the agent`);
    return unreadable;
  }
  if (options.checkingDisabled) {
    say(`[pi] update checking is disabled: ${options.disabledReason ?? "configuration"} — no pi package was looked up`);
    return 1;
  }

  // Asked for, so looked up now: a remembered answer is for a listing nobody asked for.
  const checked = await checkPiPackages(packages, { enabled: true, disabledReason: "", force: true, lookup: options.lookup });
  let failed = false;
  const newer: PiPackageInfo[] = [];
  for (const entry of checked) {
    const label = labelOf(entry);
    if (entry.pinned !== undefined) say(`[pi] ${label} is pinned at ${entry.pinned} — left as it is`);
    else if (entry.installed === undefined) say(`[pi] ${label} is configured but not installed`);
    else if (entry.check?.state === "newer") {
      say(`[pi] ${label} ${entry.installed} is installed; ${entry.check.latest} is available`);
      newer.push(entry);
    } else if (entry.check?.state === "current") say(`[pi] ${label} ${entry.installed} is the newest published version`);
    else {
      // Never "up to date": nothing was compared.
      failed = true;
      say(`[pi] ${label} ${entry.installed}: could not check — ${entry.check?.state === "failed" ? entry.check.reason : "no answer"}`);
    }
  }

  if (unreadable) failed = true;
  if (options.checkOnly || newer.length === 0) return failed ? 1 : 0;
  if (options.locked) {
    say(`[pi] "extensionLock" is set: no pi package was updated`);
    return 1;
  }

  let installed = 0;
  for (const entry of newer) {
    say(`[pi] updating ${labelOf(entry)}…`);
    const result = await options.install(entry);
    say(`[pi]   ${result.message}`);
    if (result.outcome === "installed") installed += 1;
    else failed = true;
  }
  // A running server keeps the code it loaded: nothing here claims the new one runs.
  if (installed > 0) say(`[pi] restart pi-outpost to run the updated ${installed === 1 ? "package" : "packages"}`);
  return failed ? 1 : 0;
}

/**
 * After a plain `pi-outpost update`: the packages that have a newer version, and the
 * command that updates them. Silent when there is nothing to say, and on any failure —
 * the operator asked about pi-outpost, not about this.
 */
export async function hintPiPackagesBehind(options: Pick<PiPackagesUpdateOptions, "list" | "lookup" | "log">): Promise<void> {
  const say = options.log ?? ((line: string) => console.log(line));
  try {
    const checked = await checkPiPackages(await options.list(), { enabled: true, disabledReason: "", force: true, lookup: options.lookup });
    const behind = checked.filter((entry) => entry.check?.state === "newer");
    if (behind.length === 0) return;
    say(`[pi] ${behind.length === 1 ? "a pi package has" : `${behind.length} pi packages have`} a newer version: ${behind.map(labelOf).join(", ")}`);
    say(`[pi]   "pi-outpost update --extensions" updates ${behind.length === 1 ? "it" : "them"}`);
  } catch {
    // Silent, as said.
  }
}
