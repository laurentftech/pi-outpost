/**
 * Is the agent's shell (or the terminal) really confined? Asked of the real runner, not of the
 * configuration.
 *
 * A runner's self-check proves it starts. This proves its limits hold: one command, run through
 * the same runner with the same policy as a real one, tries what confinement must refuse, and
 * the verdict is what the interface's lock is drawn from. A lock earned by configuration alone is
 * a false sense of security: a policy that a bug or a host quirk left open would wear it anyway.
 *
 * The bait is the server's, prepared before the run and removed after: a marker file in the agent
 * directory, a private directory outside the root with a marker in it, a variable in the server's
 * own environment, and a throwaway process of the server's user to signal. Where an attempt
 * cannot mean anything — the private directory falls inside the root — it is "not checked", never
 * a false alarm. The write and the signal are judged on the host, not on the command's word:
 * Bubblewrap may accept a write beside the root in its private tmpfs, and that is not a leak.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ConfinementAttempt, ConfinementVerdict } from "@pi-outpost/shared";

/** The line the canary prints for each attempt. */
const MARK = "PI_OUTPOST_CANARY";

export interface CanaryBait {
  id: string;
  /** A file in the agent directory: reading it must fail. Absent when it could not be made. */
  agentMarker?: string;
  /** A private directory outside the root, holding `marker`: reading it and writing in it must fail. */
  besideDir?: string;
  envName: string;
  envValue: string;
  /** A throwaway process of the server's user: signalling it must fail. */
  victim?: ChildProcess;
  notChecked: Array<{ attempt: ConfinementAttempt; why: string }>;
  cleanup(): Promise<void>;
}

export interface BaitOptions {
  agentDir?: string;
  /** Real paths: what the command may read, and where it may write. */
  root: string;
  writableRoot?: string;
}

export async function prepareBait(options: BaitOptions): Promise<CanaryBait> {
  const id = randomBytes(6).toString("hex");
  const notChecked: CanaryBait["notChecked"] = [];
  let agentMarker: string | undefined;
  if (options.agentDir && existsSync(options.agentDir)) {
    const marker = path.join(options.agentDir, `.pi-outpost-canary-${id}`);
    try {
      await writeFile(marker, "canary", { mode: 0o600 });
      agentMarker = marker;
    } catch (error) {
      notChecked.push({ attempt: "agent-directory", why: `the agent directory takes no marker: ${(error as Error).message}` });
    }
  } else {
    notChecked.push({ attempt: "agent-directory", why: "no agent directory" });
  }
  let besideDir: string | undefined = await realpath(await mkdtemp(path.join(tmpdir(), "pi-outpost-canary-")));
  await writeFile(path.join(besideDir, "marker"), "canary", { mode: 0o600 });
  const zones = [options.root, ...(options.writableRoot ? [options.writableRoot] : [])];
  if (zones.some((zone) => contains(zone, besideDir!))) {
    const why = `the system's temporary directory (${tmpdir()}) is inside the sandbox root`;
    notChecked.push({ attempt: "beside-root", why }, { attempt: "write-beside-root", why });
    await rm(besideDir, { recursive: true, force: true });
    besideDir = undefined;
  }
  const victim = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "ignore" });
  const envName = `PI_OUTPOST_CANARY_${id.toUpperCase()}`;
  const envValue = `canary-${id}`;
  process.env[envName] = envValue;
  return {
    id,
    ...(agentMarker ? { agentMarker } : {}),
    ...(besideDir ? { besideDir } : {}),
    envName,
    envValue,
    victim,
    notChecked,
    async cleanup() {
      delete process.env[envName];
      victim.kill("SIGKILL");
      if (agentMarker) await rm(agentMarker, { force: true });
      if (besideDir) await rm(besideDir, { recursive: true, force: true });
    },
  };
}

/** Whether `target` is `zone` or inside it — a filesystem root included. */
function contains(zone: string, target: string): boolean {
  const relative = path.relative(zone, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const quoteSh = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
const quotePs = (text: string) => `'${text.replaceAll("'", "''")}'`;

export interface ScriptOptions {
  powerShell: boolean;
  /** Under `sandbox.allowedHosts`: the network must reach nothing but the proxy's listed hosts. */
  proxied: boolean;
  /** The server's process id, whose environment must stay unreadable (Linux's `/proc`). */
  serverPid: number;
}

/** The canary command, in the shell's language: one `PI_OUTPOST_CANARY <attempt> refused|reached|unchecked` line per attempt. */
export function canaryScript(bait: CanaryBait, options: ScriptOptions): string {
  return options.powerShell ? powerShellCanary(bait, options) : posixCanary(bait, options);
}

function posixCanary(bait: CanaryBait, options: ScriptOptions): string {
  const lines = [
    `r() { if [ "$2" = 0 ]; then echo "${MARK} $1 reached"; else echo "${MARK} $1 refused"; fi; }`,
  ];
  if (bait.agentMarker) lines.push(`cat ${quoteSh(bait.agentMarker)} >/dev/null 2>&1; r agent-directory $?`);
  if (bait.besideDir) {
    lines.push(`cat ${quoteSh(path.join(bait.besideDir, "marker"))} >/dev/null 2>&1; r beside-root $?`);
    lines.push(`(echo x > ${quoteSh(path.join(bait.besideDir, "written"))}) 2>/dev/null; r write-beside-root $?`);
  }
  if (bait.victim?.pid) lines.push(`kill -TERM ${bait.victim.pid} 2>/dev/null; r signal-process $?`);
  // Its own environment must never carry the server's; where there is a /proc, the server's own
  // environment must not be readable either (landstrip on Linux lets it be: judged by its content).
  lines.push(`env | grep -q ${quoteSh(`${bait.envName}=`)}; r server-environment $?`);
  lines.push(`[ -r /proc/${options.serverPid}/environ ] && head -c 1 /proc/${options.serverPid}/environ >/dev/null 2>&1; r server-process-environment $?`);
  if (options.proxied) {
    // One statement per line, so the script also runs joined into a single `-c` argument.
    lines.push(
      `if command -v curl >/dev/null 2>&1; then curl -s -o /dev/null -m 10 https://canary.invalid/; r unlisted-host $?; curl -s -o /dev/null -m 5 --noproxy '*' https://1.1.1.1/; r direct-connection $?; else echo "${MARK} unlisted-host unchecked"; echo "${MARK} direct-connection unchecked"; fi`,
    );
  }
  lines.push("exit 0", "");
  return lines.join("\n");
}

function powerShellCanary(bait: CanaryBait, options: ScriptOptions): string {
  const lines = [`function Report-Canary($n, $ok) { if ($ok) { "${MARK} $n reached" } else { "${MARK} $n refused" } }`];
  const reads = (file: string) => `try { [IO.File]::ReadAllBytes(${quotePs(file)}) | Out-Null; $true } catch { $false }`;
  if (bait.agentMarker) lines.push(`Report-Canary agent-directory (${reads(bait.agentMarker)})`);
  if (bait.besideDir) {
    lines.push(`Report-Canary beside-root (${reads(path.join(bait.besideDir, "marker"))})`);
    lines.push(`Report-Canary write-beside-root (try { [IO.File]::WriteAllText(${quotePs(path.join(bait.besideDir, "written"))}, 'x'); $true } catch { $false })`);
  }
  if (bait.victim?.pid) lines.push(`Report-Canary signal-process (try { [System.Diagnostics.Process]::GetProcessById(${bait.victim.pid}).Kill(); $true } catch { $false })`);
  lines.push(`Report-Canary server-environment ([bool][Environment]::GetEnvironmentVariable(${quotePs(bait.envName)}))`);
  if (options.proxied) {
    lines.push(
      `Report-Canary unlisted-host (try { Invoke-WebRequest -Uri 'https://canary.invalid/' -UseBasicParsing -TimeoutSec 10 | Out-Null; $true } catch { $false })`,
      `Report-Canary direct-connection (try { $c = [System.Net.Sockets.TcpClient]::new(); $ok = $c.ConnectAsync('1.1.1.1', 443).Wait(5000); $c.Dispose(); $ok } catch { $false })`,
    );
  }
  lines.push("exit 0", "");
  return lines.join("\n");
}

/** Every attempt the canary should report, given its bait and options. */
export function expectedAttempts(bait: CanaryBait, options: Pick<ScriptOptions, "proxied"> & { powerShell?: boolean }): ConfinementAttempt[] {
  return [
    ...(bait.agentMarker ? (["agent-directory"] as const) : []),
    ...(bait.besideDir ? (["beside-root", "write-beside-root"] as const) : []),
    ...(bait.victim?.pid ? (["signal-process"] as const) : []),
    "server-environment",
    ...(options.powerShell ? [] : (["server-process-environment"] as const)),
    ...(options.proxied ? (["unlisted-host", "direct-connection"] as const) : []),
  ];
}

/**
 * The verdict from the canary's output, and from what the host saw: a file beside the root and a
 * process alive or not are facts of the host, whatever the command believed it did.
 */
export function readCanary(
  output: string,
  expected: readonly ConfinementAttempt[],
  host: { wroteBeside?: boolean; victimAlive?: boolean; serverSecrets?: readonly string[] },
  base: { runner: string; checkedAt: string; notChecked: CanaryBait["notChecked"] },
): ConfinementVerdict {
  const said = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = new RegExp(`^${MARK} ([a-z-]+) (refused|reached|unchecked)\\s*$`).exec(line.trim());
    if (match) said.set(match[1], match[2]);
  }
  const reached: ConfinementAttempt[] = [];
  const refused: ConfinementAttempt[] = [];
  const notChecked = [...base.notChecked];
  for (const attempt of expected) {
    let outcome = said.get(attempt);
    if (attempt === "write-beside-root" && host.wroteBeside !== undefined) outcome = host.wroteBeside ? "reached" : "refused";
    if (attempt === "signal-process" && host.victimAlive !== undefined) outcome = host.victimAlive ? "refused" : "reached";
    if (outcome === undefined) {
      const tail = output.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 300);
      return { state: "failed", runner: base.runner, checkedAt: base.checkedAt, reason: `the canary did not report "${attempt}"${tail ? `: ${tail}` : ""}` };
    }
    if (outcome === "reached") reached.push(attempt);
    else if (outcome === "refused") refused.push(attempt);
    else notChecked.push({ attempt, why: "the shell has no curl" });
  }
  // The server's process environment readable, and nothing else: landstrip's known gap, judged
  // by what that environment holds.
  const environmentReadable = reached.includes("server-process-environment");
  if (environmentReadable && reached.length === 1) {
    const exposed = [...(host.serverSecrets ?? [])];
    return exposed.length > 0
      ? { state: "partial", runner: base.runner, checkedAt: base.checkedAt, refused, exposed, notChecked }
      : { state: "verified", runner: base.runner, checkedAt: base.checkedAt, refused, notChecked, environmentReadable: true };
  }
  return reached.length > 0
    ? { state: "leaking", runner: base.runner, checkedAt: base.checkedAt, reached, refused }
    : { state: "verified", runner: base.runner, checkedAt: base.checkedAt, refused, notChecked };
}

/** Names that hold a secret: keys, tokens, secrets, passwords, credentials. */
const SECRET_NAME = /(API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)/i;

/** The secret-looking variables of an environment, by name only, non-empty values only. */
export function secretVariables(environment: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(environment)
    .filter(([name, value]) => value && SECRET_NAME.test(name) && !name.startsWith("PI_OUTPOST_CANARY_"))
    .map(([name]) => name)
    .sort();
}

/**
 * The server's environment as another process reads it: on Linux, `/proc/self/environ` — fixed when
 * the process started, whatever `process.env` became since. Elsewhere, `process.env`.
 */
export async function serverEnvironment(): Promise<Record<string, string>> {
  if (process.platform === "linux") {
    try {
      const raw = await readFile("/proc/self/environ", "utf8");
      return Object.fromEntries(
        raw
          .split("\0")
          .filter(Boolean)
          .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
      );
    } catch {
      // Fall through to what the process holds.
    }
  }
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export interface CanaryRun extends BaitOptions {
  runner: string;
  powerShell: boolean;
  proxied: boolean;
  /** Runs one command through the runner, as a real command of that surface runs, and returns its output. */
  exec: (command: string) => Promise<string>;
}

/** Prepare the bait, run the canary through the runner, judge, clean up. Never throws: a failure is a verdict. */
export async function runCanary(run: CanaryRun): Promise<ConfinementVerdict> {
  const checkedAt = new Date().toISOString();
  let bait: CanaryBait | undefined;
  try {
    bait = await prepareBait(run);
    const options = { powerShell: run.powerShell, proxied: run.proxied, serverPid: process.pid };
    const output = await run.exec(canaryScript(bait, options));
    const wroteBeside = bait.besideDir ? existsSync(path.join(bait.besideDir, "written")) : undefined;
    // A signal takes a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const victimAlive = bait.victim ? bait.victim.exitCode === null && bait.victim.signalCode === null : undefined;
    const serverSecrets = secretVariables(await serverEnvironment());
    return readCanary(output, expectedAttempts(bait, options), { wroteBeside, victimAlive, serverSecrets }, { runner: run.runner, checkedAt, notChecked: bait.notChecked });
  } catch (error) {
    return { state: "failed", runner: run.runner, checkedAt, reason: (error as Error).message };
  } finally {
    await bait?.cleanup().catch(() => {});
  }
}
