import { closeSync, constants as fsConstants, fstatSync, ftruncateSync, openSync, readFileSync, writeFileSync, writeSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Do not put the web token or provider keys in the server's environment: under
// Landlock another process with this UID may still read /proc/<pid>/environ.
if (process.env.PI_OUTPOST_TOKEN) {
  throw new Error("Use the pi_outpost_token secret file, not PI_OUTPOST_TOKEN in the environment.");
}
const tokenFile = process.env.PI_OUTPOST_TOKEN_FILE ?? "/run/secrets/pi_outpost_token";
let token;
try {
  token = readFileSync(tokenFile, "utf8").trim();
} catch (error) {
  if (error.code === "EACCES") {
    throw new Error(`The pi_outpost_token secret is not readable by container UID ${process.getuid()}. Match APP_UID/APP_GID to the host file owner and rebuild.`);
  }
  throw new Error("Missing pi_outpost_token secret. Create server-token before starting Compose.");
}
if (token.length < 32 || /\s/.test(token)) {
  throw new Error("The pi_outpost_token secret must contain at least 32 characters without whitespace.");
}
const configFile = "/data/config.json";
const template = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
mkdirSync("/data/agent", { recursive: true, mode: 0o700 });

// The agent's network, the operator's choice; the adapter (landstrip.cjs) applies it:
//   unset (default) — ask: through the server's proxy alone, which asks the user about every host
//                     the configuration does not list (sandbox.allowedHosts: [] is added if missing);
//   1               — config: the generated policy unchanged (open without sandbox.allowedHosts);
//   0               — none: no IP networking at all, the proxy's port included.
const NETWORK_MODES = new Map([["", "ask"], ["1", "config"], ["0", "none"]]);
const network = NETWORK_MODES.get(process.env.OUTPOST_ALLOW_AGENT_NETWORK ?? "");
if (network === undefined) {
  throw new Error("OUTPOST_ALLOW_AGENT_NETWORK must be unset (the default: every host is asked about), 1 (the configuration decides) or 0 (no network).");
}
writeFileSync("/data/agent/docker-network.json", JSON.stringify({ network }), { mode: 0o600 });
const described = {
  ask: "through the server's proxy, unlisted hosts asked about (default)",
  config: "as the configuration says (operator opt-in)",
  none: "disabled (operator refusal)",
};
console.log(`[docker] Shell/terminal IP network: ${described[network]}`);

// Open or create the path in one operation, without a path-based existence
// check followed by another open. O_NOFOLLOW rejects a symlink at the final
// component; all later operations use this descriptor.
const configFd = openSync(
  configFile,
  fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW,
  0o600,
);

/** Replace the configuration's content through the descriptor opened above. */
function writeConfig(config) {
  const serialized = Buffer.from(JSON.stringify(config, null, 2) + "\n");
  ftruncateSync(configFd, 0);
  let offset = 0;
  while (offset < serialized.length) {
    const written = writeSync(configFd, serialized, offset, serialized.length - offset, offset);
    if (written === 0) throw new Error("Could not write /data/config.json");
    offset += written;
  }
}

let config;
// Added by this start rather than by the operator: given up if the installed pi-outpost cannot hold it.
let addedAllowedHosts = false;

/**
 * pi-outpost's report on the configuration, or undefined when it refused the `sandbox.allowedHosts`
 * this start added. Any other failure stops the start, as before.
 */
function doctor() {
  try {
    return execFileSync("pi-outpost", ["doctor", "--config", configFile], {
      encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (addedAllowedHosts && config.sandbox?.allowedHosts !== undefined && /"sandbox\.allowedHosts" needs/.test(output)) return undefined;
    process.stderr.write(output);
    throw error;
  }
}

let report;
try {
  const configStat = fstatSync(configFd);
  if (!configStat.isFile()) throw new Error("/data/config.json must be a regular file");
  config = configStat.size === 0 ? template : JSON.parse(readFileSync(configFd, "utf8"));
  config.server = { ...config.server, token };
  // A fresh volume, or one from before host questions: the default asks rather than staying closed.
  // Under 1 and 0 the operator's configuration is left as it is.
  if (network === "ask" && config.sandbox && typeof config.sandbox === "object" && config.sandbox.allowedHosts === undefined) {
    config.sandbox.allowedHosts = [];
    addedAllowedHosts = true;
  }
  writeConfig(config);

  execFileSync("/opt/landstrip/bin/landstrip", ["doctor"], { stdio: "inherit", timeout: 10_000 });
  report = doctor();
  if (report === undefined) {
    // A pi-outpost older than host questions under landstrip refuses the key: drop what this start
    // added. The default ceiling then keeps the network closed, as before — never open.
    delete config.sandbox.allowedHosts;
    writeConfig(config);
    console.log("[docker] This pi-outpost cannot hold the agent's network to sandbox.allowedHosts under landstrip: the network stays closed. Use a newer PI_OUTPOST_VERSION for host questions.");
    report = doctor();
  }
} finally {
  closeSync(configFd);
}
process.stdout.write(report);
// doctor permits warnings so the app can serve with a missing capability. This
// recipe promises both confined surfaces; require their actual canaries to pass.
for (const surface of ["shell sandbox", "terminal sandbox"]) {
  const line = report.split(/\r?\n/).find(line => line.startsWith(`[ok  ] ${surface}`));
  if (!line?.includes("confined by /opt/landstrip/bin/landstrip:")) {
    throw new Error(`Docker startup refused: ${surface} was not verified. Inspect doctor above; no unconfined fallback is enabled.`);
  }
}
