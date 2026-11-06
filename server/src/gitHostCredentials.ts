/**
 * HTTPS credentials pi-outpost keeps per Git host (git-host-credentials).
 *
 * Three jobs, kept together because they share one notion — the *host key*, the
 * `https://host[:port]` a credential belongs to:
 *
 * - naming the host of a repository address, and recognising from git's stderr that a
 *   failure was one of authentication (so the panel can ask instead of failing);
 * - the store, `<agentDir>/git-credentials`, written `0600` next to `auth.json`,
 *   where confined shells cannot read it (the agent directory is denied to them);
 * - offering that store to the git processes of Agent resources, read-only, after the
 *   deployment's own helpers (`gitCredentialHelperEnv`).
 *
 * The secret never leaves the server except to git, through git's own credential reader.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** The store's file, beside the provider credentials. */
export const GIT_CREDENTIALS_FILE = "git-credentials";

/** Names the store for the helper process git starts (see `gitCredentialHelperEnv`). */
export const GIT_CREDENTIALS_PATH_ENV = "PI_OUTPOST_GIT_CREDENTIALS";

export function gitCredentialsPath(agentDir: string): string {
  return path.join(agentDir, GIT_CREDENTIALS_FILE);
}

export class GitCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitCredentialError";
  }
}

/* ── Host keys ──────────────────────────────────────────────────────────────── */

/**
 * `https://host[:port]` for an HTTPS address or a bare `host[:port]`, lowercased, the
 * default port dropped — so `HTTPS://Git.Example.com:443/x.git` and `git.example.com`
 * are one host, and `:8447` is another. Undefined for anything that is not HTTPS: only
 * HTTPS credentials are kept.
 */
export function httpsHostKey(value: string): string | undefined {
  const text = value.trim();
  if (!text || /[\s\0]/.test(text)) return undefined;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) return undefined;
  return `https://${parsed.host.toLowerCase()}`;
}

/** The host part of a key, for display: `git.example.com:8447`. */
export function hostLabel(key: string): string {
  return key.replace(/^https:\/\//, "");
}

/** Scheme and host of a repository address, as far as authentication is concerned. */
export function addressHost(address: string): { scheme: "https" | "ssh"; host: string } | undefined {
  const text = address.trim();
  if (/^https:\/\//i.test(text)) {
    const key = httpsHostKey(text);
    return key ? { scheme: "https", host: key } : undefined;
  }
  if (/^ssh:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      return parsed.hostname ? { scheme: "ssh", host: parsed.host.toLowerCase() } : undefined;
    } catch {
      return undefined;
    }
  }
  // SCP-like `user@host:path`.
  const scp = /^[^\s@/:]+@([^\s:/]+):/.exec(text);
  if (scp) return { scheme: "ssh", host: scp[1].toLowerCase() };
  return undefined;
}

/** A user name and secret carried in an HTTPS address, if any. */
export function embeddedCredential(address: string): { host: string; username: string; secret: string } | undefined {
  if (!/^https:\/\//i.test(address.trim())) return undefined;
  try {
    const parsed = new URL(address.trim());
    if (!parsed.username || !parsed.password) return undefined;
    const host = httpsHostKey(address);
    if (!host) return undefined;
    return { host, username: decodeURIComponent(parsed.username), secret: decodeURIComponent(parsed.password) };
  } catch {
    return undefined;
  }
}

/* ── Recognising authentication failures ────────────────────────────────────── */

const HTTPS_AUTH = [
  /could not read (Username|Password) for/i,
  /Authentication failed for/i,
  /The requested URL returned error: 40[13]\b/i,
  /terminal prompts disabled/i,
  /HTTP Basic: Access denied/i,
  /Invalid username or (password|token)/i,
];

const SSH_AUTH = [/Permission denied \(publickey/i, /Host key verification failed/i];

/**
 * Whether git's stderr says the failure was authentication. The host comes from the
 * address the server already parsed, never from stderr: git's text is for reading, not
 * for deciding which credential to ask for.
 */
export function classifyGitAuthFailure(
  stderr: string | undefined,
  address: string | undefined,
): { scheme: "https" | "ssh"; host: string } | undefined {
  if (!stderr || !address) return undefined;
  const target = addressHost(address);
  if (!target) return undefined;
  const patterns = target.scheme === "https" ? HTTPS_AUTH : SSH_AUTH;
  return patterns.some((pattern) => pattern.test(stderr)) ? target : undefined;
}

/* ── The store ──────────────────────────────────────────────────────────────── */

/**
 * The store is in `git credential-store`'s own format — one `https://user:secret@host`
 * per line, user and secret percent-encoded — so git's built-in reader answers lookups
 * (see `gitCredentialHelperEnv`) and no pi-outpost process has to start for each one.
 */
type Store = Map<string, { username: string; secret: string }>;

function parseStore(text: string): Store {
  const store: Store = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = new URL(line.trim());
      const key = httpsHostKey(line.trim());
      if (!key || !parsed.username) continue;
      store.set(key, { username: decodeURIComponent(parsed.username), secret: decodeURIComponent(parsed.password) });
    } catch {
      // A line git would skip, skipped here too.
    }
  }
  return store;
}

function formatStore(store: Store): string {
  const lines = [...store.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { username, secret }]) => `https://${encodeURIComponent(username)}:${encodeURIComponent(secret)}@${hostLabel(key)}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

async function readStore(file: string): Promise<Store> {
  try {
    return parseStore(await fs.readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

/** Written beside the target and renamed over it: a crash leaves the old file, never half a new one. */
async function writeStore(file: string, store: Store): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, formatStore(store), { mode: 0o600 });
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  await fs.chmod(file, 0o600).catch(() => {});
}

/** One write at a time per store, so two quick saves cannot lose one another. */
const writes = new Map<string, Promise<unknown>>();
function serialised<T>(file: string, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(file) ?? Promise.resolve()).then(work, work);
  writes.set(file, next.catch(() => {}));
  return next;
}

/** Store (or replace) the credential for one HTTPS host. Returns the host key. */
export async function storeGitHostCredential(file: string, host: string, username: string, secret: string): Promise<string> {
  const key = httpsHostKey(host);
  if (!key) throw new GitCredentialError("Credentials are kept for HTTPS hosts only");
  if (!username.trim()) throw new GitCredentialError("A user name is required");
  if (!secret) throw new GitCredentialError("A password or token is required");
  if (/[\r\n\0]/.test(username) || /[\r\n\0]/.test(secret)) throw new GitCredentialError("The user name and secret cannot contain line breaks");
  return serialised(file, async () => {
    const store = await readStore(file);
    store.set(key, { username: username.trim(), secret });
    await writeStore(file, store);
    return key;
  });
}

/** Remove one host's credential. True when there was one. */
export function removeGitHostCredential(file: string, host: string): Promise<boolean> {
  const key = httpsHostKey(host);
  if (!key) return Promise.resolve(false);
  return serialised(file, async () => {
    const store = await readStore(file);
    if (!store.delete(key)) return false;
    await writeStore(file, store);
    return true;
  });
}

/** Hosts and user names — never the secret. An unreadable store lists nothing. */
export async function listGitHosts(file: string): Promise<{ host: string; username: string }[]> {
  try {
    const store = await readStore(file);
    return [...store.entries()].map(([host, { username }]) => ({ host, username })).sort((a, b) => a.host.localeCompare(b.host));
  } catch {
    return [];
  }
}

/* ── Offering the store to git ──────────────────────────────────────────────── */

/** A word for git's shell (`sh -c`): single-quoted, inner quotes closed and escaped. */
function shellWord(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Environment that makes one git process consult the store, after its own helpers.
 *
 * Through `GIT_CONFIG_COUNT`/`KEY`/`VALUE` rather than `-c`: nothing about the store,
 * not even its path, appears on a command line. The value is *added* to
 * `credential.helper` — git reads environment config after the user's files, so the
 * deployment's own helpers are asked first and this one last.
 *
 * The helper answers `get` through git's own `credential-store` and swallows `store` and
 * `erase`: git sends `store` to every helper after a success, and git's store helper would
 * then copy a credential the deployment supplied into this file. Reading stdin before
 * leaving keeps git from writing into a closed pipe.
 *
 * `git` is the executable this server runs, quoted: on a machine whose PATH lacks git (a
 * locked-down Windows box), a bare `git` inside the helper would not be found.
 */
export function gitCredentialHelperEnv(file: string, gitExecutable: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const index = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10);
  const at = Number.isInteger(index) && index >= 0 ? index : 0;
  const git = gitExecutable === "git" ? "git" : shellWord(gitExecutable.replace(/\\/g, "/"));
  const helper = `!f() { if [ "$1" = get ]; then ${git} credential-store --file="$${GIT_CREDENTIALS_PATH_ENV}" get; else cat >/dev/null; fi; }; f`;
  return {
    [GIT_CREDENTIALS_PATH_ENV]: file,
    GIT_CONFIG_COUNT: String(at + 1),
    [`GIT_CONFIG_KEY_${at}`]: "credential.helper",
    [`GIT_CONFIG_VALUE_${at}`]: helper,
  };
}
