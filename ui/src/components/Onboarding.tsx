import { useState } from "react";
import type { CredentialStatus, ProviderCompat } from "@pi-outpost/shared";

/**
 * First-run screen: the server has no provider that can answer, so a chat would only
 * fail on the first message — with an error telling a web user to run `/login`, a
 * command that exists in pi's terminal UI and not here. Ask for what is missing.
 */
interface OnboardingProps {
  title?: string;
  credentials: CredentialStatus;
  /** Store a key for a provider the server already knows. */
  onSetCredential: (provider: string, apiKey: string) => void;
  /** Declare an OpenAI-compatible endpoint of the user's own. */
  onDeclareProvider: (declaration: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    compat?: ProviderCompat;
  }) => void;
  /** Errors the server sent back (unwritable agentDir, unverifiable certificate…). */
  errors: string[];
}

const field =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600";
const label = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

export function Onboarding({ title, credentials, onSetCredential, onDeclareProvider, errors }: OnboardingProps) {
  const known = credentials.providers;
  const [tab, setTab] = useState<"known" | "custom">(known.length > 0 ? "known" : "custom");
  const [provider, setProvider] = useState(known[0]?.id ?? "");
  const [apiKey, setApiKey] = useState("");

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [developerRole, setDeveloperRole] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState(true);

  // Providers are configured, yet nothing is selectable: the key is not what is
  // missing — the configuration is. Sending this user to a key form would be a lie.
  const configuredButUnusable = known.some((p) => p.configured) && !credentials.usableModel;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (configuredButUnusable) return;
    if (tab === "known") {
      if (provider && apiKey.trim()) onSetCredential(provider, apiKey.trim());
      return;
    }
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim() || !modelId.trim()) return;
    onDeclareProvider({
      provider: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      models: [modelId.trim()],
      compat: { supportsDeveloperRole: developerRole, supportsReasoningEffort: reasoningEffort },
    });
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
        <div className="mb-1 text-center text-3xl">{title ?? "π"}</div>

        {configuredButUnusable ? (
          <>
            <h1 className="mb-3 text-center text-sm text-zinc-500 dark:text-zinc-400">No model is available.</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Credentials are configured, so this is not a missing key: <code>allowedModels</code> in your configuration
              leaves nothing to choose from. Widen it, or remove it, then restart.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No model provider is set up yet. Add one to start chatting.
            </h1>

            <div className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1 text-xs dark:bg-zinc-800">
              {(["known", "custom"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTab(option)}
                  className={`flex-1 rounded-md px-2 py-1.5 ${
                    tab === option
                      ? "bg-white font-medium text-zinc-800 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {option === "known" ? "Provider API key" : "OpenAI-compatible endpoint"}
                </button>
              ))}
            </div>

            {tab === "known" ? (
              <>
                <label htmlFor="onboarding-provider" className={label}>
                  Provider
                </label>
                <select
                  id="onboarding-provider"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  className={`${field} mb-3`}
                >
                  {known.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.configured ? " (already configured)" : ""}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label htmlFor="onboarding-name" className={label}>
                  Name
                </label>
                <input
                  id="onboarding-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="corp"
                  className={`${field} mb-3`}
                />
                <label htmlFor="onboarding-url" className={label}>
                  Base URL
                </label>
                <input
                  id="onboarding-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://llm.corp.example/v1"
                  className={`${field} mb-3`}
                />
                <label htmlFor="onboarding-model" className={label}>
                  Model id
                </label>
                <input
                  id="onboarding-model"
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  placeholder="gpt-oss-120b"
                  className={`${field} mb-3`}
                />
              </>
            )}

            <label htmlFor="onboarding-key" className={label}>
              API key
            </label>
            <input
              id="onboarding-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-…"
              className={field}
            />

            {tab === "custom" && (
              <fieldset className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                {/* Not an advanced detail to bury: a gateway that rejects these fails on
                    every single turn, and its error never says which one is to blame. */}
                <legend className="px-1 text-xs text-zinc-500 dark:text-zinc-400">Compatibility</legend>
                <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={developerRole}
                    onChange={(event) => setDeveloperRole(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Server understands the <code>developer</code> role. Uncheck for vLLM, SGLang and most corporate
                    gateways — the system prompt is then sent as a <code>system</code> message.
                  </span>
                </label>
                <label className="mt-2 flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={reasoningEffort}
                    onChange={(event) => setReasoningEffort(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Server accepts <code>reasoning_effort</code>. Uncheck if it rejects unknown fields.
                  </span>
                </label>
              </fieldset>
            )}

            <button
              type="submit"
              className="mt-4 w-full rounded-md bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Save and start
            </button>
          </>
        )}

        {errors.map((error, i) => (
          <p
            key={i}
            className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          >
            {error}
          </p>
        ))}

        <p className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
          {credentials.agentDir ? `Stored in ${credentials.agentDir}. ` : ""}Provider environment variables work too, as
          does <code>pi-outpost login</code>.
        </p>
      </form>
    </div>
  );
}
