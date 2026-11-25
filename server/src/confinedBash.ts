/**
 * The agent's `bash`, every command run inside a sandbox runner.
 *
 * pi's `bash` lets its caller replace how a command runs (`BashOperations`). With
 * `sandbox.bashRunner` set, pi-outpost's own `bash` keeps pi's tool — schema, prompt,
 * rendering, truncation — and runs each command through the runner instead of a local
 * shell, with the policy a confined terminal gets in the same workspace
 * (`terminalSandbox.ts`). One launch per command: pi's `bash` keeps no shell between
 * calls either.
 *
 * Fail closed: an unusable runner refuses every command with its reason, and nothing
 * ever runs unconfined.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import type { ConfinementRemedy, SandboxGrantOutcome } from "@pi-outpost/shared";
import { startEgressProxy, type EgressProxy, type EgressProxyOptions } from "./egressProxy.ts";
import { EMPTY_GRANT, forbiddenHost, isApproved, isEmptyGrant, mergeGrants, type Grant } from "./sandboxGrants.ts";
import { RUN_WITH_GRANT_TOOL } from "./sandboxGrantTool.ts";
import { linuxMxcExecutor, mxcMissingReason, mxcRunsInProcess } from "./mxcExecutor.ts";
import { isSecurityEnvironmentRefusal, mxcSdk, runThroughSdk, SdkDocumentRefused, sdkRequest, type MxcSdk, type MxcWireRequest, type SdkMetadata } from "./mxcSdk.ts";
import { hostRefusal, landstripRefusal, mxcReportFile, mxcReportRefusals, refusalCollector, refusalKey, seatbeltReportRefusals, type Refusal } from "./sandboxRefusals.ts";
import { refusedHost, type RefusedHost } from "./sandboxNetworkVerdict.ts";
import {
  checkRunner,
  confinedEnvironment,
  gitReadOnlyFiles,
  isPosixMxc,
  mxcDiagnosticConfig,
  mxcMacCaptureRequest,
  mxcPosixConfig,
  proxyEnvironment,
  carryUserConfigs,
  seatbeltPolicy,
  mxcTerminalConfig,
  enumerateLevelFlags,
  mxcEnumerateLevel,
  noteMxcEnumerateLevel,
  runnerKind,
  siblingsToDeny,
  terminalPolicy,
  type MxcMacConfig,
  type MxcTerminalInput,
  type RunnerCheck,
  type WindowsToolchains,
  msysNote,
  msysProgramNamed,
  heldReadOnlyInside,
} from "./terminalSandbox.ts";

export interface ConfinedBashOptions {
  /** `sandbox.bashRunner`: MXC's executor or landstrip's binary. */
  runner: string;
  /** Seconds a command given no timeout may run. Default `DEFAULT_COMMAND_TIMEOUT_SECONDS`; tests set less. */
  defaultTimeout?: number;
  /**
   * `sandbox.bashShell`. Default `/bin/bash`; Windows has none that works by default.
   * PowerShell (see `isPowerShell`) runs the command as a `.ps1` script instead.
   */
  shell?: string;
  /**
   * `sandbox.bashImage`, experimental: with MXC, run each command in this Linux image
   * through the WSLC backend instead (see `mxcWslcConfig`).
   */
  image?: string;
  /** The sandbox root: what a command may read, and where it starts. */
  root: string;
  /** Where it may write; undefined with `allowWrite`: the whole root. */
  writableRoot?: string;
  allowWrite: boolean;
  /** Never readable: the provider keys. */
  agentDir?: string;
  /** Never readable. */
  configFile?: string;
  /** The user's git configuration, read-only inside: git's identity (see `userGitConfig`). */
  gitConfig?: string;
  /** The signing relay's shim (`signingRelay.ts`), when it runs: `gpg.program` points at it. */
  signingShim?: string;
  /**
   * `sandbox.allowedHosts`' proxy (`egressProxy.ts`): under MXC, Seatbelt, or landstrip on Linux. The
   * hosts it refuses while a command runs are named after the command's output.
   */
  networkProxy?: Pick<EgressProxy, "url" | "watchRefusals">;
  /**
   * MXC's process container on Windows: the sandbox cache, writable, the toolchain homes, readable,
   * and the variables pointing tools at them (`windowsToolchains`).
   */
  toolchains?: WindowsToolchains;
  /** `sandbox.hostLoopback`: MXC on Windows only, without a proxy (see `mxcTerminalConfig`). */
  hostLoopback?: boolean;
  /** `sandbox.privateNetwork`: MXC on Windows only, without a proxy (see `mxcTerminalConfig`). */
  privateNetwork?: boolean;
  /** `sandbox.allowedHosts` itself, which a command's own proxy starts from. */
  allowedHosts?: readonly string[];
  /**
   * Asks the user about a host the list does not name, while the command's connection to it
   * waits (`sandboxGrantBroker.ts`). With it, each command gets a proxy of its own — the list
   * and the session's hosts — that asks, and is closed after the command. Absent: an unlisted
   * host is refused at once, by the shared proxy.
   */
  askHost?: (request: { command: string; host: string; signal?: AbortSignal }) => Promise<SandboxGrantOutcome>;
  /** How a command's own proxy is started. A parameter for tests. */
  startProxy?: (options: EgressProxyOptions) => Promise<EgressProxy>;
  /** Whose rules. A parameter so the Windows path is tested everywhere. */
  platform?: NodeJS.Platform;
  /**
   * Asked before every command: a refusal, or nothing. `"auto"` passes one that waits for the
   * runner's self-check and the confinement canary (see `autoRunner.ts`), so a runner the server
   * chose runs nothing it has not shown it confines.
   */
  gate?: () => Promise<string | undefined>;
  /** The runner's self-check. A parameter for tests; cached per runner otherwise. */
  check?: (runner: string) => Promise<RunnerCheck>;
  /**
   * The session's grants (`sandboxGrants.ts`), read at each launch: what the user allowed every
   * command of this session beyond the sandbox. Absent: none.
   */
  grants?: () => Grant;
  /**
   * Told of each thing the sandbox refused a command, once per command, as it is known
   * (`sandboxRefusals.ts`): what is recorded for the project.
   */
  onRefusal?: (refusal: Refusal) => void;
  /**
   * MXC's SDK, for a diagnosis (`mxcSdkDiagnosis.ts`): undefined where it cannot load, and the
   * executor runs the diagnosis instead. A parameter for tests; loaded once otherwise.
   */
  mxcSdk?: () => Promise<{ sdk: MxcSdk } | { reason: string }>;
  /**
   * The user's always-allow directories (`sandboxRules.ts`), read at each launch so a revoke
   * applies from the next command: already checked, existing, and not what the sandbox gives.
   * Never applied to a diagnosis. Absent: none.
   */
  ruleGrant?: () => Promise<Grant>;
  /**
   * `sandbox.readOnlyPaths`, read only, for each launch: part of the sandbox the file describes,
   * so a diagnosis keeps them too — what it reports is then what the configuration does not give.
   */
  readOnlyGrant?: () => Promise<Grant>;
  /**
   * What the user's rules say of a host a command connects to, asked before anyone is: always
   * refuse answers at once, always allow lets it through. Absent: no rules.
   */
  hostRule?: (host: string) => Promise<"allow" | "refuse" | undefined>;
  /**
   * `sandbox.gitWritable`: the repository's `.git` stays writable to a command. Default: held
   * read-only where it exists (`heldReadOnlyInside`), a write grant on it opening it for its command.
   */
  gitWritable?: boolean;
}

type ExecOptions = Parameters<BashOperations["exec"]>[2];

/** pi's `BashOperations`, and one command run with a grant the user approved for it alone. */
export interface ConfinedBashOperations extends BashOperations {
  execWithGrant(command: string, cwd: string, options: ExecOptions, grant: Grant): ReturnType<BashOperations["exec"]>;
  /**
   * Present only where the runner says what it refused on demand alone (MXC on Windows): the
   * command once more under a narrower sandbox, its output replaced by what was refused
   * (`mxcDiagnosticConfig`). The agent asks for it; nothing here calls it on its own.
   */
  diagnose?(command: string, cwd: string, options: ExecOptions): ReturnType<BashOperations["exec"]>;
}

/** How many failed commands keep their offer of a diagnosis, the oldest forgotten first. */
const MAX_OFFERED = 64;

/** The shell tool's option that asks for a diagnosis. */
export const DIAGNOSE_OPTION = "diagnose";

/** What ends a failed command where the sandbox says nothing on its own: that a diagnosis can. */
export function diagnosisOfferNote(): string {
  return (
    `[pi-outpost] This output reports an access denied, and this sandbox does not say on its own what it refused. To learn whether it was the sandbox, ` +
    `run the same command again with ${DIAGNOSE_OPTION}: true — it runs once more under a narrower sandbox, without network, ` +
    `and returns only what the sandbox refused. Its effects happen again: never diagnose a command that must not run twice. ` +
    `"Access denied" starting a program (a tool installed for the user, the Python a virtual environment points at) is such a path: ` +
    `the program's folder is refused — the diagnosis names it, and ${RUN_WITH_GRANT_TOOL} can ask the user for it, read only.`
  );
}

/**
 * What ends a command run with `diagnose` before it failed: it ran as usual. A diagnosis takes the
 * network away and hides the output, so one asked at once leaves the agent nothing to judge by,
 * and the user no question about a host.
 */
export function diagnosisIgnoredNote(): string {
  return (
    `[pi-outpost] ${DIAGNOSE_OPTION} was ignored: this command had not just failed here, so it ran as usual, output and network included. ` +
    `Ask for a diagnosis only after it fails reporting an access denied.`
  );
}

/**
 * What ends a command the sandbox refused directories while it ran (landstrip tells each as it
 * happens): each directory and its access, so the agent can ask for exactly that. Undefined for none.
 */
export function refusedDirectoriesNote(refusals: readonly Refusal[]): string | undefined {
  const directories = refusals.filter((refusal) => refusal.kind === "directory");
  if (directories.length === 0) return undefined;
  const lines = directories.map((refusal) => `[pi-outpost] the sandbox refused ${refusal.access === "write" ? "writing to" : "reading"} ${refusal.target}.`);
  lines.push("[pi-outpost] If the task needs one of these, ask run_with_grant for exactly it; judge the command by its exit status and output.");
  return lines.join("\n");
}

/** What a diagnosis returns in place of the command's output. */
export function diagnosisNote(refusals: readonly Refusal[]): string {
  const directories = refusals.filter((refusal) => refusal.kind === "directory");
  if (directories.length === 0) {
    return "[pi-outpost] diagnosis: the sandbox reported no refused directory. The failure is not one it can name: read the command's own error.";
  }
  const lines = directories.map((refusal) => `[pi-outpost] diagnosis: the sandbox refused ${refusal.access === "write" ? "writing to" : "reading"} ${refusal.target}.`);
  lines.push(`[pi-outpost] The command's output is not shown. If the task needs one of these, ask run_with_grant for exactly it.`);
  return lines.join("\n");
}

/** What ends a command whose hosts the proxy refused without anyone to ask: which ones, and the way through. */
export function refusalNote(hosts: string[]): string {
  const them = hosts.length > 1 ? "them" : "it";
  return `[pi-outpost] network refused: ${hosts.join(", ")} — not in sandbox.allowedHosts. Ask the user to add ${them} there if the command needs ${them}.`;
}

/**
 * One of landstrip's own lines, read as the agent should: a refusal landstrip reports on stderr
 * (`{"kind":"filesystem","code":"FILESYSTEM_DENIED","state":"info",…}`) becomes one line saying the
 * sandbox refused that one operation; anything else is undefined, and passes as it is.
 *
 * The raw JSON misled the agent: `python3 -m venv` tries a harmless `bind` on `[::1]:0`, and the
 * only line in a successful command's output was that refusal, which it read as the command failing.
 * MXC reports nothing of the kind: the program's own error is all there is.
 */
export function landstripNote(line: string): string | undefined {
  if (!line.startsWith("{") || !line.includes('"state":"info"')) return undefined;
  let report: { kind?: unknown; code?: unknown; state?: unknown; operation?: unknown; target?: unknown; path?: unknown };
  try {
    report = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (report.state !== "info" || typeof report.code !== "string" || !report.code.endsWith("_DENIED")) return undefined;
  const what = typeof report.operation === "string" ? report.operation : "an operation";
  const on = typeof report.target === "string" ? report.target : typeof report.path === "string" ? report.path : undefined;
  return `[sandbox] refused ${what}${on ? ` ${on}` : ""}: outside what this sandbox allows. The command went on; judge it by its exit status and output.`;
}

/**
 * landstrip's stderr, line by line: its refusals rewritten by `landstripNote`, the rest unchanged.
 * A line is held only until its end arrives, and what is left is written at `end`.
 */
export function landstripStderr(onData: (data: Buffer) => void, onLine?: (line: string) => void): { write: (data: Buffer) => void; end: () => void } {
  let pending = "";
  const emit = (raw: string, newline: boolean) => {
    const line = raw.replace(/\r$/, "");
    onLine?.(line);
    onData(Buffer.from(`${landstripNote(line) ?? raw}${newline ? "\n" : ""}`));
  };
  return {
    write: (data) => {
      pending += data.toString("utf8");
      let at;
      while ((at = pending.indexOf("\n")) >= 0) {
        emit(pending.slice(0, at), true);
        pending = pending.slice(at + 1);
      }
    },
    end: () => {
      if (pending) emit(pending, false);
      pending = "";
    },
  };
}

/** What the user answered about a host a command connected to, or why nobody was asked. */
export type HostAnswer = SandboxGrantOutcome | { forbidden: string } | { rule: "refuse" };

/** How an answer reads, in the proxy's refusal and in the note after the command. */
export function hostAnswerText(host: string, answer: HostAnswer): string {
  if (typeof answer === "object") {
    return "rule" in answer
      ? `a rule of the user's always refuses ${host}: it is refused without asking, until the user revokes the rule`
      : `${host} is never granted: ${answer.forbidden}`;
  }
  switch (answer) {
    case "approved-once":
      return `the user allowed ${host} for this command`;
    case "approved-session":
      return `the user allowed ${host} for the rest of the session`;
    case "approved-always":
      return `the user always allows ${host}, from now on`;
    case "refused":
      return `the user refused ${host}`;
    case "refused-always":
      return `the user always refuses ${host}: it will be refused without asking`;
    case "expired":
      return `nobody answered about ${host} in time`;
    case "aborted":
      return `the question about ${host} was cancelled with the turn or the session`;
    case "unattended":
      return `no one was connected to approve ${host}`;
  }
}

/** What ends a command that connected to hosts the list does not name, the user asked about each. */
export function networkNote(answers: ReadonlyMap<string, HostAnswer>): string {
  const lines = [...answers].map(([host, answer]) => `[pi-outpost] network: ${hostAnswerText(host, answer)}.`);
  const refused = [...answers.values()].some((answer) => !isApproved(answer));
  if (refused) lines.push("[pi-outpost] Do not retry a refused host for this request: tell the user what it blocked.");
  return lines.join("\n");
}

/** A grant's directories as the policies take them: read only, and read-write. */
function grantedDirectories(grant: Grant): { grantedRead: string[]; grantedWrite: string[] } {
  return {
    grantedRead: grant.directories.filter((directory) => directory.access === "read").map((directory) => directory.path),
    grantedWrite: grant.directories.filter((directory) => directory.access === "write").map((directory) => directory.path),
  };
}

/** One self-check per runner path, for the life of the server: asked on first use. */
const checks = new Map<string, Promise<RunnerCheck>>();

export function cachedCheck(runner: string): Promise<RunnerCheck> {
  let check = checks.get(runner);
  if (!check) {
    check = checkRunner(runner);
    checks.set(runner, check);
  }
  return check;
}

/** The longest timeout pi's `bash` accepts, in seconds. */
const MAX_TIMEOUT_SECONDS = 24 * 60 * 60;

/** Whether a configured shell is PowerShell, which takes a `.ps1` script and gets pi's `powershell` tool. */
export function isPowerShell(shell: string | undefined): boolean {
  if (!shell) return false;
  const name = path.win32.basename(shell).toLowerCase();
  return name === "powershell.exe" || name === "pwsh.exe" || name === "pwsh" || name === "powershell";
}

/**
 * How PowerShell starts on a command's script. No profile: the user's is outside the
 * sandbox, and a command must not depend on it. The execution policy is given for the
 * process because it cannot be read inside the sandbox (the registry is refused), and
 * every script — this one too — would otherwise fail "AuthorizationManager".
 */
export const POWERSHELL_SCRIPT_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

/**
 * The command as a PowerShell script. Written with a byte-order mark: Windows PowerShell
 * 5.1 reads UTF-8 without one in the ANSI code page. Progress display off: drawing a bar
 * reads the console buffer back, which the sandbox refuses, and the command dies with
 * it. Output in UTF-8, as pi's own `powershell` does.
 *
 * `-File` reports 0 for a script that ends without `exit`, whatever failed; the trailer
 * gives what `-Command` (pi's local tool) gives instead — the native program's code, or
 * 1 for a failed cmdlet. It runs only when the command did not `exit` itself, and on its
 * own lines so a comment ending the command cannot swallow it.
 *
 * The command's output goes through `Out-Default` before that `exit`: the implicit formatter
 * holds a table back while it waits for more objects of its type, and an `exit` right after
 * drops it — `'a'; Get-Location; 'b'` printed `a` alone, exit 0. The command is dot-sourced, so
 * its variables stay in the script's scope, and its `$?` is taken inside the block, right after
 * it: after the pipe it would be `Out-Default`'s. A command that itself exits (or throws) right
 * after a table still loses it: PowerShell does that under `-Command` too, pi's own tool included.
 *
 * The command is not in this script but in its own file beside it (`powerShellCommandFile`),
 * parsed here before it runs. A script PowerShell would not parse runs no line at all, so with the
 * command inline its parse error came out before the output encoding was set — in the console's
 * old code page, read as UTF-8: the model got `caract�re` and `��||��` (a real session). Parsed
 * here, the error is shown in UTF-8, its line numbers are the command's own, and a file
 * `COMMAND_UNPARSED` beside the script tells pi-outpost that nothing ran — so that nothing is said
 * about the sandbox, which cannot have refused a command that never started.
 */
export function powerShellScript(): string {
  return [
    "\uFEFF$ProgressPreference = 'SilentlyContinue'",
    "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}",
    // PowerShell 7 colours tables and errors by default; the model reads escape codes.
    "try { $PSStyle.OutputRendering = 'PlainText' } catch {}",
    // Under sandbox.allowedHosts MXC sets HTTPS_PROXY, which Windows PowerShell's web
    // cmdlets ignore: they would go direct, and be refused.
    "if ($env:HTTPS_PROXY) { $PSDefaultParameterValues['Invoke-WebRequest:Proxy'] = $env:HTTPS_PROXY; $PSDefaultParameterValues['Invoke-RestMethod:Proxy'] = $env:HTTPS_PROXY }",
    // Windows PowerShell parses a page with Internet Explorer's engine unless told not to, and
    // in the sandbox that ends in "not in interactive mode": every plain Invoke-WebRequest failed.
    // PowerShell 7 takes the switch and ignores it.
    "$PSDefaultParameterValues['Invoke-WebRequest:UseBasicParsing'] = $true",
    "$global:LASTEXITCODE = $null",
    // A command that returns at its top level ends the block with nothing failed.
    "$global:PiOutpostCommandOk = $true",
    // Read as text and run as a script block, not dot-sourced as a file: an `exit` in a file run
    // from this one would end that file alone, and its code would be lost.
    `$global:PiOutpostCommand = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot '${POWERSHELL_COMMAND_FILE}'))`,
    "$global:PiOutpostParseErrors = $null",
    "[void][System.Management.Automation.Language.Parser]::ParseInput($global:PiOutpostCommand, [ref]$null, [ref]$global:PiOutpostParseErrors)",
    // Not run: each error as the parser words it, with its place in the command and the line itself.
    "if ($global:PiOutpostParseErrors) {",
    `  [void](New-Item -ItemType File -Force (Join-Path $PSScriptRoot '${COMMAND_UNPARSED}'))`,
    "  foreach ($e in $global:PiOutpostParseErrors) { $p = $e.Extent.StartScriptPosition; [Console]::Error.WriteLine(\"ParserError: line $($p.LineNumber), column $($p.ColumnNumber): $($e.Message)\"); [Console]::Error.WriteLine(\"    $($p.Line)\") }",
    "  exit 1",
    "}",
    // What failed is read from the errors the command alone raised.
    "$global:Error.Clear()",
    ". {",
    `. ([ScriptBlock]::Create($global:PiOutpostCommand + "\`n\`n" + '${POWERSHELL_STATUS_LINE}'))`,
    "} | Out-Default",
    "if (-not $global:PiOutpostCommandOk) {",
    "  if ($LASTEXITCODE) { exit $LASTEXITCODE }",
    // Windows PowerShell 5.1 turns each line a native program writes to a redirected stderr
    // (`2>&1`) into an error record, and `$?` false, though the program exited 0: uv, git, java and
    // pip all print progress there, and every such command ended in 1, read as a failure. A
    // program's own failure keeps its code (above); a failed cmdlet's error is no such record.
    "  if ($LASTEXITCODE -eq 0 -and $global:Error.Count -gt 0 -and -not ($global:Error | Where-Object { -not ($_ -is [System.Management.Automation.ErrorRecord] -and \"$($_.FullyQualifiedErrorId)\" -like 'NativeCommandError*') })) { exit 0 }",
    "  exit 1",
    "}",
    "exit 0",
    "",
  ].join("\n");
}

/** The file beside the script holding the command. */
export const POWERSHELL_COMMAND_FILE = "command-body.ps1";
/** The file the script leaves beside itself when PowerShell would not parse the command. */
export const COMMAND_UNPARSED = "command-unparsed";

/**
 * The command's own file: the command and nothing else, so its parse errors point into it — with the
 * status line in the file, a parenthesis left open was reported on the status line, "line 4", quoting
 * an empty one. The script adds that line when it builds the block (`POWERSHELL_STATUS_LINE`). With a
 * byte-order mark, as the script: Windows PowerShell 5.1 reads UTF-8 without one in the ANSI code page.
 */
export function powerShellCommandFile(command: string): string {
  return "﻿" + command;
}

/**
 * Appended to the command when the script builds the block: its status, taken on its own line right
 * after it, so a comment ending the command cannot swallow it.
 */
export const POWERSHELL_STATUS_LINE = "$global:PiOutpostCommandOk = $?";

export function confinedBashOperations(options: ConfinedBashOptions): ConfinedBashOperations {
  const platform = options.platform ?? process.platform;
  const windows = platform === "win32";
  const kind = runnerKind(options.runner);
  const wslc = options.image !== undefined && kind === "mxc";
  const shell = wslc ? "/bin/bash" : (options.shell ?? (windows ? undefined : "/bin/bash"));
  const powerShell = !wslc && isPowerShell(shell);
  // MXC on Windows reports what it refused only when asked, at a cost of a second per command:
  // a diagnosis, on the agent's request, after a failure (`mxcDiagnosticConfig`).
  const diagnosable = kind === "mxc" && windows && !wslc && !isPosixMxc(options.runner);
  // Windows' sentences for a refused connection, in the user's language: asked once, not waited for.
  let localizedSocketErrors: string[] = [];
  if (diagnosable) void windowsSocketMessages().then((messages) => (localizedSocketErrors = messages));
  /** The commands whose last run failed with the offer of a diagnosis: the only ones diagnosed. */
  const offered = new Set<string>();
  // macOS: whether MXC's SDK refused the document that asks for Seatbelt's report (`mxcMacCaptureRequest`).
  let captureRefused = false;
  /**
   * One command. With `diagnosis`, run as a diagnosis (`mxcDiagnosticConfig`): none of its output is
   * shown, and what MXC's report names — filtered, undefined when MXC wrote none — goes there.
   */
  const launchCommand = async (command: string, cwd: string, { onData: shown, signal, timeout: asked }: ExecOptions, extra: Grant, diagnosis?: (found: Refusal[] | undefined) => void) => {
    // A command given no timeout gets one: a server started to check it answers never ends, and the
    // turn waited on it for an hour (a real session). Said when it ends one, with what to do instead.
    const timeout = asked ?? options.defaultTimeout ?? DEFAULT_COMMAND_TIMEOUT_SECONDS;
    const diagnose = diagnosis !== undefined;
    // bun's install, refused a rename in the container (see bunInstallNote): watched for, a window
    // kept across chunks so a message split between two is still seen.
    let bunInstallRefused = false;
    // Whether the output reports an access denied: the only sign a refusal here leaves.
    let accessDenied = false;
    let deniedTail = "";
    let tail = "";
    let sqliteCannotOpen = false;
    let sqliteTail = "";
    // A connection the container refused (WSAEACCES): reads as a network failure otherwise (#552, #554).
    let socketRefused = false;
    let socketTail = "";
    // The output's end, where a failed command names the host it could not reach (`refusedHost`).
    let outputTail = "";
    const filtered = powerShell ? withoutPowerShellDriveNoise(shown) : undefined;
    const show = filtered ? (data: Buffer) => filtered.write(data) : shown;
    const onData: (data: Buffer) => void = diagnose
      ? () => {}
      : (data) => {
          if (!sqliteCannotOpen) {
            const text = sqliteTail + data.toString();
            if (text.includes(SQLITE_CANNOT_OPEN)) sqliteCannotOpen = true;
            sqliteTail = text.slice(-SQLITE_CANNOT_OPEN.length);
          }
          if (!bunInstallRefused) {
            const text = tail + data.toString();
            if (text.includes(BUN_TEMPORARY_DIRECTORY_REFUSED)) bunInstallRefused = true;
            tail = text.slice(-BUN_TEMPORARY_DIRECTORY_REFUSED.length);
          }
          if (!accessDenied) {
            const text = deniedTail + data.toString();
            if (reportsAccessDenied(text)) accessDenied = true;
            deniedTail = text.slice(-64);
          }
          if (diagnosable) {
            if (!socketRefused) {
              const text = socketTail + data.toString();
              if (reportsSocketRefused(text, networkProxy !== undefined, localizedSocketErrors)) socketRefused = true;
              socketTail = text.slice(-256);
            }
            outputTail = (outputTail + data.toString()).slice(-OUTPUT_KEPT_FOR_HOSTS);
          }
          show(data);
        };
    const timeoutMs = timeoutInMs(timeout);
    if (signal?.aborted) throw new Error("aborted");
    const refusal = await options.gate?.();
    if (refusal !== undefined) throw new Error(refusal);
    if (signal?.aborted) throw new Error("aborted");
    const check = await (options.check ?? cachedCheck)(options.runner);
    if (!check.ok) throw new RunnerCannotConfine(`bash is confined by ${options.runner}, which cannot run it: ${check.reason}`, check.remedy, check.reason);
    if (!shell) {
      throw new Error(
        `bash is confined by ${options.runner}, but "sandbox.bashShell" names no shell. On Windows, Git Bash cannot start in a sandbox: name powershell.exe, or busybox-w32's sh.exe.`,
      );
    }

    // No grant, of the session or of this command, reaches a diagnosis: it only ever narrows.
    const session = diagnose ? EMPTY_GRANT : (options.grants?.() ?? EMPTY_GRANT);
    const ruled = diagnose ? EMPTY_GRANT : ((await options.ruleGrant?.()) ?? EMPTY_GRANT);
    const configured = wslc ? EMPTY_GRANT : ((await options.readOnlyGrant?.()) ?? EMPTY_GRANT);
    const grant = diagnose ? configured : mergeGrants(session, ruled, extra, configured);
    if (wslc && grant.directories.length > 0) {
      throw new Error("a directory grant cannot reach bash in a WSLC container: its mounts are fixed when it starts");
    }
    const directories = grantedDirectories(grant);
    // The repository's metadata: read-only inside the writable zone, unless granted or configured so.
    const readOnlyInside = options.allowWrite
      ? heldReadOnlyInside(options.writableRoot ?? options.root, { gitWritable: options.gitWritable, grantedWrite: directories.grantedWrite })
      : [];
    // The sandbox cache and the toolchain homes: part of the sandbox, a diagnosis' too.
    const toolchains = kind === "mxc" && windows && !wslc && !isPosixMxc(options.runner) ? options.toolchains : undefined;
    if (toolchains) {
      await mkdir(toolchains.cacheDir, { recursive: true });
      directories.grantedWrite.push(toolchains.cacheDir);
      directories.grantedRead.push(...toolchains.readable);
    }
    // A host the list does not name is asked about while the connection waits — by a proxy of
    // this command's own, so that what it asks is this command's, and closed after it. The shared
    // proxy of the list is left as it is, for every other command and session using it.
    // Nor any way out: a diagnosis runs with the network closed.
    let networkProxy = diagnose ? undefined : options.networkProxy;
    let dedicated: EgressProxy | undefined;
    const answers = new Map<string, HostAnswer>();
    const refusals = refusalCollector(options.onRefusal);
    const askHost = options.askHost;
    if (networkProxy !== undefined && askHost !== undefined && !wslc) {
      dedicated = await (options.startProxy ?? startEgressProxy)({
        allowedHosts: [...(options.allowedHosts ?? []), ...session.hosts],
        ask: async (host) => {
          // What can never be granted, then the user's rules, then the user.
          const forbidden = forbiddenHost(host);
          const rule = forbidden ? undefined : await options.hostRule?.(host).catch(() => undefined);
          if (rule === "allow") return { allowed: true };
          const answer: HostAnswer = forbidden ? { forbidden } : rule === "refuse" ? { rule: "refuse" } : await askHost({ command, host, ...(signal ? { signal } : {}) });
          answers.set(host, answer);
          if (!isApproved(answer)) refusals.add(hostRefusal(host, command));
          return isApproved(answer) ? { allowed: true } : { allowed: false, why: hostAnswerText(host, answer) };
        },
      });
      networkProxy = dedicated;
    }

    const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-bash-"));
    // Where MXC writes a diagnosis' report: a directory of the server's, given to no sandbox. Never
    // the path announced on stderr — the command writes there too, and could name any file.
    let reportDir: string | undefined;
    // MXC's request, run in process through its SDK (`mxcSdk.ts`): no executor runs, but on Linux.
    let mxcWire: MxcWireRequest | undefined;
    // The same, as a document sent as written: macOS, with Seatbelt's report asked for.
    let mxcJson: string | undefined;
    // Windows MXC only: rebuilds the request at a lower enumeration level, when Windows refuses
    // the policy over the folders made listable (see the launch below).
    let rebuildPolicy: ((level: 0 | 1 | 2) => void) | undefined;
    let enumLevel: 0 | 1 | 2 = 0;
    let sdkReportPath: string | undefined;
    let exitCode: number | null | undefined;
    try {
      const script = path.join(tmp, powerShell ? "command.ps1" : "command.sh");
      await writeFile(script, powerShell ? powerShellScript() : command, { mode: 0o600 });
      if (powerShell) await writeFile(path.join(tmp, POWERSHELL_COMMAND_FILE), powerShellCommandFile(command), { mode: 0o600 });
      const shellArgs = powerShell ? [...POWERSHELL_SCRIPT_ARGS, script] : [script];
      // A start outside the root could not be entered from inside it.
      const startIn = isInside(cwd, options.root) ? cwd : options.root;
      const env = confinedEnvironment(process.env, {
        root: options.root,
        tmp,
        shell,
        platform,
        gitConfig: options.gitConfig,
        signingShim: options.signingShim,
        // MXC derives the container's TEMP from it (see confinedEnvironment); WSLC is a Linux container.
        containerProfileInTmp: kind === "mxc" && !wslc && !isPosixMxc(options.runner),
        // Under sandbox.allowedHosts the server's proxy is the only way out: the user's would bypass
        // it (NO_PROXY) or name a host the container refuses. WSLC's network is its own.
        userProxy: networkProxy === undefined && !wslc,
      });
      if (toolchains) {
        Object.assign(env, toolchains.env);
        // The user's uv.toml, pip.ini and .npmrc, as they are now, without credentials.
        await carryUserConfigs(toolchains.carried ?? [], toolchains.relayRoute);
      }
      // A Linux container holds no folder of the user's: a Windows path there would only mislead.
      if (wslc) delete env.PI_OUTPOST_USER_HOME;
      const readOnlyFiles = gitReadOnlyFiles(options.gitConfig);
      const policyFile = path.join(tmp, "policy.json");
      let args: string[];
      // What is started, when it is not `options.runner` itself: MXC's executor on Linux.
      let executor: string | undefined;
      // sandbox-exec hands the command its own environment: the one its policy says.
      let runnerEnv = env;
      if (kind === "seatbelt") {
        const policy = seatbeltPolicy({
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          ...directories,
          agentDir: options.agentDir,
          configFile: options.configFile,
          tmp,
          shell,
          shellArgs,
          cwd: startIn,
          env,
          searchPath: env.PATH,
          readOnlyFiles,
          readOnlyInside,
          ...(networkProxy === undefined ? {} : { networkProxy: networkProxy.url }),
        });
        const profileFile = path.join(tmp, "policy.sb");
        await writeFile(profileFile, policy.seatbelt, { mode: 0o600 });
        args = ["-f", profileFile, shell, ...shellArgs];
        runnerEnv = policy.env;
      } else if (wslc) {
        const request = mxcWslcConfig({
          image: options.image!,
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          tmp,
          script,
          cwd: startIn,
        });
        mxcWire = request as MxcWireRequest;
        args = [];
      } else if (kind === "mxc" && isPosixMxc(options.runner)) {
        const request = mxcPosixConfig(options.runner, {
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          ...directories,
          agentDir: options.agentDir,
          configFile: options.configFile,
          tmp,
          shell,
          shellArgs,
          cwd: startIn,
          env,
          searchPath: env.PATH,
          readOnlyFiles,
          readOnlyInside,
          ...(networkProxy === undefined ? {} : { networkProxy: networkProxy.url }),
        });
        if (mxcRunsInProcess(platform)) {
          // macOS: the same request on MXC's development contract, which reports what Seatbelt
          // refused — in a directory of the server's, given to no sandbox, as a diagnosis' is.
          mxcWire = request as MxcWireRequest;
          if (!captureRefused) {
            reportDir = await realpath(await mkdtemp(path.join(tmpdir(), "pi-outpost-refused-")));
            mxcJson = JSON.stringify(mxcMacCaptureRequest(request as MxcMacConfig, path.join(reportDir, "report.json")));
          }
          args = [];
        } else {
          // Linux: MXC's executor, started with the command's environment and nothing of the
          // server's — `bwrap` inherits what its parent holds (`mxcRunsInProcess`).
          const found = linuxMxcExecutor(options.runner);
          if (found === undefined) throw new Error(`bash is confined by MXC, which cannot run it: ${mxcMissingReason(platform, process.arch, process.execPath)}`);
          executor = found;
          await writeFile(policyFile, JSON.stringify(request), { mode: 0o600 });
          args = [policyFile];
        }
      } else if (kind === "mxc") {
        const input: MxcTerminalInput = {
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          ...directories,
          agentDir: options.agentDir,
          configFile: options.configFile,
          tmp,
          shell,
          shellArgs,
          cwd: startIn,
          env,
          siblings: siblingsToDeny(options.root),
          searchPath: env.PATH,
          ...(process.env.USERPROFILE ? { home: process.env.USERPROFILE } : {}),
          readOnlyFiles,
          readOnlyInside,
          ...(networkProxy === undefined ? {} : { networkProxy: networkProxy.url }),
          ...(options.hostLoopback === undefined ? {} : { hostLoopback: options.hostLoopback }),
          ...(options.privateNetwork === undefined ? {} : { privateNetwork: options.privateNetwork }),
        };
        if (diagnose) reportDir = await mkdtemp(path.join(tmpdir(), "pi-outpost-diagnosis-"));
        enumLevel = mxcEnumerateLevel();
        const build = (level: 0 | 1 | 2): MxcWireRequest => {
          const request = mxcTerminalConfig({ ...input, ...enumerateLevelFlags(level) });
          return (reportDir === undefined
            ? request
            : mxcDiagnosticConfig(request, { root: options.root, agentDir: options.agentDir, configFile: options.configFile, reportPath: path.join(reportDir, "report.json") })) as MxcWireRequest;
        };
        mxcWire = build(enumLevel);
        rebuildPolicy = (level) => {
          enumLevel = level;
          mxcWire = build(level);
        };
        args = [];
      } else {
        const policy = terminalPolicy({
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          ...directories,
          agentDir: options.agentDir,
          configFile: options.configFile,
          tmp,
          searchPath: env.PATH,
          systemRoot: process.env.SystemRoot,
          userProfile: process.env.USERPROFILE,
          readOnlyFiles,
          readOnlyInside,
          platform,
          ...(networkProxy === undefined ? {} : { networkProxy: networkProxy.url }),
        });
        await writeFile(policyFile, JSON.stringify(policy), { mode: 0o600 });
        args = ["run", "-p", policyFile, "--", shell, ...shellArgs];
        // landstrip opens the proxy's port and sets nothing: the command is told where it is.
        if (networkProxy !== undefined) runnerEnv = { ...env, ...proxyEnvironment(networkProxy.url) };
      }
      // landstrip reports each refusal as a JSON line on stderr: told to the agent in words.
      const stderr = kind === "landstrip" && !windows ? landstripStderr(onData, (line) => refusals.add(landstripRefusal(line, command, platform))) : undefined;
      const loadedSdk = mxcWire === undefined ? undefined : await (options.mxcSdk ?? mxcSdk)();
      if (loadedSdk !== undefined && "reason" in loadedSdk) throw new Error(`bash is confined by MXC, which cannot run it: ${loadedSdk.reason}`);
      const launch = async (): Promise<{ exitCode: number | null }> => {
        if (loadedSdk !== undefined && mxcWire !== undefined) {
          const stable = () => runThroughSdk(loadedSdk.sdk, sdkRequest(mxcWire!), { onData, signal, timeoutMs, timeout });
          // The development contract can change under pi-outpost: an SDK that no longer takes the
          // document started nothing, so the command runs on the stable one, confined the same,
          // and this shell stops asking — it then reports nothing of files.
          const attempt = async () =>
            mxcJson === undefined
              ? await stable()
              : await runThroughSdk(loadedSdk.sdk, { json: mxcJson }, { onData, signal, timeoutMs, timeout }).catch((error) => {
                  if (!(error instanceof SdkDocumentRefused)) throw error;
                  captureRefused = true;
                  return stable();
                });
          let result: { exitCode: number | null; metadata: SdkMetadata | undefined };
          const startLevel = enumLevel;
          for (;;) {
            try {
              result = await attempt();
              break;
            } catch (error) {
              // Windows builds the process security environment from the policy's paths and refuses
              // the whole request when one of them cannot be opened there — 0x80070005 on a
              // domain-joined account, where the folders made listable name entries the machine
              // cannot open. Nothing ran: step the enumeration down one level — first the
              // ancestors of the grants (the profile's folders), then all of it, the policy sent
              // before the layer — and try again. Confined the same at every level; never unconfined.
              if (
                rebuildPolicy === undefined ||
                !isSecurityEnvironmentRefusal(error) ||
                enumLevel >= 2 ||
                (mxcWire!.processContainer?.filesystem?.enumeratePaths?.length ?? 0) === 0
              ) throw error;
              rebuildPolicy((enumLevel + 1) as 0 | 1 | 2);
            }
          }
          // A lower level ran: this host cannot take more, and no policy built afterwards on it
          // asks for it.
          if (enumLevel > startLevel) noteMxcEnumerateLevel(enumLevel);
          sdkReportPath = result.metadata?.captureDenials?.outputPath;
          return { exitCode: result.exitCode };
        }
        return run(executor ?? options.runner, args, { cwd: startIn, env: runnerEnv, onData, ...(stderr ? { stderr } : {}), signal, timeoutMs, timeout, windows });
      };
      // curl, git and PowerShell print only "403" for a refused tunnel: the model is told which
      // host, and why. Commands of the agent's shell run one at a time, so these are this one's.
      const refused = new Set<string>();
      const unwatch = wslc ? undefined : networkProxy?.watchRefusals((host) => {
        refused.add(host);
        // A host the user was asked about was recorded with the answer; this is one nobody was.
        if (!answers.has(host.toLowerCase())) refusals.add(hostRefusal(host, command));
      });
      try {
        const result = await (wslc ? oneWslcAtATime(launch) : launch());
        exitCode = result.exitCode;
        if (mxcJson !== undefined && reportDir !== undefined) {
          // Only a file inside the directory MXC was told to use, and one it named by its rule.
          const named = sdkReportPath !== undefined && path.dirname(path.resolve(sdkReportPath)) === reportDir ? path.basename(sdkReportPath) : undefined;
          if (named !== undefined && mxcReportFile([named], path.join(reportDir, "report.json")) !== undefined) {
            try {
              for (const refusal of seatbeltReportRefusals(JSON.parse(await readFile(path.join(reportDir, named), "utf8")), command)) refusals.add(refusal);
            } catch {
              // No report to read: the command's own error is all there is.
            }
          }
        }
        if (diagnosis !== undefined) {
          let report: unknown;
          const reportPath = path.join(reportDir!, "report.json");
          // The SDK names the report in its result, never on the command's stderr. Only a file
          // inside the directory it was asked to use is read, and one MXC named by its rule.
          const named = sdkReportPath !== undefined && path.dirname(path.resolve(sdkReportPath)).toLowerCase() === path.resolve(reportDir!).toLowerCase() ? path.basename(sdkReportPath) : undefined;
          const name = named !== undefined && mxcReportFile([named], reportPath) !== undefined ? named : undefined;
          if (name !== undefined) {
            try {
              report = JSON.parse(await readFile(path.join(reportDir!, name), "utf8"));
            } catch {
              report = undefined;
            }
          }
          const context = { root: options.root, command, systemRoot: process.env.SystemRoot, programFiles: process.env.ProgramFiles };
          diagnosis(report === undefined ? undefined : mxcReportRefusals(report, context));
        }
        return result;
      } finally {
        unwatch?.();
        // A last line held back while it could still have been PowerShell's drive line.
        filtered?.flush();
        // With someone to ask, every unlisted host was asked about: what each answer was. Without,
        // the hosts refused, and that the list is where they would go.
        if (answers.size > 0) onData(Buffer.from(`\n${networkNote(answers)}\n`));
        else if (refused.size > 0) onData(Buffer.from(`\n${refusalNote([...refused])}\n`));
        // The directories refused while it ran, gathered at the end where the agent reads last.
        const directoriesNote = diagnose ? undefined : refusedDirectoriesNote(refusals.all());
        if (directoriesNote !== undefined) onData(Buffer.from(`\n${directoriesNote}\n`));
        // An MSYS2 program named by its path: it died at start, and nothing here can make it run.
        const msys = diagnosable && (exitCode === STATUS_DLL_INIT_FAILED || exitCode === STATUS_DLL_INIT_FAILED_UNSIGNED) ? msysProgramNamed(command, process.env.PATH) : undefined;
        if (msys !== undefined) onData(Buffer.from(`\n${msysNote(msys)}\n`));
        if (bunInstallRefused && diagnosable) onData(Buffer.from(`\n${bunInstallNote()}\n`));
        if (sqliteCannotOpen && !diagnose && directories.grantedRead.length > 0) onData(Buffer.from(`\n${sqliteReadOnlyNote()}\n`));
        // A failed command's named hosts, judged by the policy (`refusedHost`): the sandbox's refusal is
        // told whatever the program printed — curl and PowerShell say only that they could not connect.
        const policy = { privateNetwork: options.privateNetwork === true, hostLoopback: options.hostLoopback !== false };
        const policyRefused =
          diagnosable && !diagnose && networkProxy === undefined && ((exitCode !== undefined && exitCode !== 0) || socketRefused)
            ? await refusedHost(command, outputTail, policy).catch(() => undefined)
            : undefined;
        // Not when the proxy named a refused host: that note already says what was refused, and why.
        if ((policyRefused || socketRefused) && !diagnose && refused.size === 0) {
          onData(Buffer.from(`\n${socketRefusedNote({ proxy: networkProxy !== undefined, ...policy }, policyRefused)}\n`));
        }
        // A connection refused is not a file refused: no diagnosis, which runs without network and finds no file.
        if (policyRefused || socketRefused) accessDenied = false;
        // Last, so the agent reads it after everything else: what it can do about a failure here.
        // Not when the proxy already named a refused host — that is what failed, and a diagnosis
        // runs without network: it would contradict "do not retry".
        const hostRefused = refused.size > 0 || [...answers.values()].some((answer) => !isApproved(answer));
        // Nor when PowerShell would not parse the script: nothing ran, so the sandbox refused
        // nothing, and a note about it would send the agent after a grant it already has.
        const unparsed = powerShell && (await stat(path.join(tmp, COMMAND_UNPARSED)).then(() => true, () => false));
        if (diagnosable && !diagnose && !hostRefused && !unparsed && exitCode !== undefined && exitCode !== 0) {
          // Said only where the output reports an access denied: on any failure, it sent a model
          // after grants for "program not found" — a missing package — run after run (a real session).
          // A diagnosis stays available for any failure; the tool's description says so.
          if (accessDenied) onData(Buffer.from(`\n${diagnosisOfferNote()}\n`));
          offered.delete(command);
          offered.add(command);
          // Bounded: the oldest offer goes first.
          if (offered.size > MAX_OFFERED) offered.delete(offered.values().next().value!);
        } else if (!diagnose) {
          // Its last run did not fail with the offer: no diagnosis for it until one does.
          offered.delete(command);
        }
      }
    } catch (error) {
      if (asked === undefined && !diagnose && error instanceof Error && error.message.startsWith("timeout:")) shown(Buffer.from(`\n${defaultTimeoutNote(timeout)}\n`));
      throw error;
    } finally {
      if (reportDir !== undefined) await rm(reportDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
      await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
      await dedicated?.close().catch(() => {});
    }
  };
  /**
   * What the shell is refused doing nothing under a diagnosis' sandbox — PowerShell reads the
   * default profile's `AppData` as it starts, refused, whatever the command. Measured once, on the
   * first diagnosis, and left out of every report: never what the command wanted. A failed
   * measure is not kept, so the next diagnosis measures again.
   */
  let noiseMeasure: Promise<Set<string>> | undefined;
  const shellNoise = (): Promise<Set<string>> => {
    noiseMeasure ??= (async () => {
      let found: Refusal[] | undefined;
      await launchCommand("", options.root, { onData: () => {} }, EMPTY_GRANT, (report) => void (found = report));
      if (found === undefined) throw new Error("MXC wrote no report for an empty command");
      return new Set(found.map(refusalKey));
    })();
    return noiseMeasure.catch(() => {
      noiseMeasure = undefined;
      return new Set<string>();
    });
  };
  return {
    exec: (command, cwd, execOptions) => launchCommand(command, cwd, execOptions, EMPTY_GRANT),
    execWithGrant: (command, cwd, execOptions, grant) => launchCommand(command, cwd, execOptions, isEmptyGrant(grant) ? EMPTY_GRANT : grant),
    ...(diagnosable
      ? {
          diagnose: async (command: string, cwd: string, execOptions: ExecOptions) => {
            // Asked before the command failed here: run it as usual, and say why.
            if (!offered.has(command)) {
              const result = await launchCommand(command, cwd, execOptions, EMPTY_GRANT);
              execOptions.onData(Buffer.from(`\n${diagnosisIgnoredNote()}\n`));
              return result;
            }
            const noise = await shellNoise();
            let found: Refusal[] | undefined;
            const result = await launchCommand(command, cwd, execOptions, EMPTY_GRANT, (report) => void (found = report));
            if (found === undefined) {
              execOptions.onData(Buffer.from("[pi-outpost] diagnosis: MXC wrote no report of what it refused. Read the command's own error.\n"));
              return result;
            }
            const refusals = refusalCollector(options.onRefusal);
            for (const refusal of found) if (!noise.has(refusalKey(refusal))) refusals.add(refusal);
            execOptions.onData(Buffer.from(`${diagnosisNote(refusals.all())}\n`));
            return result;
          },
        }
      : {}),
  };
}

/** A Windows path as MXC's WSLC backend mounts it in the container: `C:\a\b` → `/mnt/c/a/b`. */
export function wslcPath(windowsPath: string): string {
  const { root } = path.win32.parse(windowsPath);
  const rest = windowsPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  return [`/mnt/${root.slice(0, 1).toLowerCase()}`, ...rest].join("/");
}

/**
 * One command in a Linux container, through MXC's WSLC backend. Experimental.
 *
 * Only what is mounted exists inside: the root (read-only, or writable with `allowWrite`)
 * and the command's temporary folder. Nothing else of the host — no profile, no keys, no
 * configuration — so there is nothing to deny. The environment is the container's own,
 * not the server's.
 *
 * Two limits of the backend, found by running it: a writable folder inside a read-only
 * mount stays read-only (the parent shadows it), so the writable zone is the whole root
 * or nothing; and the network is all or nothing — bridged with the host's loopback, or
 * isolated. Bridged here: git and package managers need it.
 *
 * Every run gets its own container name, so a turn's parallel calls never share a session.
 * Before mxc-sdk 1.0.1 it was also required: without one MXC named the session `CLI`, which
 * WSLC refused (`WSLC_E_INVALID_SESSION_NAME`, microsoft/mxc#1484).
 */
export function mxcWslcConfig(input: {
  image: string;
  root: string;
  writableRoot?: string;
  allowWrite: boolean;
  tmp: string;
  script: string;
  cwd: string;
}) {
  if (input.allowWrite && input.writableRoot !== undefined && input.writableRoot !== input.root) {
    throw new Error(
      `bash runs in a WSLC container, which cannot make a folder inside a read-only mount writable: remove "sandbox.writableRoot", or give up "sandbox.bashImage"`,
    );
  }
  return {
    version: "1.0.0",
    containment: "wslc",
    containerId: `pioutpost${randomBytes(6).toString("hex")}`,
    // The image store MXC defaults to under %TEMP% — which, for the runner, is this
    // command's temporary folder: every command would pull the image again.
    wslc: { image: input.image, storagePath: path.join(tmpdir(), "mxc-wslc-sessions") },
    process: {
      commandLine: `/bin/bash ${wslcPath(input.script)}`,
      cwd: input.cwd,
      env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/root", "LANG=C.UTF-8", "TERM=dumb"],
    },
    filesystem: {
      readwritePaths: input.allowWrite ? [input.root, input.tmp] : [input.tmp],
      readonlyPaths: input.allowWrite ? [] : [input.root],
    },
    network: { egress: { default: "allow" }, ingress: { default: "allow", hostLoopback: "allow" } },
  };
}

/**
 * WSLC runs one after another. pi runs a turn's tool calls in parallel, and two runs
 * sharing the image store fail on it (`WslcListSessionImages`, a sharing violation) —
 * found with three of four commands of one turn refused.
 */
let wslcTail: Promise<unknown> = Promise.resolve();
export function oneWslcAtATime<T>(launch: () => Promise<T>): Promise<T> {
  const next = wslcTail.then(launch, launch);
  wslcTail = next.catch(() => {});
  return next;
}

/** How long a command given no timeout may run: an install finishes in it, a server does not. */
export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 300;

/** What ends a command stopped by the default timeout. It is no refusal, and says nothing of the sandbox. */
export function defaultTimeoutNote(seconds: number = DEFAULT_COMMAND_TIMEOUT_SECONDS): string {
  return (
    `It was stopped after ${seconds} seconds, the limit for a command given no timeout: it had not ended. ` +
    "A command that keeps running until stopped, such as a server, needs a timeout of its own — a few seconds to check it starts. " +
    "A command that needs longer needs a larger one."
  );
}

function timeoutInMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid timeout: must be a finite number of seconds");
  if (timeout > MAX_TIMEOUT_SECONDS) throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
  return timeout * 1000;
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** How bun says its install could not use its temporary directory (`PackageManagerDirectories.rs`). */
const BUN_TEMPORARY_DIRECTORY_REFUSED = "accessing temporary directory. set $BUN_TMPDIR or $BUN_INSTALL";

/**
 * True when a command's output reports an access denied — how a refusal of MXC's shows on Windows,
 * whatever the program: Windows' own message (localised, and in a program's old code page read as
 * UTF-8, `Acc�s refus�`), PowerShell's untranslated categories, .NET's and the runtimes' names for
 * it, and error 5 as numbers. A failure without one of these is not the sandbox's to speak of.
 */
export function reportsAccessDenied(output: string): boolean {
  return ACCESS_DENIED.test(output);
}

const ACCESS_DENIED = new RegExp(
  [
    String.raw`access (?:is )?denied`,
    String.raw`access to the path .{1,300}? is denied`,
    String.raw`acc.s refus.`,
    String.raw`acc.s au chemin .{1,300}? (?:est )?refus.`,
    String.raw`zugriff verweigert`,
    String.raw`acceso denegado`,
    String.raw`accesso negato`,
    String.raw`acesso negado`,
    String.raw`toegang geweigerd`,
    String.raw`permission ?denied`,
    String.raw`UnauthorizedAccess`,
    String.raw`AccessDeniedException`,
    String.raw`PermissionError`,
    String.raw`\bE(?:ACCES|PERM)\b`,
    String.raw`\[WinError 5\]`,
    String.raw`\bos error 5\b`,
    String.raw`0x80070005`,
  ].join("|"),
  "i",
);


/**
 * What ends a command whose `bun install` / `bun add` hit MXC's rename limit: inside the container a
 * rename relative to a directory handle (`NtSetInformationFile`, `RootDirectory`) fails with
 * `STATUS_INVALID_HANDLE`, while the same by absolute path succeeds; bun probes its cache with the
 * first and reports `EBADF`. No folder avoids it.
 */
export function bunInstallNote(): string {
  return (
    "[pi-outpost] bun cannot install packages in this sandbox: the container refuses the file rename bun uses " +
    "(relative to a folder it holds open), whatever folders bun is given. bun run, bun test and bun <file> work. " +
    "Ask the user to run the install outside the sandbox; do not retry it here."
  );
}

/**
 * PowerShell's own line, at its start, when a drive of the user's session cannot be reached from
 * the container — a mapped network drive (issue #547): "InitializeDefaultDrives" on the FileSystem
 * provider failed. Printed by the host before any line of the command, in the console's code page
 * (so garbled), on every command; the drive is out of the sandbox's reach by design, and the
 * command runs. The operation's name is the same in every language, the words around it are not.
 */
const POWERSHELL_DRIVE_NOISE = /InitializeDefaultDrives/;

/**
 * The command's output without PowerShell's startup line about a drive it cannot reach: lines are
 * held only until the first one that is not it, then everything passes as it comes.
 */
export function withoutPowerShellDriveNoise(next: (data: Buffer) => void): { write(data: Buffer): void; flush(): void } {
  let held: Buffer | undefined = Buffer.alloc(0);
  return {
    write(data) {
      if (held === undefined) return next(data);
      let buffer = Buffer.concat([held, data]);
      for (;;) {
        const end = buffer.indexOf(0x0a);
        if (end < 0) break;
        const line = buffer.subarray(0, end + 1);
        buffer = buffer.subarray(end + 1);
        if (POWERSHELL_DRIVE_NOISE.test(line.toString("latin1"))) continue;
        held = undefined;
        next(Buffer.concat([line, buffer]));
        return;
      }
      held = buffer;
    },
    flush() {
      if (held !== undefined && held.length > 0 && !POWERSHELL_DRIVE_NOISE.test(held.toString("latin1"))) next(held);
      held = undefined;
    },
  };
}

/** SQLite's message when it cannot open a database: under a read-only grant, a WAL database's sign. */
const SQLITE_CANNOT_OPEN = "unable to open database file";

/**
 * Windows' WSAEACCES (10013) on a connection: under MXC's process container, the sandbox's refusal of
 * a destination it does not open — every program words it its own way (Rust's "os error 10013",
 * Python's "WinError 10013", .NET's sentence, in the user's language). Never a bare 10013, a port.
 */
const SOCKET_REFUSED = new RegExp(
  [
    String.raw`os error 10013`,
    String.raw`winerror 10013`,
    String.raw`errno 10013`,
    String.raw`wsaeacces`,
    String.raw`forbidden by its access permissions`,
    String.raw`interdite par ses autorisations`,
    // Node and npm: `connect EACCES 10.0.0.1:80`; `errno EACCES` beside `syscall connect`.
    String.raw`\bconnect EACCES\b`,
    String.raw`errno EACCES[\s\S]{0,160}?syscall connect|syscall connect[\s\S]{0,160}?errno EACCES`,
    // Java, which the file note took for a refused file.
    String.raw`Permission denied: connect`,
  ].join("|"),
  "i",
);

/** How much of a command's output is kept to find the hosts it names (`refusedHost`). */
const OUTPUT_KEPT_FOR_HOSTS = 16 * 1024;

const normalized = (text: string) => text.replace(/[’‘`´]/g, "'").replace(/\s+/g, " ").toLowerCase();

/**
 * Windows' own sentence for WSAEACCES and WSAENETUNREACH, in the user's language, as Go and .NET print
 * it: asked of Windows once, so no language needs listing here. Empty off Windows, or if it cannot say.
 */
export function windowsSocketMessages(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [ComponentModel.Win32Exception]::new(10013).Message; [ComponentModel.Win32Exception]::new(10051).Message"],
      { encoding: "utf8", timeout: 15_000, windowsHide: true },
      (error, stdout) => resolve(error ? [] : stdout.split(/\r?\n/).map((line) => normalized(line.trim().replace(/\.$/, ""))).filter((line) => line.length > 20)),
    );
  });
}

/**
 * WSAENETUNREACH (10051): how a direct connection fails under `sandbox.allowedHosts`, where the
 * container has no route out but the proxy (measured: Python's `create_connection` to pypi.org). Only
 * then is it the sandbox's; with the network open it is the network's.
 */
const NO_ROUTE_BUT_THE_PROXY = new RegExp(
  [String.raw`os error 10051`, String.raw`winerror 10051`, String.raw`errno 10051`, String.raw`wsaenetunreach`, String.raw`r.seau impossible . atteindre`, String.raw`unreachable network`].join("|"),
  "i",
);

export function reportsSocketRefused(output: string, underProxy = false, windowsMessages: readonly string[] = []): boolean {
  if (SOCKET_REFUSED.test(output) || (underProxy && NO_ROUTE_BUT_THE_PROXY.test(output))) return true;
  if (windowsMessages.length === 0) return false;
  const text = normalized(output);
  // The first is WSAEACCES's, refused whatever the policy; the second, WSAENETUNREACH's, only under a proxy.
  return text.includes(windowsMessages[0]!) || (underProxy && windowsMessages[1] !== undefined && text.includes(windowsMessages[1]));
}

/**
 * What ends a command whose connection the sandbox refused: that it was the sandbox, not the network
 * — the agent otherwise retries, or reports the company's mirror down (#552) — what this sandbox
 * opens, and the setting that would open the rest, which only the user can change.
 */
export function socketRefusedNote(network: { proxy: boolean; hostLoopback: boolean; privateNetwork: boolean }, refused?: RefusedHost): string {
  if (refused) {
    const named = refused.address === refused.host ? refused.host : `${refused.host} (${refused.address})`;
    const why =
      refused.why === "private network"
        ? "it is on this machine's private network (the intranet), which is closed unless the user sets sandbox.privateNetwork to true"
        : "it is this machine itself, whose own services are closed (sandbox.hostLoopback is false)";
    return (
      `[pi-outpost] the sandbox refused ${named}: ${why}. It is not a network failure, and retrying will not help. ` +
      `Only the user can open it: if the task needs it, tell them.`
    );
  }
  const reason = network.proxy
    ? "under sandbox.allowedHosts a command connects only through the proxy named in HTTPS_PROXY; a program that ignores it, or connects to an address, is refused"
    : [
        "the Internet is open",
        network.privateNetwork
          ? "the private network too"
          : "the private network (the intranet: a company's mirror, git server or proxy) is closed unless the user sets sandbox.privateNetwork to true",
        network.hostLoopback ? "this machine's own services too" : "this machine's own services are closed (sandbox.hostLoopback is false)",
      ].join("; ");
  return (
    `[pi-outpost] the sandbox refused a network connection (${network.proxy ? "a direct one: no route but the proxy" : "WSAEACCES, 10013"}): it is not a network failure, and retrying will not help. ` +
    `Here ${reason}. Only the user can open it: if the task needs it, tell them which host it was.`
  );
}

/**
 * What ends a command whose SQLite could not open a database while a folder was granted read-only:
 * a database in WAL mode writes its `-wal` and `-shm` files to be read at all (measured, #547).
 */
export function sqliteReadOnlyNote(): string {
  return (
    "[pi-outpost] SQLite could not open a database, and this command was granted a folder read-only. " +
    "If the database is in WAL mode, reading it writes its -wal and -shm files: open it with ?immutable=1 " +
    "(e.g. sqlite3.connect('file:<path>?immutable=1', uri=True)) when nothing writes it meanwhile, or ask " +
    "run_with_grant for write access to its folder."
  );
}

/** `0xC0000142`, a program's DLL failing to initialise: how every MSYS2 program ends in MXC's container. */
const STATUS_DLL_INIT_FAILED = -1073741502;
const STATUS_DLL_INIT_FAILED_UNSIGNED = 0xc0000142;

/** Signal numbers for the 128 + n convention, where Node names a signal but gives no code. */
const SIGNAL_NUMBERS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Spawn the runner, stream its output, and end it — tree and all — on abort or timeout. pi's semantics. */
async function run(
  runner: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    onData: (data: Buffer) => void;
    /** Where stderr goes instead of `onData`, ended when the runner closes. */
    stderr?: { write: (data: Buffer) => void; end: () => void };
    signal?: AbortSignal;
    timeoutMs?: number;
    timeout?: number;
    windows: boolean;
  },
): Promise<{ exitCode: number | null }> {
  const child = spawn(runner, args, {
    cwd: options.cwd,
    env: options.env,
    // Its own process group outside Windows, so the whole tree can be ended at once.
    detached: !options.windows,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let timedOut = false;
  const end = () => killTree(child, options.windows);
  const onAbort = () => end();
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    end();
  }, options.timeoutMs);
  child.stdout?.on("data", options.onData);
  child.stderr?.on("data", options.stderr ? options.stderr.write : options.onData);
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    options.stderr?.end();
    if (options.signal?.aborted) throw new Error("aborted");
    if (timedOut) throw new Error(`timeout:${options.timeout}`);
    return { exitCode: code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] ?? 0) : 1) };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** End the runner and what it supervises. On Windows, ending MXC's executor ends its container. */
function killTree(child: ChildProcess, windows: boolean): void {
  if (!child.pid || child.exitCode !== null) return;
  if (windows) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).once("error", () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** A runner that cannot confine on this machine, with what the user can do about it when that is known. */
export class RunnerCannotConfine extends Error {
  constructor(
    message: string,
    readonly remedy?: ConfinementRemedy,
    /** The runner's own reason, bare: what a verdict says, rather than this error's wrapping of it. */
    readonly why: string = message,
  ) {
    super(message);
    this.name = "RunnerCannotConfine";
  }
}

/** What a verdict should say of an error: a runner's own reason when it is one, else the error's message. */
export function reasonOf(error: unknown): string {
  return error instanceof RunnerCannotConfine ? error.why : (error as Error).message;
}

/** The remedy an error carries, when it is a runner's refusal that knows one. */
export function remedyOf(error: unknown): ConfinementRemedy | undefined {
  return error instanceof RunnerCannotConfine ? error.remedy : undefined;
}
