/**
 * Command line of the `pi-outpost` binary.
 *
 * Parsing only — the precedence rule (flag > env > file > default) lives in
 * config.ts, which takes the flags parsed here as its top layer. `parseArgs` is
 * Node's own: seven flags and one subcommand do not need a framework.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { type CliOptions, userConfigDir } from "./config.ts";

/**
 * Config written by `pi-outpost init` — deliberately the safe end of every choice.
 *
 * The local file pins the workspace to its own directory (`.` resolves against the
 * config file). The **global** one must not: `.` there is `~/.config/pi-outpost`,
 * which would (a) nail the agent to the config directory from wherever you run it,
 * and (b) put the very file granting the sandbox *inside* the sandbox the moment
 * someone flips allowWrite — the agent could then grant itself bash for the next
 * run. Omitting both keys makes them fall back to the launch directory, which is
 * what "configure once, run anywhere" actually means.
 */
const starterConfig = (global: boolean) => ({
  ...(global ? {} : { cwd: "." }),
  sandbox: {
    ...(global ? {} : { root: "." }),
    allowWrite: false,
    allowBash: false,
  },
  server: {
    port: 3141,
    host: "127.0.0.1",
  },
  branding: {
    title: "π",
  },
});

const HELP = `pi-outpost — a web chat UI for the pi coding agent

Usage
  pi-outpost [options]           start the server
  pi-outpost init [options]      write a starter configuration file
  pi-outpost config [options]    print the configuration that would be used, and where it came from
  pi-outpost login --provider <name>
                                 store an API key for a provider in <agentDir>/auth.json

Options
  --config <path>    configuration file to use
  --profile <name>   use <user config dir>/profiles/<name>.json
  --cwd <dir>        directory the agent works in
  --agent-dir <dir>  pi config/session store (default: ~/.pi/agent)
  --port <n>         port to listen on (default: 3141)
  --host <addr>      address to bind (default: 127.0.0.1)
  -h, --help         show this help
  -v, --version      show the version

init options
  --global           write to the user config directory instead of ./
  --force            overwrite an existing file

login options
  --provider <name>  provider to store a key for (e.g. anthropic, openai, mistral)

The key itself has no flag, for the same reason the auth token has none: argv is
world-readable. It is prompted for on a terminal, or read from stdin when piped:
  echo "$KEY" | pi-outpost login --provider anthropic

For an OpenAI-compatible endpoint of your own (a corporate gateway, vLLM, Ollama),
open the UI: it declares the base URL, the model and the compatibility flags such
servers need, and writes them to <agentDir>/models.json.

Configuration is read from the first of these that exists:
  1. --config <path>
  2. --profile <name>       -> <user config dir>/profiles/<name>.json
  3. $PI_OUTPOST_CONFIG
  4. $PI_OUTPOST_PROFILE    -> <user config dir>/profiles/<name>.json
  5. ./pi-outpost.config.json
  6. <user config dir>/config.json

Only that one file is read — configurations are never merged. For any setting
that appears in several places: flag > environment variable > file > default.
The auth token has no flag on purpose (argv is world-readable): use
$PI_OUTPOST_TOKEN or the file's server.token.

<user config dir> is $XDG_CONFIG_HOME/pi-outpost, or ~/.config/pi-outpost.
`;

export class CliError extends Error {}

export interface ParsedCli {
  command: "serve" | "init" | "config" | "login" | "help" | "version";
  flags: CliOptions;
  init: { global: boolean; force: boolean };
  login: { provider?: string };
}

type Command = "init" | "config" | "login";
const COMMANDS: readonly string[] = ["init", "config", "login"] satisfies Command[];

function integerFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new CliError(`"${name}" must be a port number (got "${value}")`);
  }
  return parsed;
}

export function parseCli(argv: string[]): ParsedCli {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: "string" },
        profile: { type: "string" },
        cwd: { type: "string" },
        "agent-dir": { type: "string" },
        port: { type: "string" },
        host: { type: "string" },
        global: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        provider: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    // parseArgs names the offending flag, then explains how to pass a positional
    // starting with a dash — advice nobody needs here. Keep the first sentence.
    const message = error instanceof Error ? error.message.split(". ")[0] : String(error);
    throw new CliError(`${message} — see "pi-outpost --help"`);
  }

  const { values, positionals } = parsed;
  const [positional, ...rest] = positionals;
  if (rest.length > 0) throw new CliError(`unexpected argument "${rest[0]}" — see "pi-outpost --help"`);
  if (positional !== undefined && !COMMANDS.includes(positional)) {
    throw new CliError(`unknown command "${positional}" — see "pi-outpost --help"`);
  }
  const command = positional as Command | undefined;

  const flags: CliOptions = {
    config: values.config,
    profile: values.profile,
    cwd: values.cwd,
    agentDir: values["agent-dir"],
    port: integerFlag(values.port, "--port"),
    host: values.host,
  };

  const kind = values.help ? "help" : values.version ? "version" : (command ?? "serve");
  return {
    command: kind,
    flags,
    init: { global: values.global, force: values.force },
    login: { provider: values.provider },
  };
}

/**
 * Read the key for `login`: from stdin when piped, otherwise prompted with the echo
 * off. Never from a flag — argv is readable by anyone who can list processes, which
 * is exactly why there is no `--token` either.
 */
export async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  const CTRL_C = "\u0003";
  const BACKSPACE = ["\u007f", "\b"];

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let typed = "";
  try {
    for await (const chunk of process.stdin) {
      const text = (chunk as Buffer).toString("utf8");
      // Ctrl-C aborts rather than handing back half a key
      if (text.includes(CTRL_C)) throw new CliError("cancelled");
      // A pasted key arrives with its newline in the *same* chunk ("sk-abc\r"), so the
      // terminator has to be looked for inside the chunk, not compared against it.
      const end = text.search(/[\r\n]/);
      const typedNow = end === -1 ? text : text.slice(0, end);
      for (const char of typedNow) {
        if (BACKSPACE.includes(char)) typed = typed.slice(0, -1);
        else typed += char;
      }
      if (end !== -1) break;
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
  }
  return typed.trim();
}

/** Where `init` writes, and where a bare `pi-outpost` would look for it afterwards. */
function initTarget(launchDir: string, global: boolean, env: NodeJS.ProcessEnv): string {
  return global
    ? path.join(userConfigDir(env), "config.json")
    : path.join(launchDir, "pi-outpost.config.json");
}

export function runInit(
  launchDir: string,
  options: { global: boolean; force: boolean },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const target = initTarget(launchDir, options.global, env);
  if (fs.existsSync(target) && !options.force) {
    throw new CliError(`${target} already exists — pass --force to overwrite it`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(starterConfig(options.global), null, 2)}\n`);
  return target;
}

export function helpText(): string {
  return HELP;
}
