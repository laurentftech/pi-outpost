/**
 * Where the planning server's settings come from: the environment, and nothing else.
 *
 * The server runs next to an Open WebUI that is configured through environment
 * variables, so it is configured the same way. Every setting that guards something
 * has no default: a server that starts without its secret, or in signed mode
 * without the key to check signatures, would accept requests it cannot vouch for.
 * It refuses to start instead, and says which setting is missing.
 */
import path from "node:path";

export type IdentityMode = "signed" | "plain";

export interface PlanningServerConfig {
  host: string;
  port: number;
  /** The tool server connection's bearer key in Open WebUI. */
  secret: string;
  identity: IdentityMode;
  /** `FORWARD_USER_INFO_HEADER_JWT_SECRET` in Open WebUI; required in signed mode. */
  identityKey: string | undefined;
  dataDir: string;
  /** Largest planning document accepted, in bytes of its JSON. */
  maxPlanningBytes: number;
  /** Most revisions kept for one planning; an update past it is refused. */
  maxRevisions: number;
  /** Most plannings one user may own. */
  maxPlanningsPerUser: number;
}

export class ConfigError extends Error {}

export const ENV = {
  host: "OWUI_PLANNING_HOST",
  port: "OWUI_PLANNING_PORT",
  secret: "OWUI_PLANNING_SECRET",
  identity: "OWUI_PLANNING_IDENTITY",
  identityKey: "OWUI_PLANNING_IDENTITY_KEY",
  dataDir: "OWUI_PLANNING_DATA_DIR",
  maxPlanningBytes: "OWUI_PLANNING_MAX_BYTES",
  maxRevisions: "OWUI_PLANNING_MAX_REVISIONS",
  maxPlanningsPerUser: "OWUI_PLANNING_MAX_PLANNINGS",
} as const;

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${name} must be a positive integer, not "${raw}"`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): PlanningServerConfig {
  const secret = env[ENV.secret]?.trim();
  if (!secret) throw new ConfigError(`${ENV.secret} is not set: the server will not accept requests it cannot tell came from Open WebUI`);

  const identityRaw = (env[ENV.identity]?.trim() || "signed").toLowerCase();
  if (identityRaw !== "signed" && identityRaw !== "plain") {
    throw new ConfigError(`${ENV.identity} must be "signed" or "plain", not "${identityRaw}"`);
  }
  const identity: IdentityMode = identityRaw;
  const identityKey = env[ENV.identityKey]?.trim() || undefined;
  if (identity === "signed" && !identityKey) {
    throw new ConfigError(
      `${ENV.identityKey} is not set: signed identity needs the key Open WebUI signs with (its FORWARD_USER_INFO_HEADER_JWT_SECRET)`,
    );
  }

  const port = positiveInteger(env, ENV.port, 8790);
  if (port > 65535) throw new ConfigError(`${ENV.port} must be a port number, not ${port}`);

  return {
    host: env[ENV.host]?.trim() || "127.0.0.1",
    port,
    secret,
    identity,
    identityKey,
    dataDir: path.resolve(cwd, env[ENV.dataDir]?.trim() || "planning-data"),
    maxPlanningBytes: positiveInteger(env, ENV.maxPlanningBytes, 1_000_000),
    maxRevisions: positiveInteger(env, ENV.maxRevisions, 500),
    maxPlanningsPerUser: positiveInteger(env, ENV.maxPlanningsPerUser, 200),
  };
}
