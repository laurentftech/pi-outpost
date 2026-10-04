/**
 * The one setting: the folder the plannings live in. The `.mcpb` bundle asks for it at
 * installation with a folder picker and passes it as `PLANNINGS_DIR`.
 */
import path from "node:path";

export const PLANNINGS_DIR = "PLANNINGS_DIR";

/** A configuration the server cannot start with; the message names the setting. */
export class ConfigError extends Error {}

export function planningsDirFrom(env: NodeJS.ProcessEnv): string {
  const value = env[PLANNINGS_DIR]?.trim();
  if (!value) {
    throw new ConfigError(`${PLANNINGS_DIR} is not set: give the folder the plannings are kept in, as an absolute path.`);
  }
  // A relative path would depend on the directory the host happens to start the server in.
  if (!path.isAbsolute(value)) {
    throw new ConfigError(`${PLANNINGS_DIR} must be an absolute path, not "${value}".`);
  }
  return path.resolve(value);
}
