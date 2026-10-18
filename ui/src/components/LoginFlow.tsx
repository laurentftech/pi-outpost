import { useState } from "react";
import type { LoginEvent, LoginPrompt } from "@pi-outpost/shared";
import type { LoginFlowState } from "../useAgent";

/**
 * A provider sign-in as the server runs it: what the flow shows (a link to open, a device code to
 * enter, progress) and what it asks (a text, a secret, a choice, a code to paste back). The flow is
 * the SDK's; this only draws its steps and sends the answers.
 */
const field =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600";
const button =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

function Step({ event }: { event: LoginEvent }) {
  switch (event.type) {
    case "auth_url":
      return (
        <div data-testid="login-auth-url" className="space-y-1">
          <p className="text-sm text-zinc-700 dark:text-zinc-200">{event.instructions ?? "Open this page to sign in:"}</p>
          <div className="flex items-center gap-2">
            <a href={event.url} target="_blank" rel="noopener noreferrer" className="truncate text-sm text-sky-700 underline dark:text-sky-400">
              {event.url}
            </a>
            <button type="button" className={button} onClick={() => void navigator.clipboard?.writeText(event.url)}>
              Copy
            </button>
          </div>
        </div>
      );
    case "device_code":
      return (
        <div data-testid="login-device-code" className="space-y-1">
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            Enter this code at{" "}
            <a href={event.verificationUri} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline dark:text-sky-400">
              {event.verificationUri}
            </a>
            :
          </p>
          <p className="select-all font-mono text-2xl tracking-widest text-zinc-900 dark:text-zinc-50">{event.userCode}</p>
        </div>
      );
    case "info":
      return (
        <p className="text-sm text-zinc-700 dark:text-zinc-200">
          {event.message}
          {event.links?.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-sky-700 underline dark:text-sky-400">
              {link.label ?? link.url}
            </a>
          ))}
        </p>
      );
    case "progress":
      return <p className="text-xs text-zinc-500 dark:text-zinc-400">{event.message}</p>;
  }
}

function Question({ prompt, onAnswer }: { prompt: LoginPrompt; onAnswer: (value: string) => void }) {
  const [value, setValue] = useState("");
  if (prompt.type === "select") {
    return (
      <div data-testid="login-prompt" className="space-y-2">
        <p className="text-sm text-zinc-700 dark:text-zinc-200">{prompt.message}</p>
        <div className="flex flex-wrap gap-2">
          {prompt.options.map((option) => (
            <button key={option.id} type="button" className={button} title={option.description} onClick={() => onAnswer(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <form
      data-testid="login-prompt"
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onAnswer(value.trim());
      }}
    >
      <label className="block text-sm text-zinc-700 dark:text-zinc-200">
        {prompt.type === "manual_code" ? `${prompt.message} — or the whole address the browser was sent to` : prompt.message}
        <input
          className={`${field} mt-1`}
          type={prompt.type === "secret" ? "password" : "text"}
          placeholder={prompt.placeholder}
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button type="submit" className={button} disabled={!value.trim()}>
        Continue
      </button>
    </form>
  );
}

export function LoginFlow({
  login,
  providerName,
  onAnswer,
  onCancel,
  onDismiss,
}: {
  login: LoginFlowState;
  providerName: string;
  onAnswer: (value: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  return (
    <div data-testid="login-flow" className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Signing in to {providerName}</p>
      {login.events.map((event, index) => (
        <Step key={index} event={event} />
      ))}
      {login.prompt && <Question key={login.prompt.promptId} prompt={login.prompt.prompt} onAnswer={onAnswer} />}
      {!login.done && !login.prompt && login.events.length === 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">Starting…</p>}
      {login.done ? (
        <div data-testid="login-done" data-ok={login.done.ok ? "true" : "false"} className="space-y-2">
          <p className={`text-sm ${login.done.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
            {login.done.ok ? `Signed in to ${providerName}.` : login.done.cancelled ? "Sign-in cancelled." : `Sign-in failed: ${login.done.message ?? "unknown error"}`}
          </p>
          <button type="button" className={button} onClick={onDismiss}>
            Close
          </button>
        </div>
      ) : (
        <button type="button" className={button} onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
