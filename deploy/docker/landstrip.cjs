#!/usr/local/bin/node
// Deployment adapter for pi-outpost's generated single-file policy. This image
// leaves listener permission OFF unless the operator explicitly opts in. The
// control file is in the protected agent directory, outside the project and its
// grants. Docker publishes only the ports chosen by the operator. Preserve every
// filesystem/process restriction and any explicit binding refusal.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "run") {
  let operatorAllowsBinding = false;
  try {
    operatorAllowsBinding = JSON.parse(fs.readFileSync("/data/agent/docker-network.json", "utf8")).allowAppListeners === true;
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EACCES") throw error;
  }
  const policies = [];
  for (let i = 1; i < args.length && args[i] !== "--"; i++) {
    if ((args[i] === "-p" || args[i] === "--policy") && args[i + 1]) policies.push(++i);
  }
  if (policies.length === 1 && args[policies[0]] !== "-") {
    const source = args[policies[0]];
    const policy = JSON.parse(fs.readFileSync(source, "utf8"));
    if (operatorAllowsBinding && policy.network?.allowNetwork === true && policy.network.allowLocalBinding === undefined) {
      policy.network.allowLocalBinding = true;
      // Its parent's lifetime is managed by the app's existing policy cleanup.
      const dir = fs.mkdtempSync(path.join(path.dirname(source), "docker-binding-"));
      const target = path.join(dir, "policy.json");
      fs.writeFileSync(target, JSON.stringify(policy), { mode: 0o600 });
      args[policies[0]] = target;
    }
  }
}
const runner = "/opt/landstrip/runtime/usr/bin/landstrip";
process.execve(runner, [runner, ...args], process.env);
