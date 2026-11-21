/**
 * The installations a Windows search path only points at, made readable under MXC
 * (`toolInstallations` in `terminalSandbox.ts`): Git's launchers, scoop's shims, WinGet's links, a
 * linked folder, and the Python a virtual environment stands on — and never more than that.
 *
 * The disk is a fake here, so this runs everywhere; what MXC does with the folders is the
 * `…Mxc.test.ts` suites' job.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { msysFolders, msysNote, msysProgramNamed, mxcTerminalConfig, toolInstallations, windowsToolchains, withoutMsysFolders, type ToolInstallationReader } from "../src/terminalSandbox.ts";

const HOME = "C:\\Users\\me";
const ROOT = "L:\\Python\\isai_oper";
const AGENT_DIR = `${HOME}\\.pi\\agent`;
const CONFIG = `${HOME}\\pi-outpost.config.json`;

/** A disk of files (with their text), folders and links, compared without case as Windows does. */
function fakeDisk(layout: { files?: Record<string, string>; folders?: string[]; links?: Record<string, string> }): ToolInstallationReader {
  const key = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");
  const files = new Map(Object.entries(layout.files ?? {}).map(([p, text]) => [key(p), text]));
  const links = new Map(Object.entries(layout.links ?? {}).map(([p, target]) => [key(p), target]));
  const folders = new Set((layout.folders ?? []).map(key));
  const target = (p: string) => links.get(key(p)) ?? p;
  return {
    isFile: (p) => files.has(key(target(p))),
    isDirectory: (p) => folders.has(key(target(p))),
    readText: (p) => files.get(key(p)),
    list: (dir) =>
      [...files.keys(), ...links.keys()]
        .filter((p) => p.startsWith(`${key(dir)}\\`) && !p.slice(key(dir).length + 1).includes("\\"))
        .map((p) => p.slice(key(dir).length + 1)),
    isLink: (p) => links.has(key(p)),
    resolveLink: (p) => links.get(key(p)),
  };
}

const found = (searchPath: string, disk: ToolInstallationReader, root = ROOT) =>
  toolInstallations({ root, searchPath, home: HOME, agentDir: AGENT_DIR, configFile: CONFIG }, disk);

describe("toolInstallations", () => {
  // openlore: scenario=AGitInstalledForTheUserRuns spec=sandbox-runner-bash
  test("AGitInstalledForTheUserRuns: Git's cmd, bin, mingw64\\bin or usr\\bin on PATH opens its installation", () => {
    const git = `${HOME}\\AppData\\Local\\Programs\\Git`;
    const disk = fakeDisk({ files: { [`${git}\\mingw64\\bin\\git.exe`]: "" } });
    for (const entry of ["cmd", "bin", "mingw64\\bin", "usr\\bin"]) {
      assert.deepEqual(found(`${git}\\${entry}`, disk), [git], entry);
    }
    // Another program's cmd folder opens its own installation, as any bin does (windows-toolchains-in-sandbox).
    assert.deepEqual(found(`${HOME}\\AppData\\Local\\Programs\\Other\\cmd`, disk), [`${HOME}\\AppData\\Local\\Programs\\Other`]);
  });

  // openlore: scenario=OnWindowsCmakeFindsItsModules spec=sandbox-runner-bash
  // openlore: scenario=OnWindowsMavenStarts spec=sandbox-runner-bash
  test("the installation above a bin, cmd, Scripts or sbin folder is opened: Strawberry, Maven, a JDK, Go, Python's Scripts", () => {
    const disk = fakeDisk({});
    const maven = `${HOME}\\AppData\\Local\\Programs\\apache-maven-3.9.16`;
    const python = `${HOME}\\AppData\\Local\\Programs\\Python\\Python315`;
    const searchPath = [
      "C:\\Strawberry\\c\\bin",
      "C:\\Strawberry\\perl\\bin",
      `${maven}\\bin`,
      "C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin",
      "C:\\Program Files\\Go\\bin",
      python,
      `${python}\\Scripts`,
    ].join(";");
    assert.deepEqual(found(searchPath, disk), [
      "C:\\Strawberry\\c",
      "C:\\Strawberry\\perl",
      maven,
      "C:\\Program Files\\Eclipse Adoptium\\jdk-21",
      "C:\\Program Files\\Go",
      python,
    ]);
  });

  // openlore: scenario=AnInstallationParentNeverOpensTheProfile spec=sandbox-runner-bash
  test("AnInstallationParentNeverOpensTheProfile: no drive root, no home or folder directly in it, nothing around the agent directory", () => {
    const disk = fakeDisk({});
    // A drive's bin, the home's bin, and folders directly in the home (~\.cargo holds credentials.toml).
    for (const entry of ["C:\\bin", `${HOME}\\bin`, `${HOME}\\.cargo\\bin`, `${HOME}\\.bun\\bin`, `${HOME}\\go\\bin`]) {
      assert.deepEqual(found(entry, disk), [], entry);
    }
    // A bin whose parent holds the agent directory, or lies inside it.
    assert.deepEqual(found(`${HOME}\\.pi\\bin`, disk), []);
    assert.deepEqual(found(`${AGENT_DIR}\\tools\\bin`, disk), []);
  });

  // openlore: scenario=APythonAVirtualEnvironmentStandsOnRuns spec=sandbox-runner-bash
  test("APythonAVirtualEnvironmentStandsOnRuns: the project's .venv names its interpreter, which is opened", () => {
    const python = `${HOME}\\AppData\\Roaming\\uv\\data\\python\\cpython-3.12.8-windows-x86_64-none`;
    const disk = fakeDisk({
      files: { [`${ROOT}\\.venv\\pyvenv.cfg`]: `home = ${python}\r\nimplementation = CPython\r\nuv = 0.9.1\r\n`, [`${python}\\python.exe`]: "" },
      folders: [`${python}\\Lib`],
    });
    assert.deepEqual(found("", disk), [python]);
  });

  // openlore: scenario=AForgedVirtualEnvironmentOpensNothing spec=sandbox-runner-bash
  test("AForgedVirtualEnvironmentOpensNothing: a home that is no Python installation, or that would undo the sandbox, is not taken", () => {
    const venv = (home: string) => ({ [`${ROOT}\\.venv\\pyvenv.cfg`]: `home = ${home}\n` });
    // The agent writes the project: a home naming the documents opens nothing.
    assert.deepEqual(found("", fakeDisk({ files: venv(`${HOME}\\Documents`), folders: [`${HOME}\\Documents`] })), []);
    // A python.exe without its library is not an installation either.
    assert.deepEqual(found("", fakeDisk({ files: { ...venv(`${HOME}\\Downloads`), [`${HOME}\\Downloads\\python.exe`]: "" } })), []);
    // Even a real installation is refused where it would open the profile, the keys or a drive.
    for (const home of [HOME, "C:\\Users", "C:\\", AGENT_DIR, `${AGENT_DIR}\\py`]) {
      const disk = fakeDisk({ files: { ...venv(home), [`${home}\\python.exe`]: "" }, folders: [`${home}\\Lib`] });
      assert.deepEqual(found("", disk), [], home);
    }
  });

  // openlore: scenario=ALauncherIsFollowedToItsProgram spec=sandbox-runner-bash
  test("ALauncherIsFollowedToItsProgram: scoop's shims, WinGet's links and a linked folder lead to the program's folder", () => {
    const scoop = `${HOME}\\scoop`;
    const links = `${HOME}\\AppData\\Local\\Microsoft\\WinGet\\Links`;
    const ripgrep = `${HOME}\\AppData\\Local\\Microsoft\\WinGet\\Packages\\BurntSushi.ripgrep\\ripgrep-14.1.1`;
    const nvm = "C:\\nvm4w\\nodejs";
    const disk = fakeDisk({
      files: {
        [`${scoop}\\shims\\jq.shim`]: `path = "${scoop}\\apps\\jq\\current\\jq.exe"\r\n`,
        [`${scoop}\\shims\\jq.exe`]: "",
        [`${scoop}\\apps\\jq\\current\\jq.exe`]: "",
        // A shim naming what is not there, or a relative path, leads nowhere.
        [`${scoop}\\shims\\gone.shim`]: `path = "${scoop}\\apps\\gone\\gone.exe"`,
        [`${scoop}\\shims\\rel.shim`]: `path = "apps\\rel\\rel.exe"`,
        [`${ripgrep}\\rg.exe`]: "",
      },
      links: { [`${links}\\rg.exe`]: `${ripgrep}\\rg.exe`, [nvm]: "C:\\Users\\me\\AppData\\Local\\nvm\\v22.11.0" },
    });
    assert.deepEqual(found(`${scoop}\\shims;${links};${nvm}`, disk), [`${scoop}\\apps\\jq\\current`, ripgrep, "C:\\Users\\me\\AppData\\Local\\nvm\\v22.11.0"]);
  });

  test("a launcher leading to the profile itself, the keys or a drive's root opens nothing", () => {
    const shims = `${HOME}\\scoop\\shims`;
    const disk = fakeDisk({
      files: {
        [`${shims}\\a.shim`]: `path = "${HOME}\\a.exe"`,
        [`${HOME}\\a.exe`]: "",
        [`${shims}\\b.shim`]: `path = "${AGENT_DIR}\\b.exe"`,
        [`${AGENT_DIR}\\b.exe`]: "",
        [`${shims}\\c.shim`]: `path = "C:\\c.exe"`,
        "C:\\c.exe": "",
      },
    });
    assert.deepEqual(found(shims, disk), []);
  });

  test("only the user's own folders are listed: a system directory is not read name by name", () => {
    let listed = 0;
    const disk = { ...fakeDisk({}), list: () => (listed++, []) };
    found("C:\\Windows\\System32;C:\\Program Files\\nodejs", disk);
    assert.equal(listed, 0);
  });

  test("the folders found are readable in MXC's request, beside the search path's own", () => {
    const git = `${HOME}\\AppData\\Local\\Programs\\Git`;
    const config = mxcTerminalConfig({
      root: ROOT,
      allowWrite: true,
      tmp: `${HOME}\\AppData\\Local\\Temp\\t1`,
      shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      shellArgs: [],
      cwd: ROOT,
      env: { PATH: `${git}\\cmd` },
      siblings: [],
      searchPath: `${git}\\cmd`,
      home: HOME,
      agentDir: AGENT_DIR,
      configFile: CONFIG,
      toolReader: fakeDisk({ files: { [`${git}\\mingw64\\bin\\git.exe`]: "" } }),
    });
    assert.ok(config.filesystem.readonlyPaths.includes(`${git}\\cmd`));
    assert.ok(config.filesystem.readonlyPaths.includes(git));
    assert.ok(!config.filesystem.readwritePaths.includes(git), "read only");
    assert.ok(config.filesystem.deniedPaths.includes(AGENT_DIR));
  });
});

describe("windowsToolchains", () => {
  const CACHE = "C:\\Users\\me\\AppData\\Local\\pi-outpost\\sandbox-cache";

  // openlore: scenario=ADependencyIsDownloadedOnce spec=sandbox-runner-bash
  // openlore: scenario=NpmsGlobalPrefixIsNotInTheProject spec=sandbox-runner-bash
  test("every tool's cache and APPDATA are folders of the sandbox cache, never the user's own", () => {
    const { env, cacheDir } = windowsToolchains({ cacheDir: CACHE, serverEnv: { CARGO_HOME: `${HOME}\\.cargo`, APPDATA: `${HOME}\\AppData\\Roaming` }, home: HOME, agentDir: AGENT_DIR }, fakeDisk({}));
    assert.equal(cacheDir, CACHE);
    for (const name of ["CARGO_HOME", "GRADLE_USER_HOME", "GOPATH", "GOMODCACHE", "GOCACHE", "NUGET_PACKAGES", "DOTNET_CLI_HOME", "BUN_INSTALL_CACHE_DIR", "npm_config_cache", "UV_CACHE_DIR", "PIP_CACHE_DIR", "APPDATA"]) {
      assert.ok(env[name]?.startsWith(`${CACHE}\\`), `${name} = ${env[name]}`);
    }
    assert.equal(env.MAVEN_OPTS, `-Dmaven.repo.local=${CACHE}\\m2\\repository`);
  });

  // openlore: scenario=OnWindowsCargoTestsConfined spec=sandbox-runner-bash
  // openlore: scenario=UvFindsTheUsersPythons spec=sandbox-runner-bash
  test("rustup's home and uv's Pythons are read where they are and named, when they exist", () => {
    const rustup = `${HOME}\\.rustup`;
    const uv = `${HOME}\\AppData\\Roaming\\uv\\python`;
    const present = windowsToolchains({ cacheDir: CACHE, serverEnv: {}, home: HOME }, fakeDisk({ folders: [rustup, uv] }));
    assert.deepEqual(present.readable, [rustup, uv]);
    assert.equal(present.env.RUSTUP_HOME, rustup);
    assert.equal(present.env.UV_PYTHON_INSTALL_DIR, uv);
    // The server's own RUSTUP_HOME is honoured; nothing is named when the folder does not exist.
    const moved = windowsToolchains({ cacheDir: CACHE, serverEnv: { RUSTUP_HOME: "D:\\rust\\rustup" }, home: HOME }, fakeDisk({ folders: ["D:\\rust\\rustup"] }));
    assert.deepEqual(moved.readable, ["D:\\rust\\rustup"]);
    assert.equal(moved.env.UV_PYTHON_INSTALL_DIR, undefined);
  });

  // openlore: scenario=AToolTheTableDoesNotNameKeepsItsCache spec=sandbox-runner-bash
  test("the operator's tool variables are added after the table, ${cache} replaced, and win over its entries", () => {
    const { env } = windowsToolchains(
      { cacheDir: CACHE, serverEnv: {}, home: HOME, toolEnvironment: { COMPOSER_HOME: "${cache}/composer", CARGO_HOME: "${cache}/cargo-nightly", PLAIN: "on" } },
      fakeDisk({}),
    );
    assert.equal(env.COMPOSER_HOME, `${CACHE}/composer`);
    assert.equal(env.CARGO_HOME, `${CACHE}/cargo-nightly`, "replaces the table's entry");
    assert.equal(env.PLAIN, "on");
    assert.ok(env.GRADLE_USER_HOME?.startsWith(CACHE), "the rest of the table stays");
  });

  // openlore: scenario=CargoCredentialsStayOut spec=sandbox-runner-bash
  test("CargoCredentialsStayOut: no home that may hold credentials is read, and a home that would open the profile or the keys is refused", () => {
    const all = [`${HOME}\\.cargo`, `${HOME}\\.m2`, `${HOME}\\.gradle`, `${HOME}\\.rustup`];
    const { readable } = windowsToolchains({ cacheDir: CACHE, serverEnv: {}, home: HOME, agentDir: AGENT_DIR }, fakeDisk({ folders: all }));
    assert.deepEqual(readable, [`${HOME}\\.rustup`]);
    for (const rustupHome of [HOME, "C:\\", AGENT_DIR, `${AGENT_DIR}\\rustup`]) {
      const refused = windowsToolchains({ cacheDir: CACHE, serverEnv: { RUSTUP_HOME: rustupHome }, home: HOME, agentDir: AGENT_DIR }, fakeDisk({ folders: [rustupHome] }));
      assert.deepEqual(refused.readable, [], rustupHome);
      assert.equal(refused.env.RUSTUP_HOME, undefined, rustupHome);
    }
  });
});

describe("MSYS2 folders", () => {
  const gitUsr = String.raw`C:\Program Files\Git\usr\bin`;
  const msys64 = String.raw`C:\msys64\usr\bin`;
  const strawberry = String.raw`C:\Strawberry\perl\bin`;
  const system32 = String.raw`C:\Windows\System32`;
  const disk = fakeDisk({ files: { [String.raw`${gitUsr}\msys-2.0.dll`]: "", [String.raw`${msys64}\msys-2.0.dll`]: "" } });

  // openlore: scenario=OnWindowsPerlIsTheNativeOne spec=sandbox-runner-bash
  test("a search-path folder holding msys-2.0.dll is left out, the native folders kept in order", () => {
    const searchPath = [gitUsr, strawberry, system32].join(";");
    assert.deepEqual(msysFolders(searchPath, disk), [gitUsr]);
    assert.equal(withoutMsysFolders(searchPath, disk), [strawberry, system32].join(";"));
  });

  // openlore: scenario=AnMsysProgramNamedDirectlyIsExplained spec=sandbox-runner-bash
  test("an MSYS2 program named by its path is recognised, a native one is not, and the note says what to use", () => {
    assert.equal(msysProgramNamed(String.raw`& "${gitUsr}\perl.exe" -e 1`, gitUsr, disk), String.raw`${gitUsr}\perl.exe`);
    assert.equal(msysProgramNamed("C:/msys64/usr/bin/bash.exe -lc true", "", disk), String.raw`${msys64}\bash.exe`, "a folder holding msys-2.0.dll, on PATH or not");
    assert.equal(msysProgramNamed(String.raw`& ${strawberry}\perl.exe -e 1`, gitUsr, disk), undefined);
    assert.equal(msysProgramNamed("perl -e 1", gitUsr, disk), undefined, "a bare name finds no MSYS2 folder: they left the PATH");
    assert.match(msysNote(String.raw`${strawberry}\perl.exe`), /MSYS2 program.*none of them can start in this sandbox.*mxc#1061.*native program/);
  });
});
