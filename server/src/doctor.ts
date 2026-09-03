/**
 * `pi-outpost doctor` — why the server did not start, or why the page found nothing.
 *
 * Every other command here assumes a working installation and reports the one thing
 * it was asked to do. This one assumes nothing, and that is its whole point: the
 * failure it exists for is a server that refused to start, so a diagnostic that needs
 * the server's own preconditions would refuse alongside it.
 *
 * `pi-outpost config` was the closest thing before, and it has exactly that flaw. It
 * loads the configuration before it prints anything (index.ts runs `loadConfig` above
 * the `config` branch), so in a directory with no configuration file — the case worth
 * diagnosing — it fails with the very error the operator is trying to understand.
 *
 * Two rules shape what follows:
 *
 * 1. **Nothing here stops at the first problem.** An operator with three things wrong
 *    should learn all three from one run, not one per run.
 * 2. **Nothing here re-implements a rule it reports on.** The configuration search
 *    calls `findConfigFile`, the install shape calls `detectChannel`, the web assets
 *    are looked for where `index.ts` looks. A diagnostic that describes behaviour by
 *    restating it is a diagnostic that will one day describe behaviour the product no
 *    longer has, confidently and in detail.
 */
import fsSync from "node:fs";
import path from "node:path";
import { type AppConfig, implicitConfigCandidates, NoConfigError } from "./config.ts";
import { browsableUrl } from "./openBrowser.ts";
import { type InstallChannel } from "./update.ts";

/**
 * How much a finding matters.
 *
 * `fail` is reserved for what actually stops a server from serving; `warn` is a
 * capability that will be missing when it is reached. The distinction decides the
 * exit code, so it decides whether a script can trust this command.
 */
export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  /** Short label, printed in a fixed-width column. */
  name: string;
  status: CheckStatus;
  /** What was found. One entry per line. */
  detail: string[];
  /** What to do about it. Omitted when there is nothing to do. */
  remedy?: string[];
}

/** What is listening at an address, as far as a client can tell from outside. */
export interface AddressProbe {
  /** Something accepted a connection. */
  listening: boolean;
  /** It answered `/health` the way this server does. Undefined when nothing listened. */
  answersHealth?: boolean;
}

export type ProbeAddress = (host: string, port: number) => Promise<AddressProbe>;

/**
 * Everything the report is composed from, supplied rather than looked up.
 *
 * The gathering lives in `runDoctor`; the checks below are pure functions of this
 * record. That is what lets a test assert the sentence an operator reads on a machine
 * it does not have — a Windows path layout, an occupied port, a missing `node-pty` —
 * without arranging the world to produce it.
 */
export interface Diagnosis {
  version: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  channel: InstallChannel;
  launchDir: string;
  env: NodeJS.ProcessEnv;
  /** Resolves the configuration exactly as a real start would. Throws what that throws. */
  findConfig: () => string;
  /** Loads it exactly as a real start would. Throws what that throws. */
  loadConfig: () => AppConfig;
  probeAddress: ProbeAddress;
  /** Count of assets compiled into this binary; 0 when the UI is served from disk. */
  embeddedWebAssets: number;
  /** Disk locations for the UI, in the order `index.ts` tries them. */
  webDistCandidates: string[];
  /** Whether a candidate holds an `index.html` — the same test `index.ts` makes. */
  hasIndexHtml: (candidate: string) => boolean;
  /** The git this server would use, or the reason there is none. */
  git: () => Promise<{ executable: string } | { error: string }>;
  /** Whether the optional PTY binding can actually be loaded here. */
  loadPty: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

/** One attempt at reading the configuration: the result, or whatever refused it. */
export type LoadOutcome = { config: AppConfig } | { error: unknown };

const ok = (name: string, ...detail: string[]): Check => ({ name, status: "ok", detail });

/**
 * The installation, named as the operator would have to name it to fix anything.
 *
 * Never a failure on its own — an unknown channel runs perfectly well. It is here
 * because every remedy below is different for a global install, a checkout and a
 * downloaded executable, and because "I have it installed globally" is a belief this
 * line can confirm or correct in one glance.
 */
export function installationCheck(d: Diagnosis): Check {
  const shape: Record<InstallChannel, string> = {
    global: "installed globally (npm -g)",
    checkout: "a source checkout",
    ephemeral: "a one-off run (npx), fetched for this invocation",
    executable: "a standalone executable",
    unknown: "an installation this command could not classify",
  };
  return ok(
    "installation",
    `pi-outpost ${d.version} — ${shape[d.channel]}`,
    `node ${d.nodeVersion} on ${d.platform}/${d.arch}`,
  );
}

/**
 * Which configuration file a start would read, or why it would refuse to start.
 *
 * The check that exists for the reported symptom. A server with no configuration file
 * anywhere does not start degraded — it prints the paths it looked in and exits 1,
 * before it ever binds a port, so a browser pointed at it finds nothing to connect to.
 * The operator sees a page that will not load and reasonably concludes the server is
 * broken, when the server never ran.
 *
 * `pi-outpost init` is offered in both forms deliberately. A global *install* does not
 * create a global *configuration*, and nothing before this said so: the two are
 * separate acts and only the second one makes a bare `pi-outpost` work in a directory
 * it has never seen.
 */
export function configurationCheck(d: Diagnosis): Check {
  const candidates = implicitConfigCandidates(d.launchDir, d.env);
  try {
    const chosen = d.findConfig();
    const searched = candidates.map((candidate) => `${candidate === chosen ? "→" : " "} ${candidate}`);
    // An explicit --config, --profile or PI_OUTPOST_CONFIG answers before the search
    // ever runs, so the implicit list would be describing a search that did not
    // happen. Say which one decided instead.
    if (!candidates.includes(chosen)) {
      return ok("configuration", `will read ${chosen}`, "(named explicitly, so the usual search was not performed)");
    }
    return ok("configuration", `will read ${chosen}`, "searched, in order:", ...searched);
  } catch (error) {
    if (error instanceof NoConfigError) {
      return {
        name: "configuration",
        status: "fail",
        detail: [
          "no configuration file — the server refuses to start, before it binds a port.",
          "Looked in, in order:",
          ...candidates.map((candidate) => `  ${candidate}`),
        ],
        remedy: [
          "pi-outpost init            writes one here, for this directory only",
          "pi-outpost init --global   writes one every directory falls back to",
          "",
          "Installing pi-outpost globally does not write either file: the install and",
          "the configuration are separate acts, and only this one makes a bare",
          "`pi-outpost` work in a directory it has never seen.",
        ],
      };
    }
    // A named file that is not there, or a profile that does not exist. The message
    // already carries the path, and it is the real one: this called the same
    // function a start calls.
    return {
      name: "configuration",
      status: "fail",
      detail: [error instanceof Error ? error.message : String(error)],
      remedy: ["The path above was named explicitly — correct it, or drop the flag to search the usual places."],
    };
  }
}

/**
 * The settings a start would run with, and the two that decide whether a browser can
 * reach it at all.
 *
 * Only reached when a configuration file was found: with none there is nothing to
 * report, and `configurationCheck` has already said so.
 */
export function settingsCheck(loaded: LoadOutcome): Check | undefined {
  if ("error" in loaded) {
    const error = loaded.error;
    if (error instanceof NoConfigError) return undefined;
    return {
      name: "settings",
      status: "fail",
      detail: [
        "the configuration file was found but could not be used:",
        `  ${error instanceof Error ? error.message : String(error)}`,
      ],
      remedy: ["Fix the setting named above; the server stops on this before it starts."],
    };
  }
  const config = loaded.config;
  const url = browsableUrl({ address: config.host, port: config.port });
  return ok(
    "settings",
    `listens on ${config.host}:${config.port} — open ${url}`,
    `agent works in ${config.cwd}`,
    `agent runtime: ${config.agentRuntime.mode}${
      config.agentRuntime.mode === "rpc" ? ` (${config.agentRuntime.executable ?? "no executable set"})` : ""
    }`,
    `auth token: ${config.token === undefined ? "none (loopback only)" : "set"}`,
    `terminal: ${config.terminal.enabled ? "enabled" : "disabled"}`,
  );
}

/**
 * Whether the address is free, and what holds it when it is not.
 *
 * `EADDRINUSE` already has a good message at startup, but it arrives *as* the failure
 * and says nothing about what is there. The common case on a desktop is an earlier
 * pi-outpost still running — often the one whose page the operator has open — and
 * that is worth distinguishing from a foreign service, because the remedy differs:
 * one is "you already have it running, use that tab", the other is "choose a port".
 */
export async function addressCheck(d: Diagnosis, host: string, port: number): Promise<Check> {
  const probe = await d.probeAddress(host, port);
  const url = browsableUrl({ address: host, port });
  if (!probe.listening) return ok("address", `${host}:${port} is free — the server can bind it`);
  if (probe.answersHealth === true) {
    return {
      name: "address",
      status: "warn",
      detail: [`${host}:${port} is already serving a pi-outpost — ${url}`],
      remedy: [
        "That is very likely the one you already started. Use it, stop it before",
        'starting another, or run this one elsewhere with "--port <n>".',
      ],
    };
  }
  return {
    name: "address",
    status: "fail",
    detail: [`${host}:${port} is taken by something that is not a pi-outpost`],
    remedy: ['Starting here fails with EADDRINUSE — "--port <n>" starts this one somewhere else.'],
  };
}

/**
 * Whether this installation can serve the page at all.
 *
 * The failure this catches is quiet and looks exactly like the symptom that brings
 * people here: with neither an embedded bundle nor a `dist` on disk, `index.ts`
 * registers no route for the UI, the server starts and listens perfectly, and the
 * browser gets a 404 for `/`. "The web page does not connect to the server" is what
 * that looks like from the outside, and nothing in the log says otherwise.
 */
export function webUiCheck(d: Diagnosis): Check {
  if (d.embeddedWebAssets > 0) {
    return ok("web UI", `served from this binary (${d.embeddedWebAssets} assets embedded)`);
  }
  const found = d.webDistCandidates.find((candidate) => d.hasIndexHtml(candidate));
  if (found !== undefined) return ok("web UI", `served from ${found}`);
  return {
    name: "web UI",
    status: "fail",
    detail: [
      "no interface to serve — the server would start and answer 404 for every page.",
      "Looked for an index.html in:",
      ...d.webDistCandidates.map((candidate) => `  ${candidate}`),
    ],
    remedy:
      d.channel === "checkout"
        ? ["npm run build --workspace web"]
        : ["This installation is incomplete — reinstall it, or run `pi-outpost update`."],
  };
}

/**
 * git, which the product degrades without rather than refusing to start.
 *
 * A warning, never a failure: the server runs, and the git surface says why it is
 * missing. It is reported because "the repository panel is empty" is otherwise a
 * mystery on a machine where git is installed but absent from the PATH a desktop
 * launcher hands its children — which is most of them.
 */
export async function gitCheck(d: Diagnosis): Promise<Check> {
  const result = await d.git();
  if ("executable" in result) return ok("git", result.executable);
  return {
    name: "git",
    status: "warn",
    detail: [result.error],
    remedy: ['Install git, or name it with "gitPath" in the configuration file.'],
  };
}

/**
 * The optional PTY binding, asked only when the terminal is switched on.
 *
 * `node-pty` is an optional dependency and its absence is a supported state: the
 * server answers `terminal_error` and everything else works. That is invisible from
 * the outside though — the terminal button is there and does nothing that looks like
 * an explanation — so it is worth one line here whenever the feature is on.
 */
export async function terminalCheck(d: Diagnosis, enabled: boolean): Promise<Check | undefined> {
  if (!enabled) return undefined;
  const pty = await d.loadPty();
  if (pty.ok) return ok("terminal", "enabled, and node-pty loads here");
  return {
    name: "terminal",
    status: "warn",
    detail: ["enabled, but node-pty could not be loaded:", `  ${pty.error}`, "Opening a terminal will answer terminal_error."],
    remedy: [
      "node-pty is an optional native dependency: it needs a C++ toolchain at install",
      "time, and the standalone executable does not carry one at all.",
    ],
  };
}

/**
 * The whole report, in the order an operator needs it.
 *
 * Configuration comes before everything that depends on it, and every check after it
 * still runs when it failed — a machine with no configuration file can still be told
 * its port is occupied and its UI is missing, and being told all three at once is the
 * difference between one run and three.
 */
export async function diagnose(d: Diagnosis): Promise<Check[]> {
  // Loaded once and shared. Three checks want the configuration, and `loadConfig`
  // announces what it loaded on the way out — three loads would print that banner
  // three times, above a report that says the same thing more carefully.
  const loaded: LoadOutcome = (() => {
    try {
      return { config: d.loadConfig() };
    } catch (error) {
      return { error };
    }
  })();

  const checks: Check[] = [installationCheck(d), configurationCheck(d)];

  const settings = settingsCheck(loaded);
  if (settings !== undefined) checks.push(settings);

  // The address and the terminal are questions about a specific configuration. With
  // none loadable there is no host, no port and no terminal setting to ask about, and
  // inventing the defaults here would report on a server that will never run.
  const config = "config" in loaded ? loaded.config : undefined;
  if (config !== undefined) checks.push(await addressCheck(d, config.host, config.port));

  checks.push(webUiCheck(d));
  checks.push(await gitCheck(d));

  const terminal = await terminalCheck(d, config?.terminal.enabled === true);
  if (terminal !== undefined) checks.push(terminal);

  return checks;
}

/** `fail` anywhere means the server would not serve; a script may rely on this. */
export function exitCodeFor(checks: readonly Check[]): number {
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

const MARK: Record<CheckStatus, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

/**
 * The report as text.
 *
 * A fixed-width status column and a hanging indent, rather than a table: the paths
 * here are long, absolute and Windows-shaped, and a table that wraps them is harder
 * to read than a list that does not try.
 */
export function renderReport(checks: readonly Check[]): string {
  const lines: string[] = [];
  for (const check of checks) {
    const [first, ...rest] = check.detail;
    const indent = " ".repeat(22);
    lines.push(`[${MARK[check.status]}] ${check.name.padEnd(14)} ${first ?? ""}`.trimEnd());
    // trimEnd on every line: a remedy uses "" as a paragraph break, and a line of
    // twenty-two spaces is trailing whitespace in whatever the operator pastes it into.
    for (const line of rest) lines.push(`${indent}${line}`.trimEnd());
    for (const line of check.remedy ?? []) lines.push(`${indent}${line}`.trimEnd());
    if ((check.remedy?.length ?? 0) > 0) lines.push("");
  }
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  lines.push(
    failed > 0
      ? `${failed} problem${failed === 1 ? "" : "s"} would stop this server from serving.`
      : warned > 0
        ? "Nothing would stop the server; the warnings above are capabilities you will find missing."
        : "Nothing to report — this installation can start and serve.",
  );
  return lines.join("\n");
}

/** Real probe: ask `/health` and let the answer, or the refusal, decide. */
export const probeAddress: ProbeAddress = async (host, port) => {
  const http = await import("node:http");
  const url = new URL("health", browsableUrl({ address: host, port }));
  return await new Promise<AddressProbe>((resolve) => {
    const request = http.get(url, { timeout: 2_000 }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        // 200 and 503 both come from this server — 503 is the startup stub, which is
        // still a pi-outpost holding the port. Anything else answered, but not this.
        const body = Buffer.concat(chunks).toString("utf8");
        const looksLikeUs = (() => {
          try {
            return typeof (JSON.parse(body) as { ok?: unknown }).ok === "boolean";
          } catch {
            return false;
          }
        })();
        resolve({ listening: true, answersHealth: looksLikeUs });
      });
    });
    request.on("timeout", () => {
      request.destroy();
      // Something accepted the connection and then said nothing: it is listening, and
      // it is not answering the way this server does.
      resolve({ listening: true, answersHealth: false });
    });
    request.on("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code === "ECONNREFUSED" ? { listening: false } : { listening: true, answersHealth: false });
    });
  });
};

/**
 * The same test `index.ts` makes of a candidate: it must carry a real `index.html`.
 *
 * Named apart from that file's own async `hasIndexHtml` rather than shadowing it —
 * one answers during startup where everything is already a promise, this one answers
 * a report being composed line by line.
 */
export function carriesIndexHtml(candidate: string): boolean {
  return fsSync.statSync(path.join(candidate, "index.html"), { throwIfNoEntry: false })?.isFile() === true;
}

/** The candidates `index.ts` tries for the UI on disk, in its order. */
export function webDistCandidatesFor(serverDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return env.PI_OUTPOST_WEB_DIST
    ? [path.resolve(env.PI_OUTPOST_WEB_DIST)]
    : [
        path.resolve(serverDir, "./web/dist"),
        path.resolve(serverDir, "./web"),
        path.resolve(serverDir, "../../web/dist"),
      ];
}
