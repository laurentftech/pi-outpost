#!/usr/local/bin/node
// Deployment ceiling for the app's generated single-file policy, from the operator's choice
// (bootstrap.mjs writes it to /data/agent/docker-network.json):
//   ask (default) — IP networking and local binding denied; the server's proxy port, when the
//                   policy names one, stays open: the only way out, and it asks the user.
//   config        — the policy forwarded unchanged.
//   none          — IP networking, local binding and the proxy ports all removed.
// A missing or unreadable choice is "none". This adapter NEVER turns a denied permission on.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "run") {
  let network = "none";
  try {
    network = JSON.parse(fs.readFileSync("/data/agent/docker-network.json", "utf8")).network;
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EACCES") throw error;
  }
  if (!["ask", "config", "none"].includes(network)) network = "none";
  const policies = [];
  for (let i = 1; i < args.length && args[i] !== "--"; i++) {
    if ((args[i] === "-p" || args[i] === "--policy") && args[i + 1]) policies.push(++i);
  }
  if (network !== "config" && policies.length === 1 && args[policies[0]] !== "-") {
    const source = args[policies[0]];
    const policy = JSON.parse(fs.readFileSync(source, "utf8"));
    if (policy.network === undefined) policy.network = {};
    if (!policy.network || typeof policy.network !== "object" || Array.isArray(policy.network)) {
      throw new Error("The generated network policy must be an object.");
    }
    policy.network.allowNetwork = false;
    policy.network.allowLocalBinding = false;
    if (network === "none") {
      delete policy.network.httpProxyPort;
      delete policy.network.socksProxyPort;
    }
    const dir = fs.mkdtempSync(path.join(path.dirname(source), "docker-network-"));
    const target = path.join(dir, "policy.json");
    fs.writeFileSync(target, JSON.stringify(policy), { mode: 0o600 });
    args[policies[0]] = target;
  }
}
const runner = "/opt/landstrip/runtime/usr/bin/landstrip";
process.execve(runner, [runner, ...args], process.env);
