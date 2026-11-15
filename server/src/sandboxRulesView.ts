/**
 * The project's rules and recorded refusals as the interface shows them, and the rules the user
 * makes or revokes there (`durable-sandbox-rules`).
 *
 * The interface alone reaches these: they answer client messages (`sandbox_rules_get`,
 * `sandbox_rule_set`, `sandbox_rule_revoke`), never a tool. A rule is made from a recorded
 * refusal, so its target is one the sandbox really refused; always allow is checked as a grant
 * request is, so what can never be granted takes no rule.
 */
import type { SandboxRefusalView, SandboxRulesState } from "@pi-outpost/shared";
import type { SandboxConfig } from "./config.ts";
import { checkGrantRequest, type GrantContext } from "./sandboxGrants.ts";
import { forbiddenHost } from "./sandboxGrants.ts";
import type { RecordedRefusal, SandboxRule, SandboxRulesStore } from "./sandboxRules.ts";
import { isMacMxc, isPosixMxc, runnerKind } from "./terminalSandbox.ts";

/** Whether rules are made and applied: a confined shell, and grants not switched off. */
export function rulesEnabled(sandbox: SandboxConfig | undefined): boolean {
  return Boolean(sandbox?.allowBash && sandbox.bashRunner && sandbox.grants !== "never");
}

/** What the runner reports of refused files: as they happen, on a diagnosis, or not at all. */
export function fileReporting(runner: string | undefined, platform: NodeJS.Platform = process.platform): SandboxRulesState["files"] {
  if (!runner) return "not-reported";
  const kind = runnerKind(runner);
  if (kind === "landstrip") return platform === "win32" ? "not-reported" : "reported";
  if (kind === "mxc" && platform === "win32" && !isPosixMxc(runner, platform)) return "on-demand";
  // Seatbelt's refusals, asked of MXC with every command (`mxcMacCaptureRequest`).
  if (kind === "mxc" && isMacMxc(runner, platform)) return "reported";
  return "not-reported";
}

function sameResource(rule: SandboxRule, refusal: RecordedRefusal, platform: NodeJS.Platform): boolean {
  if (refusal.kind === "info" || rule.kind !== refusal.kind) return false;
  const norm = (t: string) => (rule.kind === "host" || platform === "win32" ? t.toLowerCase() : t);
  return norm(rule.target) === norm(refusal.target) && (rule.kind === "host" || (refusal.kind === "directory" && rule.access === refusal.access));
}

/** Why always allow cannot be offered for a refusal, or undefined when it can. */
async function notAllowable(refusal: RecordedRefusal, context: GrantContext): Promise<string | undefined> {
  if (refusal.kind === "info") return "no rule can name it: it is neither a directory nor a host";
  if (refusal.kind === "host") {
    const why = forbiddenHost(refusal.target);
    return why === undefined ? undefined : `never granted: ${why}`;
  }
  const check = await checkGrantRequest({ directories: [{ path: refusal.target, access: refusal.access }] }, context);
  return check.ok ? undefined : `never granted: ${check.refusals.map((r) => r.why).join("; ")}`;
}

export async function rulesState(
  store: SandboxRulesStore,
  sandbox: SandboxConfig | undefined,
  context: GrantContext,
  platform: NodeJS.Platform = process.platform,
): Promise<SandboxRulesState> {
  const [rules, recorded] = await Promise.all([store.rules(), store.refusals()]);
  const refusals: SandboxRefusalView[] = [];
  // Most recent first: what the user just met is on top.
  for (const refusal of [...recorded].reverse()) {
    const rule = rules.find((r) => sameResource(r, refusal, platform));
    const why = await notAllowable(refusal, context);
    refusals.push({
      key: refusal.key,
      kind: refusal.kind,
      target: refusal.target,
      ...(refusal.kind === "directory" ? { access: refusal.access } : {}),
      ...(refusal.kind === "info" ? { detail: refusal.detail } : {}),
      command: refusal.command,
      count: refusal.count,
      lastSeen: refusal.lastSeen,
      ...(rule ? { ruleId: rule.id } : {}),
      ...(why ? { notAllowable: why } : {}),
    });
  }
  return { enabled: rulesEnabled(sandbox), files: fileReporting(sandbox?.bashRunner, platform), rules, refusals };
}

/**
 * The user makes a rule from a recorded refusal. Refused, with the reason the interface shows:
 * rules switched off, a refusal no longer recorded, information no rule can name, or always
 * allow on a target never granted. Always refuse is allowed on anything a rule can name.
 */
export async function ruleFromRefusal(
  store: SandboxRulesStore,
  sandbox: SandboxConfig | undefined,
  context: GrantContext,
  key: string,
  decision: "allow" | "refuse",
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!rulesEnabled(sandbox)) return { ok: false, message: "Rules are off for this project: sandbox.grants is \"never\"." };
  const refusal = (await store.refusals()).find((r) => r.key === key);
  if (!refusal) return { ok: false, message: "That refusal is no longer recorded." };
  if (refusal.kind === "info") return { ok: false, message: "No rule can name it: it is neither a directory nor a host." };
  if (decision === "allow") {
    const why = await notAllowable(refusal, context);
    if (why) return { ok: false, message: `Always allow is not offered for ${refusal.target}: ${why}.` };
  }
  await store.setRule(refusal.kind === "host" ? { kind: "host", target: refusal.target, decision } : { kind: "directory", target: refusal.target, access: refusal.access, decision });
  return { ok: true };
}
