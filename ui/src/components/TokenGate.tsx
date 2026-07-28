import { useState } from "react";

/**
 * Full-page gate shown when the server closes the WebSocket with the
 * unauthorized code: the stored token is missing or wrong. Normally users
 * never see this — opening the ?token=… URL once stores the credential.
 */
export function TokenGate({ title, onSubmit }: { title?: string; onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
        className="w-full max-w-sm rounded-xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800"
      >
        <div className="mb-1 text-center text-3xl">{title ?? "π"}</div>
        <h1 className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          This server requires an access token.
        </h1>
        <label htmlFor="pi-outpost-token" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Access token
        </label>
        <input
          id="pi-outpost-token"
          name="token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="paste the token…"
          className="mb-3 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="w-full rounded-md border border-emerald-300 px-2 py-1.5 text-sm text-emerald-700 hover:border-emerald-500 disabled:opacity-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:border-emerald-600"
        >
          Connect
        </button>
        <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-600">
          Ask the operator for the token, or open the link containing <code>?token=…</code>
        </p>
      </form>
    </div>
  );
}
