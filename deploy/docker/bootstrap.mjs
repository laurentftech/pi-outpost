import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
} catch {
  throw new Error("Missing pi_outpost_token secret. Create server-token before starting Compose.");
}
if (token.length < 32 || /\s/.test(token)) {
  throw new Error("The pi_outpost_token secret must contain at least 32 characters without whitespace.");
}
const configFile = "/data/config.json";
const template = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
mkdirSync("/data/agent", { recursive: true, mode: 0o700 });
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : template;
config.server = { ...config.server, token };
writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

execFileSync("/opt/landstrip/bin/landstrip", ["doctor"], { stdio: "inherit", timeout: 10_000 });
const report = execFileSync("pi-outpost", ["doctor", "--config", configFile], {
  encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
});
process.stdout.write(report);
// doctor permits warnings so the app can serve with a missing capability. This
// recipe promises both confined surfaces; require their actual canaries to pass.
for (const surface of ["shell sandbox", "terminal sandbox"]) {
  const line = report.split(/\r?\n/).find(line => line.startsWith(`[ok  ] ${surface}`));
  if (!line?.includes("confined by /opt/landstrip/bin/landstrip:")) {
    throw new Error(`Docker startup refused: ${surface} was not verified. Inspect doctor above; no unconfined fallback is enabled.`);
  }
}
