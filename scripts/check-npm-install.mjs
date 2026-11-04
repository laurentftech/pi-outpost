/** Exercise the built CLI as a consumer: fresh global + npx installs, real PTY, blocked canary. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
assert.ok(npm, "Run with npm run test:npm-install");
const version = JSON.parse(await readFile(path.join(repo, "cli/package.json"), "utf8")).version;
const root = await mkdtemp(path.join(tmpdir(), "pi-npm12-install-"));
const policy = "--allow-scripts=node-pty,koffi";
// Consumer policy is independent of the checkout and the contributor's npm configuration.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")));
env.npm_config_userconfig = path.join(root, "npmrc");
env.npm_config_globalconfig = path.join(root, "global-npmrc");
env.npm_config_cache = path.join(root, "pack-cache");
await writeFile(env.npm_config_userconfig, "registry=https://registry.npmjs.org/\n");
await writeFile(env.npm_config_globalconfig, "");
function run(args, cwd = root, extra = {}) {
  const installing = args[0] === "install" || args[0] === "exec";
  const started = Date.now();
  const label = args.slice(0, 2).join(" ");
  console.log(`[npm-install] ${label}: starting`);
  try {
    return execFileSync(process.execPath, [npm, "--timing", ...args], {
      cwd, env: { ...env, ...extra }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      // Cold dependency extraction takes several minutes on Windows. Both probes
      // retain 60 s startup / 20 s terminal deadlines; the global probe also has
      // a separate 120 s outer limit.
      timeout: installing ? 600_000 : 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    });
  } finally {
    console.log(`[npm-install] ${label}: finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
}
try {
  assert.match(run(["--version"]).trim(), /^12\./, "Installation checks must run under npm 12");
  const packed = JSON.parse(run(["pack", "--workspace", "cli", "--ignore-scripts", "--json", "--pack-destination", root], repo));
  const tarball = path.join(root, (Array.isArray(packed) ? packed[0] : Object.values(packed)[0]).filename);
  // A second package proves that approving the PTY does not approve arbitrary lifecycle code.
  const canary = path.join(root, "canary");
  await mkdir(canary);
  await writeFile(path.join(canary, "package.json"), JSON.stringify({ name: "pi-install-canary", version: "1.0.0", scripts: { postinstall: "node install.cjs" } }));
  await writeFile(path.join(canary, "install.cjs"), "require('node:fs').writeFileSync(process.env.PI_CANARY_MARKER, 'executed')");
  const canaryPack = JSON.parse(run(["pack", "--ignore-scripts", "--json", "--pack-destination", root], canary));
  const canaryTarball = path.join(root, (Array.isArray(canaryPack) ? canaryPack[0] : Object.values(canaryPack)[0]).filename);
  // openlore: scenario=UnreviewedRepositoryScriptsFailClosed spec=npm-install-security
  const project = path.join(root, "strict-project");
  await mkdir(project);
  const manifest = { name: "strict-install-test", private: true };
  const strictMarker = path.join(root, "strict-canary-ran");
  await writeFile(path.join(project, "package.json"), JSON.stringify(manifest));
  await writeFile(path.join(project, ".npmrc"), "strict-allow-scripts=true\n");
  assert.throws(() => run(["install", "--json", "--no-audit", "--no-fund", canaryTarball], project, { PI_CANARY_MARKER: strictMarker }), error => {
    assert.equal(JSON.parse(error.stdout).error.code, "ESTRICTALLOWSCRIPTS");
    return true;
  });
  await assert.rejects(access(strictMarker), { code: "ENOENT" });
  console.log("strict policy rejects unknown lifecycle code before execution");
  const probe = path.join(repo, "scripts/npm-install-probe.cjs");
  for (const mode of ["global", "npx"]) {
    const cache = path.join(root, `${mode}-cache`);
    const marker = path.join(root, `${mode}-canary-ran`);
    const extra = { npm_config_cache: cache, npm_config_devdir: path.join(root, "node-gyp"), PI_CANARY_MARKER: marker, PI_EXPECTED_VERSION: version, PI_EXPECTED_INSTALL_ROOT: cache };
    // openlore: scenario=ConsumerInstallsKeepTheirTerminal spec=npm-install-security
    // openlore: scenario=UnapprovedDependencyScriptsStayBlocked spec=npm-install-security
    if (mode === "global") {
      const prefix = path.join(root, "prefix");
      run(["install", "--global", "--prefix", prefix, policy, "--no-audit", "--no-fund", tarball, canaryTarball], root, extra);
      const home = path.join(prefix, process.platform === "win32" ? "node_modules" : "lib/node_modules", "pi-outpost");
      execFileSync(process.execPath, [probe], { cwd: root, env: { ...env, ...extra, PI_INSTALLED_PACKAGE: home, PI_EXPECTED_INSTALL_ROOT: prefix }, stdio: "inherit", timeout: 120_000 });
    } else {
      run(["exec", "--yes", policy, "--package", tarball, "--package", canaryTarball, "--", "node", probe], root, extra);
    }
    await assert.rejects(access(marker), { code: "ENOENT" }, `${mode}: the unapproved script must not execute`);
    console.log(`${mode}: fresh cache, CLI version, real PTY and denied canary passed`);
    // Each mode starts fresh; release its installed tree before downloading the next.
    await rm(cache, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    if (mode === "global") await rm(path.join(root, "prefix"), { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
