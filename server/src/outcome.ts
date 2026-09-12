import type { GitUnavailable, OutcomeEntry, OutcomeSection, WorkspaceOutcome, WorkPlan, WorkPlanResource } from "@pi-outpost/shared";
import { outcomeVerification, workPlanProgress } from "@pi-outpost/shared/outcome";
import { gitStatus, repoFor, type GitRepo, type GitStatusResult } from "./git.ts";
import { resourceTargetFor } from "@pi-outpost/shared/resource-target";

export interface OutcomeContext {
  workspaceRoot: string;
  sessionId: string;
}

export interface OutcomeContribution {
  availability: OutcomeSection["availability"];
  summary?: string;
  entries: OutcomeEntry[];
}

export interface OutcomeContributor {
  id: string;
  title: string;
  order: number;
  contribute(): Promise<OutcomeContribution> | OutcomeContribution;
}

export async function composeWorkspaceOutcome(context: OutcomeContext, contributors: readonly OutcomeContributor[]): Promise<WorkspaceOutcome> {
  const ordered = [...contributors].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const sections = await Promise.all(ordered.map(async (contributor): Promise<OutcomeSection> => {
    try {
      const contribution = await contributor.contribute();
      return { id: contributor.id, title: contributor.title, order: contributor.order, ...contribution };
    } catch (error) {
      return {
        id: contributor.id,
        title: contributor.title,
        order: contributor.order,
        availability: "unavailable",
        summary: error instanceof Error && error.message ? error.message : "This source is unavailable.",
        entries: [],
      };
    }
  }));
  // Construct the wire shape explicitly. Runtime callers can carry unrelated
  // fields despite TypeScript's structural checks; none may leak into Outcome.
  return { workspaceRoot: context.workspaceRoot, sessionId: context.sessionId, sections };
}

export function outcomeTargetForResource(resource: WorkPlanResource): OutcomeEntry["target"] {
  // The application's one answer to "may a reader be taken there", shared with the
  // structured exchange's locations and artifact links. Two copies of this rule
  // drift, and the copy that drifts open is a navigation nobody sanctioned.
  return resourceTargetFor(resource.uri);
}

export function workPlanContributor(plan: WorkPlan | null): OutcomeContributor {
  return {
    id: "work-plan",
    title: "Work Plan",
    order: 10,
    contribute: () => {
      if (plan === null) return { availability: "empty", summary: "No Work Plan is recorded for this session.", entries: [] };
      const progress = workPlanProgress(plan);
      const entries = plan.tasks.map((task): OutcomeEntry => ({
        id: task.id,
        source: "Work Plan",
        title: task.title,
        status: task.status,
        ...(task.statusReason ? { detail: task.statusReason } : {}),
        target: { kind: "work-plan-task", taskId: task.id },
      }));
      const summary = `${progress.done} done · ${progress.needs_review} needs review · ${progress.in_progress} in progress · ${progress.todo} to do · ${progress.blocked} blocked`;
      return { availability: entries.length === 0 ? "empty" : "available", summary, entries };
    },
  };
}

export function evidenceContributor(plan: WorkPlan | null): OutcomeContributor {
  return {
    id: "verification",
    title: "Verification",
    order: 20,
    contribute: () => {
      const aggregate = outcomeVerification(plan);
      const entries = (plan?.tasks ?? []).flatMap((task) => task.evidence.map((evidence): OutcomeEntry => ({
        id: `${task.id}:${evidence.id}`,
        source: evidence.type,
        title: evidence.summary ?? evidence.id,
        status: evidence.result,
        group: task.title,
        ...(evidence.summary ? { detail: evidence.id } : {}),
        ...(evidence.reference ? {
          reference: evidence.reference.label ?? evidence.reference.uri,
          target: outcomeTargetForResource(evidence.reference),
        } : {}),
      })));
      return {
        availability: entries.length === 0 ? "empty" : "available",
        summary: aggregate === "not-recorded" ? "Verification not recorded." : `Verification ${aggregate}.`,
        entries,
      };
    },
  };
}

export interface RepositoryOutcomeInput {
  repos: readonly GitRepo[];
  gitUnavailable?: GitUnavailable;
  readStatus?: (repos: readonly GitRepo[]) => Promise<GitStatusResult>;
}

function unavailableSummary(reason: GitUnavailable | undefined): string {
  if (reason?.reason === "no-repository") return "No repositories are present in this workspace.";
  if (reason?.reason === "no-executable") return `Git is unavailable: ${reason.message}`;
  if (reason?.reason === "refused") return `Repository status is unavailable: ${reason.message}`;
  return "Repository status is unavailable.";
}

export function repositoryContributor(input: RepositoryOutcomeInput): OutcomeContributor {
  return {
    id: "changed-files",
    title: "Changed files",
    order: 30,
    contribute: async () => {
      if (input.repos.length === 0) {
        return {
          availability: input.gitUnavailable?.reason === "no-repository" ? "empty" : "unavailable",
          summary: unavailableSummary(input.gitUnavailable),
          entries: [],
        };
      }
      const status = await (input.readStatus ?? gitStatus)(input.repos);
      const entries: OutcomeEntry[] = status.files.map((file) => {
        const repo = repoFor(input.repos, file.path)?.id ?? "";
        return {
          id: `${repo}:${file.path}:${file.status}`,
          source: "Git working tree",
          title: file.path,
          status: file.status,
          group: repo || ".",
          target: { kind: "workspace-diff", path: file.path },
        };
      });
      for (const failure of status.failures) {
        entries.push({
          id: `unavailable:${failure.repo}`,
          source: "Git working tree",
          title: failure.repo || ".",
          status: "unavailable",
          detail: failure.message,
          group: failure.repo || ".",
        });
      }
      entries.sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.title.localeCompare(b.title) || a.status.localeCompare(b.status));
      return {
        availability: status.failures.length > 0 ? "partial" : entries.length === 0 ? "empty" : "available",
        summary: status.failures.length > 0
          ? `${status.failures.length} ${status.failures.length === 1 ? "repository is" : "repositories are"} unavailable.`
          : entries.length === 0 ? "No changed files." : `${entries.length} changed ${entries.length === 1 ? "file" : "files"}.`,
        entries,
      };
    },
  };
}
