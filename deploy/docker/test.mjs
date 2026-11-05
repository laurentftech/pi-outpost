// Run after building the image: node deploy/docker/test.mjs.
// Exercises the installed app and its real PTY/runner, not a simulated policy.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, cp, rm, chown } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "pi-docker-python-"));
const recipe = new URL("./", import.meta.url);
const project = `pi-python-test-${process.pid}`;
const image = process.env.PI_OUTPOST_TEST_IMAGE ?? "pi-outpost-python:0.59.1";
const host = process.env.PI_OUTPOST_TEST_DOCKER_HOST;
const dockerArgs = host ? ["--host", host] : [];
function docker(args, options = {}) {
  return execFileSync("docker", [...dockerArgs, ...args], {
    encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024, ...options,
  });
}
// CI tests the distributable image's default UID 1000, even on a UID 1001 runner.
// Only this harness runs as root there; every app container stays non-root.
// openlore: scenario=ValidatesTheDistributableImage spec=docker-python-deployment
const [imageUid, imageGid] = docker(["run", "--rm", "--entrypoint", "node", image,
  "-p", "process.getuid()+':'+process.getgid()"] ).trim().split(":").map(Number);
assert.ok(imageUid > 0 && imageGid > 0, "The image must run as a non-root UID/GID");
if (process.getuid() === 0) {
  assert.equal(`${imageUid}:${imageGid}`, "1000:1000", "CI must test the distributable image's default identity");
}
console.log(`Testing app image UID/GID ${imageUid}:${imageGid}`);
async function ownedByApp(file) {
  if (process.getuid() === 0) await chown(file, imageUid, imageGid);
  else assert.equal(process.getuid(), imageUid, "Build with APP_UID matching your UID, or run the test harness with sudo");
}
const composeArgs = ["compose", "--project-name", project, "--project-directory", root,
  "--file", path.join(root, "compose.yml"), "--file", path.join(root, "test.yml")];
const compose = args => docker([...composeArgs, ...args]);
const token = randomBytes(32).toString("hex");
const workspace = path.join(root, "workspace");
await mkdir(workspace);
await ownedByApp(workspace);
await copyFile(new URL("compose.yml", recipe), path.join(root, "compose.yml"));
await cp(new URL("profiles/", recipe), path.join(root, "profiles"), { recursive: true });
await writeFile(path.join(root, ".env"), `PROJECT_DIR=${workspace}\nPI_OUTPOST_PORT=0\n`);
await writeFile(path.join(root, "server-token"), token, { mode: 0o600 });
await ownedByApp(path.join(root, "server-token"));
await writeFile(path.join(root, "test.yml"), JSON.stringify({ services: { "pi-outpost": {
  image, restart: "no", environment: { PI_OFFLINE: "1", OUTPOST_ALLOW_AGENT_NETWORK: "0" },
  ports: ["127.0.0.1:0:8000"],
} } }));
let socket;
let base;
let container;
async function ready() {
  container = compose(["ps", "--all", "-q", "pi-outpost"]).trim();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const info = JSON.parse(docker(["inspect", container]))[0];
    if (info.State.Status === "exited") {
      throw new Error(`App exited during startup:\n${compose(["logs", "--no-color"])}`);
    }
    const port = info.NetworkSettings.Ports["3141/tcp"]?.[0]?.HostPort;
    if (port) {
      base = `http://127.0.0.1:${port}`;
      try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`App did not become healthy:\n${compose(["logs", "--no-color"])}`);
}
async function terminal() {
  socket = new WebSocket(`${base.replace("http", "ws")}/ws?token=${token}`);
  let output = "";
  let failure;
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.type === "hello") socket.send(JSON.stringify({ type: "terminal_open", terminalId: "docker-probe", cols: 160, rows: 30 }));
    if (message.type === "terminal_data") output += message.data;
    if (message.type === "terminal_error") failure = message.message ?? JSON.stringify(message);
  });
  socket.addEventListener("error", () => { failure = "WebSocket failed"; });
  const waitFor = async marker => {
    const deadline = Date.now() + 45_000;
    while (!output.includes(marker)) {
      if (failure) throw new Error(failure);
      if (Date.now() > deadline) throw new Error(`Terminal did not print ${marker}: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  // Wait for a real PTY prompt before sending input; no tool/model call is faked.
  const deadline = Date.now() + 30_000;
  while (!output) {
    if (failure) throw new Error(failure);
    if (Date.now() > deadline) throw new Error("No PTY output");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return {
    send: data => socket.send(JSON.stringify({ type: "terminal_input", terminalId: "docker-probe", data })),
    waitFor,
  };
}
try {
  // openlore: scenario=KeepsTheDockerDaemonOutsideTheApp spec=docker-python-deployment
  const resolved = JSON.parse(compose(["config", "--format", "json"]));
  const service = resolved.services["pi-outpost"];
  assert.notEqual(service.privileged, true);
  assert.ok(service.cap_drop.includes("ALL"));
  assert.ok(service.security_opt.some(option => option.startsWith("no-new-privileges")));
  assert.ok(service.ports.every(port => port.host_ip === "127.0.0.1"));
  assert.ok(!service.volumes.some(volume => /docker\.sock/.test(volume.source ?? "")));
  // Seed a fake credential in the same named volume the real app will use.
  compose(["run", "--rm", "--no-deps", "--entrypoint", "node", "pi-outpost", "-e",
    "const fs=require('node:fs');fs.mkdirSync('/data/agent',{recursive:true});fs.writeFileSync('/data/agent/auth.json',JSON.stringify({anthropic:{type:'api_key',key:'docker-test-not-a-real-key'}}));fs.writeFileSync('/data/private-canary','outside');"]);
  compose(["up", "--detach", "--no-build"]);
  await ready();
  const inspected = JSON.parse(docker(["inspect", container]))[0];
  assert.equal(inspected.Config.User, "node");
  assert.equal(inspected.HostConfig.Privileged, false);
  assert.ok(!inspected.HostConfig.SecurityOpt.includes("seccomp=unconfined"));
  assert.ok(!inspected.Config.Env.some(value => /^PI_OUTPOST_TOKEN=/.test(value)));
  console.log("KeepsTheDockerDaemonOutsideTheApp passed");
  // openlore: scenario=UsesPinnedNpmWithNativeBindings spec=docker-python-deployment
  assert.equal(docker(["exec", container, "npm", "--version"]).trim(), "12.2.1");
  assert.equal(docker(["exec", container, "pi-outpost", "--version"]).trim(), process.env.PI_OUTPOST_TEST_VERSION ?? "0.59.1");
  const logs = compose(["logs", "--no-color"]);
  assert.match(logs, /\[ok  \] shell sandbox\s+confined by/);
  assert.match(logs, /\[ok  \] terminal sandbox\s+confined by/);
  assert.ok(!logs.includes(token), "The web token must not be logged");
  console.log("UsesPinnedNpmWithNativeBindings passed (real PTY below)");
  // openlore: scenario=RunsPythonInTheConfinedTerminal spec=docker-python-deployment
  // openlore: scenario=ProtectsCredentialsAndConfiguration spec=docker-python-deployment
  await writeFile(path.join(workspace, "probe.py"), `from pathlib import Path
for name in ['/data/agent/auth.json', '/data/agent/docker-network.json', '/data/config.json', '/data/private-canary', '/run/secrets/pi_outpost_token']:
    try:
        Path(name).read_text()
    except (PermissionError, FileNotFoundError):
        pass
    else:
        raise AssertionError('outside read: ' + name)
try:
    Path('/data/forbidden-write').write_text('escaped')
except (PermissionError, FileNotFoundError):
    pass
else:
    raise AssertionError('outside write')
Path('python-proof.txt').write_text('persisted')
print('DOCKER_' + 'PYTHON_OK', flush=True)
`);
  await ownedByApp(path.join(workspace, "probe.py"));
  const pty = await terminal();
  pty.send("python3 -m venv .venv && .venv/bin/python probe.py\r");
  await pty.waitFor("DOCKER_PYTHON_OK");
  assert.equal(await readFile(path.join(workspace, "python-proof.txt"), "utf8"), "persisted");
  assert.equal(docker(["exec", container, "cat", "/data/private-canary"]).trim(), "outside");
  async function networkMustBeRefused(network) {
    await writeFile(path.join(workspace, "deny-binding.json"), JSON.stringify({ network }));
    await ownedByApp(path.join(workspace, "deny-binding.json"));
    for (const probe of [
      { marker: "BIND_ATTEMPT", call: "s.bind(('127.0.0.1',8001))" },
      { marker: "CONNECT_ATTEMPT", call: "s.connect(('127.0.0.1',3141))" },
    ]) {
      let refusal;
      try {
        docker(["exec", container, "/opt/landstrip/bin/landstrip", "run", "-p", "/workspace/deny-binding.json", "--",
          "python3", "-c", `import socket; s=socket.socket(); print('${probe.marker}',flush=True); ${probe.call}`]);
      } catch (error) { refusal = error; }
      assert.ok(refusal?.status > 0, "A forbidden IP operation must not be enabled by the adapter");
      assert.ok(refusal.stdout.includes(probe.marker), "Python must reach the actual socket operation");
      assert.match(`${refusal.stderr ?? ""}`, /PermissionError/);
    }
  }
  // openlore: scenario=AgentNetworkNeedsOperatorOptIn spec=docker-python-deployment
  assert.equal(JSON.parse(docker(["exec", container, "cat", "/data/agent/docker-network.json"])).allowAgentNetwork, false);
  await networkMustBeRefused({ allowNetwork: true });
  console.log("AgentNetworkNeedsOperatorOptIn passed (bind and connect refused by default)");
  pty.send("python3 -c \"import time; print('WAIT_'+'READY', flush=True); time.sleep(60)\"\r");
  await pty.waitFor("WAIT_READY");
  pty.send("\x03");
  pty.send("printf 'INTERRUPT_%s\\n' OK\r");
  await pty.waitFor("INTERRUPT_OK");
  socket.close();
  console.log("RunsPythonInTheConfinedTerminal passed (venv, Python, Ctrl+C)");
  console.log("ProtectsCredentialsAndConfiguration passed (five outside reads and one write refused)");
  const { checkBrowser } = await import("./browser.mjs");
  await checkBrowser({ base, token, workspace });
  // openlore: scenario=PersistsProjectsAndAgentState spec=docker-python-deployment
  docker(["exec", container, "node", "-e", "const fs=require('node:fs');const p='/data/config.json';const c=JSON.parse(fs.readFileSync(p));c.branding={title:'Docker persistence proof'};fs.writeFileSync(p,JSON.stringify(c));"]);
  compose(["up", "--detach", "--no-build", "--force-recreate"]);
  await ready();
  const persisted = JSON.parse(docker(["exec", container, "cat", "/data/config.json"]));
  assert.equal(persisted.branding.title, "Docker persistence proof");
  assert.equal(JSON.parse(docker(["exec", container, "cat", "/data/agent/auth.json"])).anthropic.key, "docker-test-not-a-real-key");
  assert.equal(await readFile(path.join(workspace, "python-proof.txt"), "utf8"), "persisted");
  console.log("PersistsProjectsAndAgentState passed (container recreation)");
  // Isolated test-only operator opt-in. The shipped Compose default stays OFF.
  // No real credentials or public/LAN ports are used in this temporary project.
  await writeFile(path.join(root, "test.yml"), JSON.stringify({ services: { "pi-outpost": {
    image, restart: "no", environment: { PI_OFFLINE: "1", OUTPOST_ALLOW_AGENT_NETWORK: "1" },
    ports: ["127.0.0.1:0:8000"],
  } } }));
  compose(["up", "--detach", "--no-build", "--force-recreate"]);
  await ready();
  assert.equal(JSON.parse(docker(["exec", container, "cat", "/data/agent/docker-network.json"])).allowAgentNetwork, true);
  // openlore: scenario=HonorsAnExplicitNetworkRefusal spec=docker-python-deployment
  await networkMustBeRefused({ allowNetwork: false, allowLocalBinding: false });
  console.log("HonorsAnExplicitNetworkRefusal passed (opt-in never widens caller policy)");
  const appPty = await terminal();
  appPty.send(".venv/bin/python probe.py\r");
  await appPty.waitFor("DOCKER_PYTHON_OK");
  appPty.send("python3 -m http.server 8000 --bind 0.0.0.0\r");
  await appPty.waitFor("Serving HTTP on");
  const appPort = JSON.parse(docker(["inspect", container]))[0].NetworkSettings.Ports["8000/tcp"][0].HostPort;
  const served = await fetch(`http://127.0.0.1:${appPort}/python-proof.txt`, { signal: AbortSignal.timeout(5000) });
  assert.equal(served.status, 200);
  assert.equal(await served.text(), "persisted");
  appPty.send("\x03");
  socket.close();
  console.log("Opted-in Python HTTP app passed, with filesystem confinement rechecked");
  compose(["down"]);
  // openlore: scenario=RefusesMissingCredentialsOrUnverifiedConfinement spec=docker-python-deployment
  const data = path.join(root, "negative-data");
  await mkdir(data);
  await ownedByApp(data);
  const template = JSON.parse(await readFile(new URL("config.json", recipe), "utf8"));
  template.sandbox.bashRunner = "/missing-runner";
  await writeFile(path.join(data, "config.json"), JSON.stringify(template));
  await ownedByApp(path.join(data, "config.json"));
  for (const missingSecret of [true, false]) {
    const args = ["run", "--rm", "--init", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--security-opt", `seccomp=${path.join(root, "profiles/seccomp-landstrip.json")}`,
      "--security-opt", `apparmor=${process.env.LANDSTRIP_APPARMOR_PROFILE ?? "unconfined"}`,
      "--security-opt", "systempaths=unconfined", "-e", "PI_OFFLINE=1",
      "--mount", `type=bind,src=${workspace},dst=/workspace`, "--mount", `type=bind,src=${data},dst=/data`];
    if (!missingSecret) args.push("--mount", `type=bind,src=${path.join(root, "server-token")},dst=/run/secrets/pi_outpost_token,readonly`);
    let failed;
    try { docker([...args, image]); } catch (error) { failed = error; }
    assert.ok(failed?.status > 0, "The app must refuse startup");
    const output = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
    assert.match(output, missingSecret ? /Missing pi_outpost_token secret/ : /shell sandbox was not verified/);
    assert.ok(!output.includes(token));
  }
  console.log("RefusesMissingCredentialsOrUnverifiedConfinement passed");
  console.log("ValidatesTheDistributableImage passed (CLI version, non-root image and all real-app checks)");
  console.log("Docker recipe and running-app browser checks passed.");
} finally {
  socket?.close();
  try { compose(["down", "--volumes", "--remove-orphans"]); } catch {}
  await rm(root, { recursive: true, force: true });
}
