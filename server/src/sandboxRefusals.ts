/**
 * What the sandbox refused a command of the agent's confined shell, in one shape whatever told
 * it: landstrip's JSON lines, the egress proxy's refused hosts, MXC's denial report.
 *
 * A refusal is about a resource a rule could name — a directory with an access, or a host — or it
 * is information only: shown, never offered as a rule (a socket landstrip refused, a registry key,
 * an IP address). A file is recorded against its directory, since that is what a grant and a rule
 * widen.
 */
import { statSync } from "node:fs";
import path from "node:path";
import type { GrantAccess } from "./sandboxGrants.ts";
import { forbiddenHost } from "./sandboxGrants.ts";

export type Refusal =
  | { kind: "directory"; target: string; access: GrantAccess; command: string }
  | { kind: "host"; target: string; command: string }
  | { kind: "info"; target: string; detail: string; command: string };

/** The longest command text kept with a refusal: enough to recognise it, not a script's whole body. */
export const REFUSAL_COMMAND_MAX = 400;

function commandText(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();
  return flat.length > REFUSAL_COMMAND_MAX ? `${flat.slice(0, REFUSAL_COMMAND_MAX - 1)}…` : flat;
}

/** One key per thing a rule could be about: a command refused the same thing twice records it once. */
export function refusalKey(refusal: Refusal): string {
  return refusal.kind === "directory" ? `directory:${refusal.access}:${refusal.target}` : `${refusal.kind}:${refusal.target}`;
}

const WRITE_OPERATIONS = new Set(["write", "create", "delete", "unlink", "rename", "mkdir", "rmdir", "truncate", "chmod", "chown", "link", "symlink", "utime"]);
const READ_OPERATIONS = new Set(["read", "open", "exec", "execute", "stat", "readdir", "list", "readlink", "access"]);

/** The access an operation needs, or undefined when it is neither a plain read nor a plain write. */
export function operationAccess(operation: string): GrantAccess | undefined {
  const name = operation.toLowerCase();
  if (WRITE_OPERATIONS.has(name)) return "write";
  if (READ_OPERATIONS.has(name)) return "read";
  return undefined;
}

/**
 * One of landstrip's stderr lines as a refusal, or undefined when it is not one. A refused file
 * becomes its directory; a refused socket (a `bind`, a `connect` to an address) is information
 * only — the proxy names the hosts a rule can be about.
 */
export function landstripRefusal(line: string, command: string, platform: NodeJS.Platform = process.platform): Refusal | undefined {
  if (!line.startsWith("{") || !line.includes('"state":"info"')) return undefined;
  let report: { kind?: unknown; code?: unknown; state?: unknown; operation?: unknown; target?: unknown; path?: unknown };
  try {
    report = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (report.state !== "info" || typeof report.code !== "string" || !report.code.endsWith("_DENIED")) return undefined;
  const operation = typeof report.operation === "string" ? report.operation : "an operation";
  const on = typeof report.path === "string" ? report.path : typeof report.target === "string" ? report.target : undefined;
  const text = commandText(command);
  if (report.kind === "filesystem" && on !== undefined) {
    const paths = platform === "win32" ? path.win32 : path.posix;
    const access = operationAccess(operation);
    if (access !== undefined && paths.isAbsolute(on)) return { kind: "directory", target: paths.dirname(on), access, command: text };
  }
  return { kind: "info", target: on ?? String(report.kind ?? "sandbox"), detail: `${String(report.kind ?? "sandbox")} ${operation}`, command: text };
}

/** A host the proxy refused a command, or the user did: information only when no rule could name it. */
export function hostRefusal(host: string, command: string): Refusal {
  const name = host.toLowerCase();
  const forbidden = forbiddenHost(name);
  return forbidden === undefined
    ? { kind: "host", target: name, command: commandText(command) }
    : { kind: "info", target: name, detail: `network: ${forbidden}`, command: commandText(command) };
}

/** What a diagnosis keeps out of MXC's report: the way down to the root, and the system's own files. */
export interface MxcReportContext {
  root: string;
  command: string;
  /** `%SystemRoot%`: conhost and the loader are refused things there that no rule is about. */
  systemRoot?: string;
  /** `%ProgramFiles%`: its `WindowsApps` holds language packs conhost is refused writing to. */
  programFiles?: string;
}

const lowerWin = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");
const withinWin = (child: string, parent: string) => {
  const c = lowerWin(child), p = lowerWin(parent);
  return c === p || c.startsWith(`${p}\\`);
};

/**
 * MXC's denial report (Windows, `processContainer.captureDenials`) as refusals: the files and
 * directories it names, each as the directory a rule would widen. Measured on Windows 11 (see
 * `research.md`): beside the refusal sit the root's ancestors (read), the root itself (execute,
 * write), conhost's registry key, its language file and UI handles. Those are left out, as is
 * anything that is not a file; a directory's path ends with `\`.
 */
export function mxcReportRefusals(report: unknown, context: MxcReportContext): Refusal[] {
  const denials = (report as { denials?: unknown } | null)?.denials;
  if (!Array.isArray(denials)) return [];
  const text = commandText(context.command);
  const noise = [context.systemRoot, context.programFiles && path.win32.join(context.programFiles, "WindowsApps")].filter((p): p is string => Boolean(p));
  const refusals: Refusal[] = [];
  for (const denial of denials as Array<{ resource?: unknown; resourceType?: unknown; accessType?: unknown }>) {
    if (denial.resourceType !== "file" || typeof denial.resource !== "string") continue;
    const access: GrantAccess | undefined = denial.accessType === "write" ? "write" : denial.accessType === "read" || denial.accessType === "execute" ? "read" : undefined;
    if (access === undefined || !path.win32.isAbsolute(denial.resource)) continue;
    const isDirectory = /[\\/]$/.test(denial.resource);
    const target = isDirectory ? denial.resource.replace(/[\\/]+$/, "") || denial.resource : path.win32.dirname(denial.resource);
    // The root and the way down to it: refused listing on the way, never what the command wanted.
    if (withinWin(context.root, target)) continue;
    if (noise.some((dir) => withinWin(target, dir))) continue;
    refusals.push({ kind: "directory", target, access, command: text });
  }
  return refusals;
}

/**
 * MXC's denial report on macOS (`seatbelt.captureDenials`) as refusals: each file Seatbelt
 * refused, as the directory a rule would widen. Measured on an Apple M1 (see `research.md`): a
 * file is named by its own resolved path, with `read` or `write`; a directory refused a listing
 * is named the same way, so `isDirectory` tells them apart. Everything else in the report — Mach
 * services, shared memory, `sysctl`, the resolver's socket, the pasteboard — is not a `file`, is
 * refused every command whatever it does, and is left out: no rule names it.
 */
export function seatbeltReportRefusals(report: unknown, command: string, isDirectory: (file: string) => boolean = isDirectoryOnDisk): Refusal[] {
  const denials = (report as { denials?: unknown } | null)?.denials;
  if (!Array.isArray(denials)) return [];
  const text = commandText(command);
  const refusals: Refusal[] = [];
  for (const denial of denials as Array<{ resource?: unknown; resourceType?: unknown; accessType?: unknown }>) {
    if (denial.resourceType !== "file" || typeof denial.resource !== "string" || !path.posix.isAbsolute(denial.resource)) continue;
    const access: GrantAccess | undefined = denial.accessType === "write" ? "write" : denial.accessType === "read" || denial.accessType === "execute" ? "read" : undefined;
    if (access === undefined) continue;
    const resource = path.posix.normalize(denial.resource);
    refusals.push({ kind: "directory", target: isDirectory(resource) ? resource : path.posix.dirname(resource), access, command: text });
  }
  return refusals;
}

function isDirectoryOnDisk(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** The report MXC wrote for `reportPath`: it adds `.<pid>_<hash>` before `.json`. Undefined when none. */
export function mxcReportFile(names: readonly string[], reportPath: string): string | undefined {
  // win32's reads both separators: the path is Windows' or macOS', on whatever host.
  const stem = path.win32.basename(reportPath, ".json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${stem}(\\.\\d+_[0-9a-f]+)?\\.json$`, "i");
  return names.find((name) => pattern.test(name));
}

/**
 * Collects one command's refusals, each once, and passes each new one on as it comes. What the
 * command's output ends with, and what is recorded for the project, both read from it.
 */
export function refusalCollector(onRefusal?: (refusal: Refusal) => void): { add: (refusal: Refusal | undefined) => void; all: () => Refusal[] } {
  const seen = new Map<string, Refusal>();
  return {
    add: (refusal) => {
      if (refusal === undefined) return;
      const key = refusalKey(refusal);
      if (seen.has(key)) return;
      seen.set(key, refusal);
      onRefusal?.(refusal);
    },
    all: () => [...seen.values()],
  };
}
