/**
 * `pi-outpost config --confine`: confine an unconfined shell, once this machine has shown it can.
 *
 * It writes `"sandbox.bashRunner": "auto"` into the configuration file, but only after the
 * runner `"auto"` would choose has passed its self-check and the confinement canary, run the
 * way the server runs them. Otherwise the file is left byte for byte as it was, and the reason
 * is printed. Loosening is never this command's to do: there is no `--unconfine`.
 */
import fs from "node:fs";
import path from "node:path";
import type { ConfinementVerdict } from "@pi-outpost/shared";
import { AUTO_RUNNER, NO_RUNNER } from "./autoRunner.ts";
import { type CliOptions, findConfigFile, loadConfig, NoConfigError, type SandboxConfig } from "./config.ts";
import { agentShellVerdict, autoUnavailableRefusal, autoVerdictRefusal } from "./confinementStatus.ts";

export interface ConfineResult {
  /** 0: confined, or nothing to do; 1: refused, the file unchanged. */
  exitCode: number;
  lines: string[];
}

export interface ConfineInput {
  launchDir: string;
  flags: CliOptions;
  env?: NodeJS.ProcessEnv;
  /** The provider keys' directory, never readable by a confined command. */
  agentDir: string;
  /** The canary; a parameter for tests. */
  verdict?: (sandbox: SandboxConfig, neverReadable: { agentDir?: string; configFile?: string }) => Promise<ConfinementVerdict>;
}

/** The file's own indentation and line ending, so a rewrite changes one line and nothing else. */
export function serializeLike(original: string, value: unknown): string {
  const indent = /^([ \t]+)"/m.exec(original)?.[1] ?? "  ";
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify(value, null, indent).replace(/\n/g, eol);
  return /\r?\n$/.test(original) ? body + eol : body;
}

export async function confineConfiguration(input: ConfineInput): Promise<ConfineResult> {
  const env = input.env ?? process.env;
  let file: string;
  try {
    file = findConfigFile(input.launchDir, input.flags, env);
  } catch (error) {
    if (error instanceof NoConfigError) {
      return {
        exitCode: 0,
        lines: [
          "No configuration file, so nothing to change: the server needs one to start, and \"pi-outpost init\" writes one",
          "whose default sandbox already chooses a runner automatically and confines the shell once it passes its check.",
        ],
      };
    }
    throw error;
  }

  const original = fs.readFileSync(file, "utf8");
  const raw = JSON.parse(original) as Record<string, unknown>;
  const unchanged = (exitCode: number, ...lines: string[]): ConfineResult => ({ exitCode, lines: [`${file}: unchanged.`, ...lines] });

  if (raw.sandbox === false) {
    return unchanged(
      1,
      `"sandbox" is false: there is no sandbox to confine the shell in. Turning it back on would also limit the`,
      `agent's file tools to the project, so it is yours to do by hand: remove "sandbox": false to get the default.`,
    );
  }
  if (raw.sandbox === undefined) {
    return unchanged(0, `No "sandbox" section: the default sandbox already chooses a runner ("bashRunner": "auto").`);
  }
  const section = raw.sandbox as Record<string, unknown>;
  if (section.bashFrom !== undefined) {
    return unchanged(0, `The shell is the extension's ("sandbox.bashFrom": ${JSON.stringify(section.bashFrom)}): pi-outpost's own shell is not in use.`);
  }
  if (section.allowBash !== true) {
    return unchanged(0, `The shell is off ("sandbox.allowBash" is not true): pi-outpost's own shell is not in use, nothing to confine.`);
  }
  if (section.bashRunner !== undefined && section.bashRunner !== NO_RUNNER) {
    return unchanged(0, `The shell is already confined by ${JSON.stringify(section.bashRunner)}.`);
  }

  // Rehearse the configuration as it would be, beside the original so relative paths mean the
  // same, and load it as the server would: the runner, the shell, the sandbox, all resolved there.
  const next = { ...raw, sandbox: { ...section, bashRunner: AUTO_RUNNER } };
  const serialized = serializeLike(original, next);
  const candidate = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.confine.tmp`);
  let mode: number | undefined;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    mode = undefined;
  }
  fs.writeFileSync(candidate, serialized, mode === undefined ? undefined : { mode });
  try {
    const sandbox = loadConfig(input.launchDir, { ...input.flags, config: candidate, profile: undefined }, env, { quiet: true }).sandbox!;
    if (sandbox.autoRunner?.unavailable !== undefined) {
      return unchanged(1, autoUnavailableRefusal(sandbox.autoRunner.unavailable));
    }
    const label = sandbox.autoRunner?.label ?? path.basename(sandbox.bashRunner!);
    const verdict = await (input.verdict ?? agentShellVerdict)(sandbox, { agentDir: input.agentDir, configFile: file });
    const refusal = autoVerdictRefusal(verdict);
    if (refusal !== undefined) return unchanged(1, refusal);
    fs.renameSync(candidate, file);
    return {
      exitCode: 0,
      lines: [
        `${file}: "sandbox.bashRunner": ${section.bashRunner === undefined ? "(absent)" : JSON.stringify(section.bashRunner)} → "auto"`,
        `${label} (${sandbox.bashRunner}) passed its self-check and the confinement canary on this machine.`,
        ...(sandbox.bashShell && section.bashShell === undefined ? [`Commands will run in ${sandbox.bashShell}.`] : []),
        "Restart pi-outpost for the agent's shell to be confined.",
      ],
    };
  } finally {
    fs.rmSync(candidate, { force: true });
  }
}
