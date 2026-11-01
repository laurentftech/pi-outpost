/**
 * Grants: what the user may let one command of the agent's confined shell — or every command of
 * one session — reach beyond the sandbox. Named hosts, and directories read or read-write.
 *
 * A grant is asked for by the agent and given only by a click in the interface. This module
 * decides what can be asked at all: some targets are refused before anyone is asked, whatever the
 * user would click, because confinement exists to protect them — the agent directory (the provider
 * keys), the configuration file, an extension's `.pi` policy, and grants so broad they would undo
 * the sandbox (a drive's root, the home directory itself, the loopback).
 */
import { homedir } from "node:os";
import path from "node:path";
import { isAllowedHostPattern } from "./egressProxy.ts";
import { isWithin, realResolve } from "./sandbox.ts";
import { isPosixMxc, runnerKind } from "./terminalSandbox.ts";

export type GrantAccess = "read" | "write";
export type GrantScope = "once" | "session";

export interface GrantedDirectory {
  /** Absolute, symlinks resolved. */
  path: string;
  access: GrantAccess;
}

export interface Grant {
  hosts: string[];
  directories: GrantedDirectory[];
}

export const EMPTY_GRANT: Grant = { hosts: [], directories: [] };

/** What the sandbox already gives a command, so that a grant asks only for more. */
export interface GrantContext {
  root: string;
  allowWrite: boolean;
  writableRoot?: string;
  agentDir?: string;
  configFile?: string;
  /** Default: the user's home directory. */
  home?: string;
  /** Bash runs in a WSLC container (`sandbox.bashImage`), whose mounts are fixed when it starts. */
  wslc?: boolean;
  /** Whose filesystem: Windows compares names whatever their case. Default: this host's. */
  platform?: NodeJS.Platform;
}

/**
 * Why a runner may not have the user asked about a host, or undefined when it may. Each command
 * gets a proxy of its own on the loopback, waiting on a question about it, so a runner qualifies
 * only once a command under it is shown to reach its own proxy and no other loopback port
 * (`confinedNetworkMxc.test.ts`, `sandboxGrantsReal.test.ts`). Elsewhere an unlisted host is refused.
 */
export function hostGrantsRefusal(runner: string): string | undefined {
  if (runnerKind(runner) === "mxc" && !isPosixMxc(runner)) return undefined;
  return `host grants are not yet proven under ${path.basename(runner)}: a command there must be shown to reach no other proxy on the loopback`;
}

export interface GrantRefusal {
  target: string;
  why: string;
}

export type GrantCheck = { ok: true; grant: Grant } | { ok: false; refusals: GrantRefusal[] };

/** Whether a grant asks for nothing. */
export function isEmptyGrant(grant: Grant): boolean {
  return grant.hosts.length === 0 && grant.directories.length === 0;
}

/** Two grants together; a directory asked twice keeps the wider access. */
export function mergeGrants(...grants: Grant[]): Grant {
  const hosts = new Set<string>();
  const directories = new Map<string, GrantAccess>();
  for (const grant of grants) {
    for (const host of grant.hosts) hosts.add(host);
    for (const directory of grant.directories) {
      if (directories.get(directory.path) !== "write") directories.set(directory.path, directory.access);
    }
  }
  return { hosts: [...hosts], directories: [...directories].map(([dir, access]) => ({ path: dir, access })) };
}

/** The directories of a grant with the given access, write grants being readable too. */
export function grantedPaths(grant: Grant, access: GrantAccess): string[] {
  return grant.directories.filter((directory) => access === "read" || directory.access === "write").map((directory) => directory.path);
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Why a host may never be granted, or undefined when it may. */
export function forbiddenHost(host: string): string | undefined {
  if (host.includes("*")) return "a grant names one host, not a pattern";
  if (host.endsWith(".")) return "name the host without a trailing dot";
  if (host.includes(":") || host.includes("[") || IPV4.test(host)) return "a grant names a host by its name, never an IP address";
  const name = host.toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost")) return "the loopback is never granted: it is where the server and its proxy listen";
  if (!isAllowedHostPattern(name)) return "not a host name";
  return undefined;
}

/**
 * A path as the filesystem compares it. Windows' names are case-insensitive, and `realpath` cannot
 * give the case of a part that does not exist yet — a `.PI` about to be created is the `.pi` it becomes.
 */
function comparable(file: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? file.toLowerCase() : file;
}

/** Why a resolved directory may never be granted, or undefined when it may. */
async function forbiddenDirectory(resolved: string, context: GrantContext): Promise<string | undefined> {
  const platform = context.platform ?? process.platform;
  const asked = comparable(resolved, platform);
  const protectedTargets: Array<[string | undefined, string]> = [
    [context.agentDir, "the agent directory holds the provider keys"],
    [context.configFile, "the configuration file says what the sandbox is"],
  ];
  for (const [target, why] of protectedTargets) {
    if (target === undefined) continue;
    const real = comparable(await realResolve(target), platform);
    if (isWithin(asked, real) || isWithin(real, asked)) return why;
  }
  if (asked.split(path.sep).includes(".pi")) return "a .pi directory may hold an extension's policy";
  if (path.parse(resolved).root === resolved) return "a drive's root would undo the sandbox";
  const home = await realResolve(context.home ?? homedir());
  if (asked === comparable(home, platform)) return "the home directory itself would undo the sandbox: name the directory inside it";
  return undefined;
}

/**
 * The grant a request may be shown to the user with: every target checked, what the sandbox
 * already gives dropped. Refused, naming each forbidden target and why, when any target is.
 */
export async function checkGrantRequest(
  request: { directories?: ReadonlyArray<{ path: string; access: GrantAccess }> },
  context: GrantContext,
): Promise<GrantCheck> {
  const refusals: GrantRefusal[] = [];
  if (context.wslc && (request.directories ?? []).length > 0) {
    for (const asked of request.directories ?? []) {
      refusals.push({ target: asked.path, why: "bash runs in a WSLC container, whose mounts are fixed when it starts" });
    }
    return { ok: false, refusals };
  }
  const root = await realResolve(context.root);
  const writable = context.allowWrite ? await realResolve(context.writableRoot ?? context.root) : undefined;
  const directories: GrantedDirectory[] = [];
  for (const asked of request.directories ?? []) {
    // A relative path means the root's, as the agent's shell starts there.
    const resolved = await realResolve(path.resolve(root, asked.path));
    const why = await forbiddenDirectory(resolved, context);
    if (why) {
      refusals.push({ target: asked.path, why });
      continue;
    }
    const given = asked.access === "write" ? writable !== undefined && isWithin(writable, resolved) : isWithin(root, resolved);
    if (!given) directories.push({ path: resolved, access: asked.access });
  }
  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, grant: mergeGrants({ hosts: [], directories }) };
}

/** A grant in a line: for the log, the dialog's title and the tool result. */
export function describeGrant(grant: Grant): string {
  return [
    ...grant.hosts.map((host) => `host ${host}`),
    ...grant.directories.map((directory) => `${directory.access === "write" ? "read-write" : "read"} ${directory.path}`),
  ].join(", ");
}
