import { useState } from "react";
import type { GitAuthFailure, GitHostEntry } from "@pi-outpost/shared";
import type { GitHostCredentialState } from "../useAgent";

/** Where the deployment-side alternatives are explained: SSH keys, credential helpers. */
export const GIT_CREDENTIALS_DOCS = "https://github.com/laurentftech/pi-outpost/blob/main/docs/configuration.md#git-credentials-for-agent-resources";

const hostLabel = (host: string) => host.replace(/^https:\/\//, "");

/**
 * A Git host refused a clone or a refresh for want of credentials: ask for them instead
 * of stopping on an error (git-host-credentials).
 *
 * HTTPS only — pi-outpost keeps no SSH keys, so an SSH refusal points to the documentation.
 * Under `credentialsLock` nothing can be stored from here, and the prompt says so rather than
 * offering fields that would be refused. `refused` is set by the caller when the credential
 * just submitted came back refused by the host: the prompt stays, says it, and keeps the
 * user name so only the secret needs retyping.
 */
export function GitHostCredentialPrompt({
  auth,
  locked,
  state,
  refused,
  initialUsername = "",
  onSubmit,
}: {
  auth: GitAuthFailure;
  locked: boolean;
  state: GitHostCredentialState | null;
  refused: boolean;
  /** The user name last submitted for this host: a retry unmounts the prompt, the name should not go with it. */
  initialUsername?: string;
  onSubmit: (username: string, secret: string) => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [secret, setSecret] = useState("");
  const host = hostLabel(auth.host);

  if (auth.scheme === "ssh") {
    return (
      <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">{host} refused SSH authentication</p>
        <p className="mt-1">pi-outpost does not keep SSH keys. Give the server a key or an agent for this host, or use the repository's HTTPS address. <a href={GIT_CREDENTIALS_DOCS} target="_blank" rel="noreferrer" className="underline">How to configure Git credentials</a></p>
      </div>
    );
  }

  if (locked) {
    return (
      <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">{host} requires authentication</p>
        <p className="mt-1">Credentials are locked on this server: ask whoever runs it to configure them. <a href={GIT_CREDENTIALS_DOCS} target="_blank" rel="noreferrer" className="underline">How to configure Git credentials</a></p>
      </div>
    );
  }

  const saving = state?.status === "saving";
  const failure = state?.status === "error" ? state.message : refused ? `${host} refused this user name or secret. Check them and try again.` : undefined;
  return (
    <form
      aria-label={`Credentials for ${host}`}
      className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
      onSubmit={(event) => {
        event.preventDefault();
        if (saving || !username.trim() || !secret) return;
        onSubmit(username.trim(), secret);
        setSecret("");
      }}
    >
      <div>
        <p className="font-medium">{host} requires authentication</p>
        <p className="mt-1 text-sky-900/80 dark:text-sky-100/70">Enter a user name and a password or access token for this host. They are kept on the server, used for every repository on {host}, and never shown again.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className="font-medium">User name</span><input aria-label="Git user name" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100" /></label>
        <label className="block"><span className="font-medium">Password or token</span><input aria-label="Git password or token" type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} className="mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100" /></label>
      </div>
      {failure ? <p role="alert" className="text-red-700 dark:text-red-400">{failure}</p> : null}
      <button type="submit" disabled={saving || !username.trim() || !secret} className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{saving ? "Saving…" : "Save and retry"}</button>
    </form>
  );
}

/**
 * Settings → Accounts: the Git hosts with a stored credential, user name shown, secret
 * never. Removing one is the only action; under `credentialsLock` there is none.
 */
export function GitHostList({
  hosts,
  locked,
  removing,
  onRemove,
}: {
  hosts: GitHostEntry[];
  locked: boolean;
  removing: GitHostCredentialState | null;
  onRemove?: (host: string) => string;
}) {
  const [pending, setPending] = useState<{ host: string; requestId: string } | null>(null);
  const failed = pending && removing?.requestId === pending.requestId && removing.status === "error" ? removing.message : undefined;
  const busy = pending !== null && removing?.requestId === pending.requestId && removing.status === "saving";
  return (
    <section className="mt-3" aria-label="Git hosts">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Git hosts</h4>
      {hosts.length === 0 ? (
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">No Git host credential stored. Agent resources asks for one when a repository needs it.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {hosts.map((entry) => (
            <li key={entry.host} className="flex items-center justify-between gap-2 rounded border border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
              <span className="min-w-0 truncate text-xs"><span className="font-medium text-zinc-800 dark:text-zinc-200">{hostLabel(entry.host)}</span><span className="ml-2 text-[11px] text-zinc-500 dark:text-zinc-400">{entry.username}</span></span>
              {!locked && onRemove ? (
                <button
                  type="button"
                  disabled={busy && pending?.host === entry.host}
                  aria-label={`Remove the credential for ${hostLabel(entry.host)}`}
                  className="shrink-0 rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                  onClick={() => setPending({ host: entry.host, requestId: onRemove(entry.host) })}
                >
                  {busy && pending?.host === entry.host ? "Removing…" : "Remove"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {failed ? <p role="alert" className="mt-1 text-[11px] text-red-600">{failed}</p> : null}
    </section>
  );
}
