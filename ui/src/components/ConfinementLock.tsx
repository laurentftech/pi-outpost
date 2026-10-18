import type { ConfinementAttempt, ConfinementVerdict } from "@pi-outpost/shared";

/**
 * Whether the agent's shell (or the terminal) is confined — as observed, not as configured.
 *
 * The server runs a canary through the real runner: closed only when every attempt it made was
 * refused, open and red naming what got through, "checking" meanwhile, a warning when the canary
 * itself could not answer. A lock earned by configuration alone would be a false sense of security.
 */
const ATTEMPTS: Record<ConfinementAttempt, string> = {
  "agent-directory": "read the agent directory (the provider keys)",
  "beside-root": "read a file beside the root",
  "write-beside-root": "write beside the root",
  "signal-process": "signal another process of the server's user",
  "server-environment": "read the server's environment",
  "unlisted-host": "reach a host not in sandbox.allowedHosts",
  "direct-connection": "connect around the proxy",
};

const describe = (attempts: readonly ConfinementAttempt[]) => attempts.map((attempt) => ATTEMPTS[attempt] ?? attempt);

const at = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
};

/** The tooltip: what was tried, and what came of it. */
export function confinementDescription(verdict: ConfinementVerdict, surface: "shell" | "terminal"): string {
  const what = surface === "shell" ? "The agent's shell" : "This terminal";
  switch (verdict.state) {
    case "checking":
      return `${what} runs under ${verdict.runner || "a sandbox runner"}; its confinement is being checked.`;
    case "verified":
      return [
        `${what} is confined by ${verdict.runner}, checked at ${at(verdict.checkedAt)}. A command could not:`,
        ...describe(verdict.refused).map((line) => `• ${line}`),
        ...(verdict.notChecked.length ? ["Not checked:", ...verdict.notChecked.map((n) => `• ${ATTEMPTS[n.attempt] ?? n.attempt} — ${n.why}`)] : []),
      ].join("\n");
    case "leaking":
      return [
        `${what} is NOT confined as configured: under ${verdict.runner}, checked at ${at(verdict.checkedAt)}, a command could:`,
        ...describe(verdict.reached).map((line) => `• ${line}`),
        "The configuration is unchanged: fix the runner or its host, or stop using it.",
      ].join("\n");
    case "failed":
      return `${what}'s confinement could not be checked (${verdict.runner}, ${at(verdict.checkedAt)}): ${verdict.reason}`;
  }
}

export function ConfinementLock({ verdict, surface, root }: { verdict: ConfinementVerdict; surface: "shell" | "terminal"; root?: string }) {
  const where = root ? ` to ${root}` : "";
  const look =
    verdict.state === "verified"
      ? { icon: "🔒", text: `confined${where}`, tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" }
      : verdict.state === "leaking"
        ? { icon: "🔓", text: "not confined", tone: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200" }
        : verdict.state === "failed"
          ? { icon: "⚠", text: "confinement unchecked", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" }
          : { icon: "…", text: "checking confinement", tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
  return (
    <span
      data-testid={surface === "shell" ? "shell-confinement" : "terminal-confined"}
      data-state={verdict.state}
      title={confinementDescription(verdict, surface)}
      className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-sans text-[11px] ${look.tone}`}
    >
      {look.icon} {surface === "shell" ? `shell ${look.text}` : look.text}
    </span>
  );
}
