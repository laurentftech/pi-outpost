import type { SandboxRefusalView, SandboxRuleView, SandboxRulesState } from "@pi-outpost/shared";

/**
 * The project's durable sandbox rules and what the sandbox refused its commands
 * (`durable-sandbox-rules`).
 *
 * The rules come first, each revoked in one click: a rule is a standing widening (or closing) of
 * the sandbox, and the place to see the sandbox's state is where to see it. The recorded refusals
 * follow, most recent first; from each the user makes a rule — always allow, always refuse — or
 * leaves it to be asked. Always allow is not offered on what can never be granted, and the panel
 * says why. Where the runner does not report refused files, the panel says so, so that an empty
 * list is not read as "nothing was refused".
 *
 * Only the user makes a rule, here or in a grant dialog: nothing of this reaches the agent.
 */
export interface SandboxRulesPanelProps {
  state: SandboxRulesState | null;
  error: string | null;
  onSet(refusalKey: string, decision: "allow" | "refuse"): void;
  onRevoke(id: string): void;
}

const small = "rounded border px-1.5 py-0.5 text-[11px] border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

function ruleText(rule: SandboxRuleView): string {
  const what = rule.kind === "host" ? `host ${rule.target}` : `${rule.access === "write" ? "read and write" : "read"} ${rule.target}`;
  return `${rule.decision === "allow" ? "Always allow" : "Always refuse"} ${what}`;
}

function refusalText(refusal: SandboxRefusalView): string {
  if (refusal.kind === "host") return `host ${refusal.target}`;
  if (refusal.kind === "directory") return `${refusal.access === "write" ? "writing to" : "reading"} ${refusal.target}`;
  return `${refusal.detail ?? "refused"} ${refusal.target}`;
}

const FILES: Record<SandboxRulesState["files"], string | null> = {
  reported: null,
  "on-demand": "This sandbox reports refused files only when the agent asks for a diagnosis after a failure.",
  "not-reported": "This sandbox does not report refused files: only hosts and the agent's own requests appear here.",
};

export function SandboxRulesPanel({ state, error, onSet, onRevoke }: SandboxRulesPanelProps) {
  if (!state) {
    return (
      <div data-testid="sandbox-rules-panel" data-loading="true" className="p-3 text-xs text-zinc-500 dark:text-zinc-400">
        Loading the sandbox's rules…
      </div>
    );
  }
  const filesNote = FILES[state.files];
  return (
    <div data-testid="sandbox-rules-panel" className="max-h-[60dvh] w-[min(28rem,90vw)] overflow-y-auto p-3 text-xs text-zinc-700 dark:text-zinc-300">
      {!state.enabled && (
        <p data-testid="sandbox-rules-off" className="mb-2 rounded bg-zinc-100 p-2 dark:bg-zinc-800">
          Rules are off for this project (sandbox.grants is "never"): none is made, and none applies.
        </p>
      )}
      {error && (
        <p role="alert" data-testid="sandbox-rules-error" className="mb-2 rounded bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {error}
        </p>
      )}

      <h3 className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">Your rules</h3>
      {state.rules.length === 0 ? (
        <p data-testid="sandbox-rules-none" className="mb-3 text-zinc-500 dark:text-zinc-400">
          None: every request is asked about.
        </p>
      ) : (
        <ul data-testid="sandbox-rules-list" className="mb-3 space-y-1">
          {state.rules.map((rule) => (
            <li key={rule.id} data-rule-id={rule.id} className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-all">{ruleText(rule)}</span>
              <button type="button" className={small} onClick={() => onRevoke(rule.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">Refused by the sandbox</h3>
      {filesNote && (
        <p data-testid="sandbox-rules-files" className="mb-2 text-zinc-500 dark:text-zinc-400">
          {filesNote}
        </p>
      )}
      {state.refusals.length === 0 ? (
        <p data-testid="sandbox-refusals-none" className="text-zinc-500 dark:text-zinc-400">
          Nothing recorded yet.
        </p>
      ) : (
        <ul data-testid="sandbox-refusals-list" className="space-y-2">
          {state.refusals.map((refusal) => (
            <li key={refusal.key} data-refusal-key={refusal.key} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="break-all">
                {refusalText(refusal)}
                {refusal.count > 1 && <span className="text-zinc-500 dark:text-zinc-400"> · {refusal.count}×</span>}
              </div>
              <code className="mt-0.5 block truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400" title={refusal.command}>
                {refusal.command}
              </code>
              {refusal.ruleId ? (
                <p className="mt-1 text-zinc-500 dark:text-zinc-400">A rule of yours covers it.</p>
              ) : refusal.kind === "info" ? (
                <p className="mt-1 text-zinc-500 dark:text-zinc-400">{refusal.notAllowable}</p>
              ) : state.enabled ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <button type="button" className={small} onClick={() => onSet(refusal.key, "refuse")}>
                    Always refuse
                  </button>
                  {refusal.notAllowable ? (
                    <span data-testid="sandbox-refusal-not-allowable" className="text-zinc-500 dark:text-zinc-400">
                      Always allow is not offered: {refusal.notAllowable}.
                    </span>
                  ) : (
                    <button type="button" className={small} onClick={() => onSet(refusal.key, "allow")}>
                      Always allow
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
