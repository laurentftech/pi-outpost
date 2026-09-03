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
import { OPEN_SHAPES, type OpenShape } from "./openBrowser.ts";

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
  // Written out rather than left implicit: the runtime decides what actually
  // executes on this host, and a setting nobody knows exists is a setting nobody
  // audits. "embedded" is both the default and the safe end — switching to "rpc"
  // means naming an executable, which `--help` explains.
  agentRuntime: {
    mode: "embedded",
  },
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
  pi-outpost doctor [options]    check whether this installation can start and serve, and say what stops it
  pi-outpost login --provider <name>
                                 store an API key for a provider in <agentDir>/auth.json
  pi-outpost build-exe [options] build a standalone executable from this installation
  pi-outpost update [--check]    move to the newest published version, or just look

Options
  --config <path>    configuration file to use
  --profile <name>   use <user config dir>/profiles/<name>.json
  --cwd <dir>        directory the agent works in
  --agent-dir <dir>  pi config/session store (default: ~/.pi/agent)
  --port <n>         port to listen on (default: 3141)
  --host <addr>      address to bind (default: 127.0.0.1)
  --offline          never fetch remote model catalogs (air-gapped hosts)
  --open             open the interface in your browser once the server is listening
  --no-open          do not (the default wherever no desktop session exists)
  --open-in <shape>  window (its own window, the default) or browser (a tab)
  --terminal         enable the integrated interactive web terminal (default: disabled)
  --no-terminal      explicitly disable the integrated web terminal
  -h, --help         show this help
  -v, --version      show the version

init options
  --global           write to the user config directory instead of ./
  --force            overwrite an existing file

login options
  --provider <name>  provider to store a key for (e.g. anthropic, openai, mistral)

build-exe options
  --out <path>       where to write it (default: ./pi-outpost, ./pi-outpost.exe on Windows)
  --force            replace an existing file at that path

update options
  --check            report what is available and install nothing

Nothing installs on its own: the server may say a newer version exists, and only
"pi-outpost update" acts on that. What it does depends on how this copy was
installed — a global package is upgraded in place, a checkout, a one-off npx run
and a standalone executable are each told what to do instead.

The executable carries the server and the web UI and needs nothing installed to run.
Released builds are attached to https://github.com/laurentftech/pi-outpost/releases —
this command is for building one from the version you have.

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

Agent runtime
  By default pi-outpost runs the pi agent in its own process (the embedded SDK).
  Set "agentRuntime" in the config file to run a supervised "pi --mode rpc" child
  process instead — to match an existing pi installation, or to isolate a crash:

    "agentRuntime": { "mode": "rpc", "executable": "pi", "args": [] }

  pi-outpost always appends "--mode rpc" itself and derives "--session-dir" from
  "agentDir", so "args" may not contain either, nor any flag that would make the
  child print something and exit (--print, --export, --list-models, --version).
  "--tools" and "--system-prompt" are refused too: those come from "tools" and
  "systemPrompt", and a second one on the line would decide the answer instead.
  There is no shell: "args" is an argument vector, so nothing is re-parsed.

  The rest of the configuration is passed to the child as flags, so the same file
  describes the same agent on either runtime: skillPaths, extensionPaths,
  extensionScripts, promptPaths, their noSkills/noExtensions/noPromptTemplates
  switches, tools, systemPrompt and appendSystemPrompt. pi-outpost's own tools
  (present_structure and the pdf/docx/xlsx/pptx extractors) travel as an
  extension it loads into the child, so they work in both modes.

  Pi forks do not all accept the same flags. "pi" and "little-coder" take all of
  the above; "omp" has no skill-path or prompt-template flag, so it refuses to
  start when skillPaths or promptPaths are set — the startup error names the
  setting responsible rather than leaving the resource quietly missing.

  A sandbox cannot: it is a replacement toolset this server builds for its own
  in-process agent, and nothing on pi's command line confines a child's built-in
  read/write/bash to a directory. Configuring "sandbox" with "rpc" is refused at
  startup rather than silently unenforced — isolate the child with a container or
  a dedicated user instead.

  A failed or absent executable stops startup — pi-outpost never falls back to
  the embedded runtime, which would silently run something you did not configure.
  Some features have no RPC equivalent and are refused with a message rather than
  ignored: storing credentials, declaring a provider, changing the sandbox from
  the settings menu, tree navigation and editing a past message. Sessions are not
  auto-titled (rename them by hand), and tool cards use the built-in rendering.
`;

export class CliError extends Error {}

export interface ParsedCli {
  command: "serve" | "init" | "config" | "doctor" | "login" | "build-exe" | "update" | "help" | "version";
  flags: CliOptions;
  init: { global: boolean; force: boolean };
  login: { provider?: string };
  buildExe: { out?: string; force: boolean };
  update: { check: boolean };
  /** undefined when neither --open nor --no-open was given, so config still decides. */
  open?: boolean;
}

type Command = "init" | "config" | "doctor" | "login" | "build-exe" | "update";
const COMMANDS: readonly string[] = ["init", "config", "doctor", "login", "build-exe", "update"] satisfies Command[];

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
        offline: { type: "boolean", default: false },
        global: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        provider: { type: "string" },
        out: { type: "string" },
        check: { type: "boolean", default: false },
        open: { type: "boolean", default: false },
        "no-open": { type: "boolean", default: false },
        "open-in": { type: "string" },
        terminal: { type: "boolean", default: false },
        "no-terminal": { type: "boolean", default: false },
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

  // A flag that belongs to another command is an error, not something to ignore:
  // `pi-outpost --out ./x` silently starting a server is a worse outcome than being
  // told the flag has an owner.
  if (values.out !== undefined && command !== "build-exe") {
    throw new CliError('"--out" belongs to "pi-outpost build-exe" — see "pi-outpost --help"');
  }
  if (values.check && command !== "update") {
    throw new CliError('"--check" belongs to "pi-outpost update" — see "pi-outpost --help"');
  }
  if (values.provider !== undefined && command !== "login") {
    throw new CliError('"--provider" belongs to "pi-outpost login" — see "pi-outpost --help"');
  }
  if (values.global && command !== "init") {
    throw new CliError('"--global" belongs to "pi-outpost init" — see "pi-outpost --help"');
  }
  const openIn = values["open-in"] as string | undefined;
  if (openIn !== undefined && !OPEN_SHAPES.includes(openIn as OpenShape)) {
    throw new CliError(`"--open-in" must be one of ${OPEN_SHAPES.join(", ")} (got "${openIn}") — see "pi-outpost --help"`);
  }
  if (values.open && values["no-open"]) {
    throw new CliError('"--open" and "--no-open" contradict each other — see "pi-outpost --help"');
  }
  if (values.terminal && values["no-terminal"]) {
    throw new CliError('"--terminal" and "--no-terminal" contradict each other — see "pi-outpost --help"');
  }

  const flags: CliOptions = {
    config: values.config,
    profile: values.profile,
    cwd: values.cwd,
    agentDir: values["agent-dir"],
    port: integerFlag(values.port, "--port"),
    host: values.host,
    // Only an override when actually passed: a bare false must not beat the file.
    ...(values.offline ? { offline: true } : {}),
    // Same rule for the window's shape: left out unless --open-in was given, so the
    // config file still decides. It rides in `flags` because that is the bag
    // loadConfig() reads — a copy on the top-level result would never reach it.
    ...(openIn === undefined ? {} : { openIn: openIn as OpenShape }),
    ...(values.terminal ? { terminal: true } : {}),
    ...(values["no-terminal"] ? { terminal: false } : {}),
  };

  const kind = values.help ? "help" : values.version ? "version" : (command ?? "serve");
  return {
    command: kind,
    flags,
    init: { global: values.global, force: values.force },
    login: { provider: values.provider },
    buildExe: { out: values.out, force: values.force },
    update: { check: values.check },
    // Left undefined unless asked for, so configuration still has its say.
    ...(values.open ? { open: true } : values["no-open"] ? { open: false } : {}),
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
