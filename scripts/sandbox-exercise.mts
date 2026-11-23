/**
 * The agent's confined shell exercised on this machine, as the server would run it: the user's own
 * configuration (runner, shell, allowed hosts, cache), their PATH, their tools, a real project.
 *
 *   npm run sandbox:exercise -- [project folder]   (default: the current folder)
 *
 * Unit tests run against layouts written for them, and the defects that reached users lived in the
 * layouts nobody wrote: a project in the home, tools in AppData, a mirror in the user's uv.toml. Each
 * check below is one of those, measured on a real machine. A tool that is not installed is skipped,
 * saying so. Run it before a release that touches the Windows sandbox; it exits 1 on a failure.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../server/src/config.ts";
import { confinedBashOperations } from "../server/src/confinedBash.ts";
import { agentBashOptions } from "../server/src/sandbox.ts";
import { checkRunner } from "../server/src/terminalSandbox.ts";

interface Check {
  name: string;
  /** A PowerShell command, as the agent would write it. */
  command: string;
  /** Skipped, saying why, when this is not true here. */
  needs?: () => string | undefined;
  /** Undefined when the run is right; else what is wrong. */
  judge: (output: string, exitCode: number | null) => string | undefined;
}

const project = path.resolve(process.argv[2] ?? process.cwd());
const home = homedir();
const onPath = (name: string) => () => ((process.env.PATH ?? "").split(path.delimiter).some((dir) => [".exe", ".cmd", ".ps1", ""].some((ext) => existsSync(path.join(dir, name + ext)))) ? undefined : `no ${name} on PATH`);
const succeeded = (pattern: RegExp) => (output: string, exitCode: number | null) => (exitCode !== 0 ? `exit ${exitCode}` : pattern.test(output) ? undefined : `output lacks ${pattern}`);
const refused = (marker: string) => (output: string) => (output.includes(`${marker}: refused`) ? undefined : `${marker} was reached`);
/** A global npm CLI of this user's, under AppData\Roaming\npm: the layout of issue #553. */
const npmGlobal = (() => {
  const dir = path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm");
  try {
    return readdirSync(dir).find((name) => name.endsWith(".ps1") && name !== "npm.ps1" && name !== "npx.ps1")?.replace(/\.ps1$/, "");
  } catch {
    return undefined;
  }
})();

const checks: Check[] = [
  { name: "a command runs", command: `"ok"`, judge: succeeded(/^ok$/m) },
  { name: "node and npm", command: "node --version; npm --version", needs: onPath("node"), judge: succeeded(/^v\d+/m) },
  {
    name: `a global npm CLI (${npmGlobal ?? "none"}) resolves through the folders above it`,
    command: `${npmGlobal} --version`,
    needs: () => (npmGlobal ? undefined : "no global npm CLI in AppData\\Roaming\\npm"),
    judge: (output, code) => (/EPERM/.test(output) ? "EPERM resolving its path (#553)" : code !== 0 ? `exit ${code}` : undefined),
  },
  { name: "python", command: "python --version", needs: onPath("python"), judge: succeeded(/^Python \d/m) },
  { name: "uv", command: "uv --version", needs: onPath("uv"), judge: succeeded(/^uv \d/m) },
  { name: "git in the project", command: "git status --short | Select-Object -First 1; git log --oneline -1", needs: () => (existsSync(path.join(project, ".git")) ? undefined : "the project is not a git repository"), judge: (_o, code) => (code === 0 ? undefined : `exit ${code}`) },
  { name: "rg", command: "rg --version | Select-Object -First 1", needs: onPath("rg"), judge: succeeded(/^ripgrep/m) },
  { name: "cargo", command: "cargo --version", needs: onPath("cargo"), judge: succeeded(/^cargo \d/m) },
  { name: "go", command: "go version", needs: onPath("go"), judge: succeeded(/^go version/m) },
  { name: "dotnet, without its first-run banner", command: "dotnet --version", needs: onPath("dotnet"), judge: (output, code) => (code !== 0 ? `exit ${code}` : /Welcome|Bienvenue/.test(output) ? "the first-run banner reached the output" : undefined) },
  { name: "a native program's stderr redirected is no failure (2>&1)", command: "java -version 2>&1 | ForEach-Object { \"$_\" }", needs: onPath("java"), judge: (_o, code) => (code === 0 ? undefined : `exit ${code}: a success read as a failure`) },
  { name: "the user's .ssh stays out", command: `try { Get-ChildItem -Force '${path.join(home, ".ssh")}' -ErrorAction Stop | Out-Null; ".ssh: listed" } catch { ".ssh: refused" }`, needs: () => (existsSync(path.join(home, ".ssh")) ? undefined : "no ~/.ssh"), judge: refused(".ssh") },
  { name: "the user's ~/.cargo stays out", command: `try { Get-ChildItem -Force '${path.join(home, ".cargo")}' -ErrorAction Stop | Out-Null; ".cargo: listed" } catch { ".cargo: refused" }`, needs: () => (existsSync(path.join(home, ".cargo")) ? undefined : "no ~/.cargo"), judge: refused(".cargo") },
  { name: "the agent directory stays out", command: `try { Get-ChildItem -Force '${getAgentDir()}' -ErrorAction Stop | Out-Null; "agent: listed" } catch { "agent: refused" }`, judge: refused("agent") },
  {
    name: "the user's package configuration is carried, no credential in it",
    command: "foreach ($f in @((Join-Path $env:APPDATA 'uv\\uv.toml'), $env:PIP_CONFIG_FILE, $env:npm_config_userconfig)) { if ($f -and (Test-Path $f)) { Get-Content -Raw $f } }",
    judge: (output) => (/_authToken\s*=|:\/\/[^\s/@]+:[^\s/@]+@|password\s*=/i.test(output) ? "a credential reached a command" : undefined),
  },
  { name: "the Internet (pypi.org)", command: "(Invoke-WebRequest https://pypi.org/simple/six/ -UseBasicParsing).StatusCode", judge: (output) => (/^200$/m.test(output) ? undefined : /network refused|not in sandbox.allowedHosts/.test(output) ? undefined : "pypi.org unreachable, and not by the list") },
];

const config = loadConfig(project, {}, process.env, { quiet: true });
const sandbox = config.sandbox;
if (!sandbox?.bashRunner || sandbox.bashRunner === "none") {
  console.error("This configuration runs no confined shell (sandbox.bashRunner): nothing to exercise.");
  process.exit(2);
}
const check = await checkRunner(sandbox.bashRunner);
if (!check.ok) {
  console.error(`The runner cannot confine here: ${"reason" in check ? check.reason : ""}`);
  process.exit(2);
}
const options = await agentBashOptions({ ...sandbox, root: project, writableRoot: undefined }, { agentDir: config.agentDir ?? getAgentDir(), configFile: config.configFile });
const ops = confinedBashOperations(options);
console.log(`Exercising ${sandbox.bashRunner} (${sandbox.bashShell ?? "bash"}) on ${project}\n`);

let failures = 0;
for (const item of checks) {
  const why = item.needs?.();
  if (why) {
    console.log(`  SKIP  ${item.name} — ${why}`);
    continue;
  }
  let output = "";
  let exitCode: number | null = null;
  const started = Date.now();
  try {
    ({ exitCode } = await ops.exec(item.command, project, { onData: (data) => (output += data.toString()), timeout: 120 }));
  } catch (error) {
    output += `\n${(error as Error).message}`;
  }
  const wrong = item.judge(output, exitCode);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (wrong) {
    failures++;
    console.log(`  FAIL  ${item.name} (${seconds} s) — ${wrong}\n${output.trim().split(/\r?\n/).slice(-8).map((line) => `          ${line}`).join("\n")}`);
  } else {
    console.log(`  ok    ${item.name} (${seconds} s)`);
  }
}
console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
