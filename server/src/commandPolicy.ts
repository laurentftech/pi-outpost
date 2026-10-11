/**
 * Which slash commands the people using a deployment may see and run.
 *
 * An operator who installs an extension for what it does in the background may not want
 * its setup commands — reconfigure credentials, change a capture level — in every user's
 * palette. `blockedCommands` and `allowedCommands` decide that for the user's side only:
 * a refused command is left out of the list the composer autocompletes, and a prompt that
 * invokes it anyway is refused before anything runs. The extension itself stays loaded —
 * its hooks, its tools, its other commands carry on.
 *
 * Patterns are globs over the command's invocation name, without the slash: `*` for any
 * run of characters, `?` for one. A skill is `skill:<name>`. Matching ignores case, so
 * `/SETUP` cannot slip past `setup*`.
 */
import type { CommandInfo } from "@pi-outpost/shared";

export interface CommandPolicy {
  /** Never offered, never run. Wins over `allowed`. */
  blocked?: readonly string[];
  /** When set, only these registered commands are offered and run. */
  allowed?: readonly string[];
}

/** What the user is told, whatever the command: the name is not echoed back. */
export const COMMAND_NOT_AVAILABLE = "This command is not available.";

function globToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${source}$`, "i");
}

function matchesAny(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(name));
}

/** A pattern as written in the configuration, its leading slash forgiven. */
export function normalizeCommandPattern(pattern: string): string {
  return pattern.trim().replace(/^\/+/, "");
}

/** Whether the composer may offer this command. */
export function commandOffered(name: string, policy: CommandPolicy): boolean {
  if (policy.blocked && matchesAny(name, policy.blocked)) return false;
  if (policy.allowed && !matchesAny(name, policy.allowed)) return false;
  return true;
}

/** The commands the composer may offer, the others left out. */
export function offeredCommands(commands: readonly CommandInfo[], policy: CommandPolicy): CommandInfo[] {
  if (!policy.blocked && !policy.allowed) return [...commands];
  return commands.filter((command) => commandOffered(command.name, policy));
}

/** The command a prompt invokes — `/name args` gives `name` — or `undefined` for plain text. */
export function invokedCommand(text: string): string | undefined {
  const match = /^\/([^\s/]+)(?:\s|$)/.exec(text.trimStart());
  return match?.[1];
}

/**
 * Whether a prompt must be refused rather than run.
 *
 * A blocked pattern refuses the text whether or not such a command exists right now, so a
 * blocked name answers the same way registered or not. The allowlist refuses only a
 * command the runtime actually has: under it, a message that merely begins with a slash —
 * `/etc/hosts is wrong` — is still a message.
 */
export function refusesPrompt(text: string, policy: CommandPolicy, registered: readonly CommandInfo[]): boolean {
  const name = invokedCommand(text);
  if (name === undefined) return false;
  if (policy.blocked && matchesAny(name, policy.blocked)) return true;
  if (policy.allowed && !matchesAny(name, policy.allowed)) {
    const lower = name.toLowerCase();
    return registered.some((command) => command.name.toLowerCase() === lower);
  }
  return false;
}
