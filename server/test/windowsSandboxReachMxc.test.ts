/**
 * What a command of the agent's confined PowerShell reaches beside the root, under MXC's real
 * process container (Windows 11, tier 1): a tool installed beside the project (issue #553) and the
 * private network (issue #552).
 *
 * Only where `MXC_EXEC` names the runner: no CI runner has MXC tier 1.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations, type ConfinedBashOptions } from "../src/confinedBash.ts";
import { checkRunner, windowsToolchains } from "../src/terminalSandbox.ts";
import { startEgressProxy } from "../src/egressProxy.ts";

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const skip = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC is not set" : false;

describe("what a confined command reaches beside the root, under MXC", { skip }, () => {
  let base: string;
  let root: string;
  let agentDir: string;
  let toolBin: string;
  const savedPath = process.env.PATH;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "sandbox-reach-mxc-"));
    root = path.join(base, "app");
    agentDir = path.join(base, "agent");
    // A tool installed beside the project, as a global npm CLI is: a launcher on PATH running a
    // script of its own, under folders the command is otherwise refused (siblings of the root).
    const install = path.join(base, "dev", "nodejs", "current");
    toolBin = path.join(install, "bin");
    await mkdir(path.join(toolBin, "node_modules", "foo"), { recursive: true });
    await writeFile(path.join(toolBin, "node_modules", "foo", "foo.js"), `console.log("foo-ran " + require("node:fs").realpathSync(__filename));\n`);
    await writeFile(path.join(toolBin, "foo.ps1"), `node "$PSScriptRoot\\node_modules\\foo\\foo.js" @args\nexit $LASTEXITCODE\n`);
    // Beside the way down to the tool: never to be listed nor read.
    await mkdir(path.join(base, "dev", "other-project"), { recursive: true });
    await writeFile(path.join(base, "dev", "other-project", "secret.txt"), "other-secret");
    await writeFile(path.join(base, "dev", "notes.txt"), "notes-secret");
    await mkdir(root, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    process.env.PATH = `${toolBin};${savedPath}`;
  });

  after(async () => {
    process.env.PATH = savedPath;
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  async function ps(command: string, extra: Partial<ConfinedBashOptions> = {}) {
    const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir, ...extra });
    let output = "";
    const { exitCode } = await ops.exec(command, root, { onData: (data) => (output += data.toString()), timeout: 120 });
    return { output, exitCode };
  }

  // openlore: scenario=AToolBesideTheRootResolves spec=sandbox-runner-bash
  test("AToolBesideTheRootResolves, as a user's machine lays it out: a project in the home, a global npm CLI in AppData, the rest of the home out", async () => {
    // Every root above was in the temporary folder, under AppData: AppData was on the way down and never
    // denied, which is how a project in the home with its global npm CLIs escaped every test (#553).
    const userHome = path.join(base, "layout", "Users", "me");
    const project = path.join(userHome, "projects", "app");
    const npmBin = path.join(userHome, "AppData", "Roaming", "npm");
    await mkdir(path.join(npmBin, "node_modules", "corp-cli"), { recursive: true });
    await writeFile(path.join(npmBin, "node_modules", "corp-cli", "cli.js"), `console.log("corp-cli-ran " + require("node:fs").realpathSync(__filename));\n`);
    // npm's own shim: node beside it if there, else node on PATH.
    await writeFile(path.join(npmBin, "corp-cli.ps1"), `$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent\n& node "$basedir/node_modules/corp-cli/cli.js" @args\nexit $LASTEXITCODE\n`);
    for (const [dir, file] of [[".ssh", "id_ed25519"], [".cargo", "credentials.toml"], ["Documents", "taxes.pdf"]] as const) {
      await mkdir(path.join(userHome, dir), { recursive: true });
      await writeFile(path.join(userHome, dir, file), "secret-content");
    }
    await mkdir(path.join(userHome, ".cargo", "bin"), { recursive: true });
    await mkdir(project, { recursive: true });
    const saved = { PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE };
    process.env.PATH = `${npmBin};${path.join(userHome, ".cargo", "bin")};${saved.PATH}`;
    process.env.USERPROFILE = userHome;
    try {
      const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root: project, allowWrite: true, agentDir });
      let output = "";
      const { exitCode } = await ops.exec(
        [
          "corp-cli",
          `try { Get-ChildItem -Force '${path.join(userHome, ".ssh")}' -ErrorAction Stop | Out-Null; "ssh: listed" } catch { "ssh: refused" }`,
          `try { Get-ChildItem -Force '${path.join(userHome, ".cargo")}' -ErrorAction Stop | Out-Null; "cargo: listed" } catch { "cargo: refused" }`,
          `try { Get-Content -Raw '${path.join(userHome, "Documents", "taxes.pdf")}' -ErrorAction Stop } catch { "documents: refused" }`,
          `try { Get-ChildItem -Force '${path.join(userHome, "AppData", "Roaming")}' -Name -ErrorAction Stop } catch { "roaming: refused" }`,
        ].join("; "),
        project,
        { onData: (data) => (output += data.toString()), timeout: 120 },
      );
      assert.equal(exitCode, 0, output);
      assert.match(output, /corp-cli-ran .*cli\.js/, "the global CLI runs and resolves its own path");
      assert.doesNotMatch(output, /EPERM/);
      assert.match(output, /ssh: refused/);
      assert.match(output, /cargo: refused/, "a folder directly in the home is never enumerated: ~\\.cargo holds credentials.toml");
      assert.match(output, /documents: refused/);
      assert.doesNotMatch(output, /secret-content/);
    } finally {
      process.env.PATH = saved.PATH;
      process.env.USERPROFILE = saved.USERPROFILE;
    }
  });

  // openlore: scenario=AToolBesideTheRootResolves spec=sandbox-runner-bash
  test("AToolBesideTheRootResolves: a script beside the root runs by its launcher on PATH, and what lies beside stays out", async () => {
    const run = await ps("foo");
    assert.equal(run.exitCode, 0, run.output);
    assert.match(run.output, /foo-ran .*foo\.js/, "Node resolved the script's real path through the folders above it");
    assert.doesNotMatch(run.output, /EPERM/);

    const beside = await ps(
      [
        `try { Get-Content -Raw "${path.join(base, "dev", "notes.txt")}" -ErrorAction Stop } catch { "notes: refused" }`,
        `try { Get-ChildItem -Name "${path.join(base, "dev", "other-project")}" -ErrorAction Stop } catch { "other: refused" }`,
        `try { Get-Content -Raw "${path.join(base, "dev", "other-project", "secret.txt")}" -ErrorAction Stop } catch { "secret: refused" }`,
      ].join("; "),
    );
    assert.match(beside.output, /notes: refused/, beside.output);
    assert.match(beside.output, /other: refused/, beside.output);
    assert.match(beside.output, /secret: refused/, beside.output);
    assert.doesNotMatch(beside.output, /notes-secret|other-secret|secret\.txt/);
  });

  /**
   * Another address of this machine's own subnet: what Windows counts as the private network is the
   * subnets the machine is on (and intranet ranges a policy names), not every RFC 1918 range. The
   * machine's own address will not do — Windows counts it as the host's loopback.
   */
  function neighbour(): string | undefined {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const a of addresses ?? []) {
        if (a.family !== "IPv4" || a.internal || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
        const parts = a.address.split(".");
        parts[3] = parts[3] === "254" ? "253" : "254";
        return parts.join(".");
      }
    }
    return undefined;
  }
  const peer = neighbour();

  /** A TCP connection to that address: the sandbox's refusal is WSAEACCES (10013), at once. */
  const PRIVATE = `$c = [Net.Sockets.TcpClient]::new(); try { [void]$c.ConnectAsync("${peer}", 9).Wait(3000); "private: not refused" } catch { $code = $_.Exception.InnerException.InnerException.ErrorCode; if ($code -eq 10013) { "private: refused by the sandbox" } else { "private: not refused ($code)" } }`;

  // openlore: scenario=TheIntranetIsReachable spec=sandbox-runner-bash
  test("TheIntranetIsReachable: the private network is refused by default; privateNetwork true, the user's choice, opens it", { skip: peer ? false : "this machine is on no private IPv4 network" }, async () => {
    assert.match((await ps(PRIVATE)).output, /private: refused by the sandbox/);
    assert.match((await ps(PRIVATE, { privateNetwork: true })).output, /private: not refused/);
    // Under sandbox.allowedHosts the request asks `ingress.default: allow`, which MXC requires beside a
    // proxy and which, microsoft/mxc#830 says, opens the private network both ways. Measured: the proxy
    // shape closes it all the same, even with privateNetwork true. The list stays the only way out.
    const proxy = await startEgressProxy({ allowedHosts: [] });
    try {
      assert.match((await ps(PRIVATE, { networkProxy: proxy, allowedHosts: [], privateNetwork: true })).output, /private: refused by the sandbox/);
    } finally {
      await proxy.close();
    }
  });

  // openlore: scenario=ASandboxRefusalIsNamed spec=sandbox-runner-bash
  test("ASandboxRefusalIsNamed: a refused connection's output ends saying it was the sandbox, and which setting", { skip: peer ? false : "this machine is on no private IPv4 network" }, async () => {
    // The program's own words, as uv and Python print them: the error's message, in the user's language.
    const refused = await ps(`$c = [Net.Sockets.TcpClient]::new(); try { [void]$c.ConnectAsync("${peer}", 9).Wait(3000) } catch { $_.Exception.InnerException.InnerException.Message; exit 1 }`);
    const named = new RegExp(`\\[pi-outpost\\] the sandbox refused ${peer!.replaceAll(".", "\\.")}: it is on this machine's private network`);
    assert.match(refused.output, named, refused.output);
    assert.match(refused.output, /closed unless the user sets sandbox\.privateNetwork to true/);
    assert.match(refused.output, /Only the user can open it/);
    // curl says only that it could not connect: the host is named from the policy, not from its words.
    const curl = await ps(`curl.exe -sS -m 5 http://${peer}/`);
    assert.notEqual(curl.exitCode, 0);
    assert.match(curl.output, /Couldn't connect to server/, curl.output);
    assert.match(curl.output, named, curl.output);
    assert.doesNotMatch(curl.output, /diagnose: true/, "a refused connection is no refused file: no diagnosis offered");
    const open = await ps(`"connected or not, no refusal"`);
    assert.doesNotMatch(open.output, /the sandbox refused/);
  });

  // openlore: scenario=TheUsersMirrorIsSeen spec=sandbox-runner-bash
  test("TheUsersMirrorIsSeen: uv, pip, npm, Cargo, Go and NuGet in a command see the user's mirror, never its credentials", async () => {
    // A user of their own: their AppData and home, with a company's mirror and its credentials.
    const home = path.join(base, "user");
    const roaming = path.join(home, "AppData", "Roaming");
    await mkdir(path.join(roaming, "uv"), { recursive: true });
    await mkdir(path.join(roaming, "pip"), { recursive: true });
    await writeFile(path.join(roaming, "uv", "uv.toml"), `index-url = "https://alice:uv-s3cret@nexus.corp.example:8446/repository/pypi/simple"\n`);
    await writeFile(path.join(roaming, "pip", "pip.ini"), "[global]\nindex-url = https://alice:pip-s3cret@nexus.corp.example:8446/repository/pypi/simple\n");
    await writeFile(path.join(home, ".npmrc"), "registry=https://npm.corp.example/\n//npm.corp.example/:_authToken=npm-s3cret\n");
    // Cargo's, Go's and NuGet's: an alias proves Cargo read its copy; the others say their source.
    await mkdir(path.join(home, ".cargo"), { recursive: true });
    await writeFile(path.join(home, ".cargo", "config.toml"), `[alias]\ncorp-version = "version"\n[registries.corp]\nindex = "sparse+https://cargo.corp.example/index/"\ntoken = "cargo-s3cret"\n`);
    await mkdir(path.join(roaming, "go"), { recursive: true });
    await writeFile(path.join(roaming, "go", "env"), "GOPROXY=https://alice:go-s3cret@goproxy.corp.example\nGOPRIVATE=*.corp.example\n");
    await mkdir(path.join(roaming, "NuGet"), { recursive: true });
    await writeFile(
      path.join(roaming, "NuGet", "NuGet.Config"),
      `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <add key="corp-feed" value="https://nuget.corp.example/v3/index.json" />\n  </packageSources>\n  <packageSourceCredentials>\n    <corp-feed>\n      <add key="Username" value="alice" />\n      <add key="ClearTextPassword" value="nuget-s3cret" />\n    </corp-feed>\n  </packageSourceCredentials>\n</configuration>\n`,
    );
    const serverEnv: NodeJS.ProcessEnv = { ...process.env, APPDATA: roaming, RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(homedir(), ".rustup") };
    for (const moved of ["CARGO_HOME", "GRADLE_USER_HOME", "GOENV", "npm_config_userconfig", "NPM_CONFIG_USERCONFIG"]) delete serverEnv[moved];
    const toolchains = windowsToolchains({ cacheDir: path.join(base, "sandbox-cache"), serverEnv, home, agentDir });
    const { output, exitCode } = await ps(
      [
        `uv -v pip compile --no-header - 2>&1 | Select-String -Pattern "user configuration" | ForEach-Object { "$_" }`,
        `"uv.toml: " + (Get-Content -Raw (Join-Path $env:APPDATA 'uv\\uv.toml'))`,
        `"pip: " + (python -m pip config list 2>&1 | Out-String)`,
        `"npm: " + (npm config get registry)`,
        `"npmrc: " + (Get-Content -Raw $env:npm_config_userconfig)`,
        `"cargo: " + (cargo corp-version)`,
        `"cargo config: " + (Get-Content -Raw (Join-Path $env:CARGO_HOME 'config.toml'))`,
        `"go: " + (go env GOPROXY GOPRIVATE | Out-String)`,
        `"nuget: " + (dotnet nuget list source 2>&1 | Out-String)`,
        `"nuget config: " + (Get-Content -Raw (Join-Path $env:APPDATA 'NuGet\\NuGet.Config'))`,
      ].join("; "),
      { toolchains },
    );
    assert.equal(exitCode, 0, output);
    assert.match(output, /Found user configuration in: .*sandbox-cache\\appdata\\Roaming\\uv\\uv\.toml/, output);
    assert.match(output, /index-url = "https:\/\/nexus\.corp\.example:8446\/repository\/pypi\/simple"/);
    assert.match(output, /global\.index-url='https:\/\/nexus\.corp\.example:8446\/repository\/pypi\/simple'/, output);
    assert.match(output, /npm: https:\/\/npm\.corp\.example\//, output);
    assert.match(output, /cargo: cargo \d/, "Cargo ran the user's alias: it read the copy");
    assert.match(output, /go: https:\/\/goproxy\.corp\.example\s+\*\.corp\.example/, output);
    assert.match(output, /https:\/\/nuget\.corp\.example\/v3\/index\.json/, output);
    assert.doesNotMatch(output, /s3cret|alice/, "no credential reaches a command");
  });

  // openlore: scenario=TheCredentialsStayInTheServer spec=sandbox-runner-bash
  test("TheCredentialsStayInTheServer: npm and uv install from the user's authenticated registry through the relay; the command never holds the token", async () => {
    // A company's registry on this machine: npm's packument and tarball behind a Bearer token, a
    // PyPI simple index and wheel behind a password. Unconfined, as the real one is outside.
    const work = path.join(base, "registry");
    await mkdir(path.join(work, "pkg"), { recursive: true });
    await writeFile(path.join(work, "pkg", "package.json"), JSON.stringify({ name: "corp-pkg", version: "1.0.0", main: "index.js" }));
    await writeFile(path.join(work, "pkg", "index.js"), "module.exports = 'corp-pkg-ok';\n");
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--silent"], { cwd: path.join(work, "pkg"), shell: true });
    const tarball = await readFile(path.join(work, "pkg", "corp-pkg-1.0.0.tgz"));
    // A wheel is a zip: Python writes one, with the three files pip and uv read.
    const wheelPath = path.join(work, "corp_py-0.1-py3-none-any.whl");
    execFileSync("python", ["-c", [
      "import zipfile, sys",
      "z = zipfile.ZipFile(sys.argv[1], 'w')",
      "z.writestr('corp_py.py', 'OK = \"corp-py-ok\"\\n')",
      "z.writestr('corp_py-0.1.dist-info/METADATA', 'Metadata-Version: 2.1\\nName: corp-py\\nVersion: 0.1\\n')",
      "z.writestr('corp_py-0.1.dist-info/WHEEL', 'Wheel-Version: 1.0\\nGenerator: test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')",
      "z.writestr('corp_py-0.1.dist-info/RECORD', '')",
      "z.close()",
    ].join("\n"), wheelPath]);
    const wheel = await readFile(wheelPath);
    const TOKEN = "npm_c0rp_t0ken";
    const PYPI = `Basic ${Buffer.from("alice:py-s3cret").toString("base64")}`;
    const requests: string[] = [];
    const registry = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      const at = `http://${req.headers.host}`;
      if (req.url?.startsWith("/npm/")) {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
        if (req.url === "/npm/corp-pkg") {
          const sha = createHash("sha1").update(tarball).digest("hex");
          return void res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({ name: "corp-pkg", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { name: "corp-pkg", version: "1.0.0", dist: { tarball: `${at}/npm/corp-pkg/-/corp-pkg-1.0.0.tgz`, shasum: sha } } } }),
          );
        }
        if (req.url === "/npm/corp-pkg/-/corp-pkg-1.0.0.tgz") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(tarball);
      }
      if (req.url?.startsWith("/pypi/")) {
        if (req.headers.authorization !== PYPI) return void res.writeHead(401).end();
        const sha = createHash("sha256").update(wheel).digest("hex");
        if (req.url === "/pypi/simple/corp-py/") return void res.writeHead(200, { "content-type": "text/html" }).end(`<a href="${at}/pypi/files/corp_py-0.1-py3-none-any.whl#sha256=${sha}">corp_py-0.1-py3-none-any.whl</a>`);
        if (req.url === "/pypi/files/corp_py-0.1-py3-none-any.whl") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(wheel);
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => registry.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
    try {
      const home = path.join(base, "relay-user");
      const roaming = path.join(home, "AppData", "Roaming");
      await mkdir(path.join(roaming, "uv"), { recursive: true });
      await writeFile(path.join(home, ".npmrc"), `registry=${origin}/npm/\n//127.0.0.1:${new URL(origin).port}/npm/:_authToken=${TOKEN}\n`);
      await writeFile(path.join(roaming, "uv", "uv.toml"), `index-url = "${origin.replace("http://", "http://alice:py-s3cret@")}/pypi/simple"\n`);
      const serverEnv: NodeJS.ProcessEnv = { ...process.env, APPDATA: roaming, RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(homedir(), ".rustup") };
      for (const moved of ["CARGO_HOME", "GRADLE_USER_HOME", "GOENV", "npm_config_userconfig", "NPM_CONFIG_USERCONFIG"]) delete serverEnv[moved];
      const toolchains = windowsToolchains({ cacheDir: path.join(base, "relay-cache"), serverEnv, home, agentDir, relayRoute: "loopback" });
      const { output, exitCode } = await ps(
        [
          `New-Item -ItemType Directory -Force relayed | Out-Null; Set-Location relayed`,
          `npm init -y | Out-Null; npm install corp-pkg --no-audit --no-fund 2>&1 | ForEach-Object { "$_" }`,
          `"npm module: " + (node -e "console.log(require('corp-pkg'))")`,
          `uv venv -q .v 2>&1 | Out-Null; uv pip install -q --python .v corp-py 2>&1 | ForEach-Object { "$_" }`,
          `"uv module: " + (.v\\Scripts\\python.exe -c "import corp_py; print(corp_py.OK)")`,
          `"npmrc: " + (Get-Content -Raw $env:npm_config_userconfig)`,
          `"uv.toml: " + (Get-Content -Raw (Join-Path $env:APPDATA 'uv\\uv.toml'))`,
          // Publishing with the user's credentials is refused by the relay.
          `$registry = (npm config get registry).Trim(); try { Invoke-WebRequest -Method Put -Uri ($registry + 'corp-pkg') -Body '{}' -ErrorAction Stop | Out-Null; "put: accepted" } catch { "put: " + $_.Exception.Response.StatusCode.value__ }`,
        ].join("; "),
        { toolchains },
      );
      assert.equal(exitCode, 0, output);
      assert.match(output, /npm module: corp-pkg-ok/, output);
      assert.match(output, /uv module: corp-py-ok/, output);
      assert.match(output, /put: 405/, output);
      assert.doesNotMatch(output, new RegExp(`${TOKEN}|py-s3cret|alice`), "no credential in anything a command saw");
      assert.ok(requests.includes("GET /npm/corp-pkg") && requests.includes("GET /pypi/simple/corp-py/"), requests.join("\n"));
      assert.ok(!requests.some((line) => line.startsWith("PUT")), "the PUT never reached the registry");

      // Under sandbox.allowedHosts, listing nothing: the relay is reached through the command's proxy alone.
      const proxy = await startEgressProxy({ allowedHosts: [] });
      try {
        const proxied = windowsToolchains({ cacheDir: path.join(base, "relay-cache-proxy"), serverEnv, home, agentDir, relayRoute: "proxy" });
        const behind = await ps(
          `New-Item -ItemType Directory -Force proxied | Out-Null; Set-Location proxied; npm init -y | Out-Null; npm install corp-pkg --no-audit --no-fund 2>&1 | ForEach-Object { "$_" }; "npm module: " + (node -e "console.log(require('corp-pkg'))"); "registry: " + (npm config get registry)`,
          { toolchains: proxied, networkProxy: proxy, allowedHosts: [] },
        );
        assert.equal(behind.exitCode, 0, behind.output);
        assert.match(behind.output, /npm module: corp-pkg-ok/, behind.output);
        assert.match(behind.output, /registry: http:\/\/registry-relay\.pi-outpost\.invalid\//);
        assert.doesNotMatch(behind.output, new RegExp(TOKEN));
      } finally {
        await proxy.close();
      }
    } finally {
      await new Promise((resolve) => registry.close(resolve));
    }
  });

  /** A program on the search path, found as the shell would: undefined when not installed. */
  const onPath = (name: string) =>
    (process.env.PATH ?? "").split(";").map((dir) => path.join(dir, name)).find((file) => existsSync(file));
  const mvn = onPath("mvn.cmd");
  const gradle = onPath("gradle.bat");

  // openlore: scenario=TheUsersMirrorIsSeen spec=sandbox-runner-bash
  test("TheUsersMirrorIsSeen, Maven and Gradle: Maven reads the carried settings.xml and reaches its mirror through the relay; Gradle reads gradle.properties without its secret", { skip: mvn && gradle ? false : "needs mvn and gradle on PATH" }, async () => {
    const PASSWORD = "mvn-s3cret";
    const AUTH = `Basic ${Buffer.from(`alice:${PASSWORD}`).toString("base64")}`;
    const seen: Array<{ url: string; authorized: boolean }> = [];
    // The company's Maven repository: it answers only with alice's password, and has none of what Maven asks.
    const registry = createServer((req, res) => {
      seen.push({ url: req.url ?? "", authorized: req.headers.authorization === AUTH });
      res.writeHead(req.headers.authorization === AUTH ? 404 : 401).end();
    });
    await new Promise<void>((resolve) => registry.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
    try {
      const home = path.join(base, "jvm-user");
      await mkdir(path.join(home, ".m2"), { recursive: true });
      await mkdir(path.join(home, ".gradle"), { recursive: true });
      await writeFile(
        path.join(home, ".m2", "settings.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<settings>\n  <mirrors><mirror><id>corp</id><mirrorOf>*</mirrorOf><url>${origin}/maven/</url></mirror></mirrors>\n  <servers><server><id>corp</id><username>alice</username><password>${PASSWORD}</password></server></servers>\n</settings>\n`,
      );
      await writeFile(path.join(home, ".gradle", "gradle.properties"), `corpRepoUrl=${origin}/maven/\ncorpPassword=gradle-s3cret\norg.gradle.daemon=false\n`);
      const project = path.join(root, "jvm");
      await mkdir(project, { recursive: true });
      await writeFile(path.join(project, "settings.gradle"), "rootProject.name = 'jvm'\n");
      await writeFile(path.join(project, "build.gradle"), "tasks.register('corp') { doLast { println \"corpRepoUrl=\" + findProperty('corpRepoUrl'); println \"corpPassword=\" + findProperty('corpPassword') } }\n");
      const serverEnv: NodeJS.ProcessEnv = { ...process.env, APPDATA: path.join(home, "AppData", "Roaming") };
      for (const moved of ["CARGO_HOME", "GRADLE_USER_HOME", "GOENV", "npm_config_userconfig", "NPM_CONFIG_USERCONFIG"]) delete serverEnv[moved];
      const toolchains = windowsToolchains({ cacheDir: path.join(base, "jvm-cache"), serverEnv, home, agentDir, relayRoute: "loopback" });
      const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir, toolchains });
      let output = "";
      await ops.exec(
        [
          "Set-Location jvm",
          // -X says which settings file it read; the plugin it asks for goes to the mirror, through the relay.
          `mvn -X -B -ntp help:help 2>&1 | Select-String -Pattern "Reading user settings|Using mirror corp" | ForEach-Object { "$_" }`,
          `"settings: " + (Get-Content -Raw (($env:MAVEN_ARGS -replace '^-s "', '') -replace '"$', ''))`,
          `gradle -q --no-daemon corp 2>&1 | ForEach-Object { "$_" }`,
        ].join("; "),
        root,
        { onData: (data) => (output += data.toString()), timeout: 600 },
      );
      assert.match(output, /Reading user settings from .*jvm-cache\\user-config\\settings\.xml/, output);
      assert.match(output, /Using mirror corp \(http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}\/[0-9a-f]{16}\/maven\/\) for central/, "the mirror is the relay's");
      assert.ok(seen.length > 0 && seen.every((request) => request.authorized), `Maven's requests reached the repository with alice's password, added by the relay: ${JSON.stringify(seen.slice(0, 3))}`);
      assert.ok(seen.some((request) => request.url.startsWith("/maven/")));
      assert.match(output, new RegExp(`corpRepoUrl=${origin.replace(/[.:/]/g, "\\$&")}/maven/`), "Gradle read its user home's gradle.properties");
      assert.match(output, /corpPassword=null/, "its secret property was left out");
      assert.doesNotMatch(output, /s3cret|<password>/, "no credential reached a command");
    } finally {
      await new Promise((resolve) => registry.close(resolve));
    }
  });
});
