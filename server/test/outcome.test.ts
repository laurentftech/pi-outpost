import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { WorkPlan } from "@pi-outpost/shared";
import {
  composeWorkspaceOutcome,
  evidenceContributor,
  outcomeTargetForResource,
  repositoryContributor,
  workPlanContributor,
  type OutcomeContributor,
} from "../src/outcome.ts";
import type { GitRepo, GitStatusResult } from "../src/git.ts";

const plan: WorkPlan = {
  version: 1,
  id: "p",
  title: "Ship it",
  updatedAt: "2026-09-01T00:00:00Z",
  tasks: [{
    id: "build",
    title: "Build",
    status: "blocked",
    statusReason: "Waiting for CI",
    dependsOn: [],
    resources: [],
    evidence: [
      { id: "unit", type: "test", result: "passed", summary: "Unit tests", reference: { uri: "workspace:reports/unit.txt" } },
      { id: "lint", type: "command", result: "inconclusive" },
      { id: "note", type: "note", result: "informational", reference: { uri: "custom:opaque" } },
    ],
  }],
};

describe("Outcome composition", () => {
  test("orders contributors stably and isolates a failed contributor", async () => {
    const contributors: OutcomeContributor[] = [
      { id: "z", title: "Z", order: 2, contribute: () => ({ availability: "empty", entries: [] }) },
      { id: "b", title: "B", order: 1, contribute: () => { throw new Error("offline"); } },
      { id: "a", title: "A", order: 1, contribute: () => ({ availability: "available", entries: [] }) },
    ];
    const outcome = await composeWorkspaceOutcome({ workspaceRoot: "/a", sessionId: "s" }, contributors);
    assert.deepEqual(outcome.sections.map((section) => section.id), ["a", "b", "z"]);
    assert.equal(outcome.sections[1].availability, "unavailable");
    assert.equal(outcome.sections[1].summary, "offline");
    assert.equal("html" in outcome.sections[0], false);
  });

  test("preserves existing sections when a future contributor is registered", async () => {
    const base = await composeWorkspaceOutcome({ workspaceRoot: "/a", sessionId: "s" }, [workPlanContributor(plan)]);
    const extended = await composeWorkspaceOutcome({ workspaceRoot: "/a", sessionId: "s" }, [
      workPlanContributor(plan),
      { id: "future", title: "Future source", order: 99, contribute: () => ({ availability: "available", entries: [{ id: "result", source: "Future", title: "Result", status: "informational" }] }) },
    ]);
    assert.deepEqual(extended.sections[0], base.sections[0]);
    assert.equal(extended.sections[1].id, "future");
  });

  test("preserves plan status reasons and deterministic evidence", async () => {
    const first = await composeWorkspaceOutcome({ workspaceRoot: "/a", sessionId: "s" }, [workPlanContributor(plan), evidenceContributor(plan)]);
    const second = await composeWorkspaceOutcome({ workspaceRoot: "/a", sessionId: "s" }, [workPlanContributor(plan), evidenceContributor(plan)]);
    assert.deepEqual(first, second);
    assert.equal(first.sections[0].entries[0].status, "blocked");
    assert.equal(first.sections[0].entries[0].detail, "Waiting for CI");
    assert.equal(first.sections[1].summary, "Verification inconclusive.");
    assert.deepEqual(first.sections[1].entries.map((entry) => entry.status), ["passed", "inconclusive", "informational"]);
  });

  test("ignores conversation claims because only registered structured contributors compose Outcome", async () => {
    const contextWithClaim = { workspaceRoot: "/a", sessionId: "s", conversation: [{ role: "assistant", text: "Everything passed successfully" }] };
    const outcome = await composeWorkspaceOutcome(contextWithClaim, [workPlanContributor(null), evidenceContributor(null)]);
    assert.equal(outcome.sections[0].summary, "No Work Plan is recorded for this session.");
    assert.equal(outcome.sections[1].summary, "Verification not recorded.");
    assert.equal(JSON.stringify(outcome).includes("Everything passed"), false);
  });

  test("keeps legacy absence and informational-only evidence unverified", async () => {
    const outcome = await composeWorkspaceOutcome({ workspaceRoot: "/a", sessionId: "s" }, [workPlanContributor(null), evidenceContributor(null)]);
    assert.match(outcome.sections[0].summary!, /No Work Plan/);
    assert.equal(outcome.sections[1].summary, "Verification not recorded.");
  });

  test("accepts only confined workspace paths and HTTP(S) links", () => {
    assert.deepEqual(outcomeTargetForResource({ uri: "workspace:src/a.ts" }), { kind: "workspace-file", path: "src/a.ts" });
    assert.deepEqual(outcomeTargetForResource({ uri: "https://example.com/result" }), { kind: "external-url", url: "https://example.com/result" });
    assert.equal(outcomeTargetForResource({ uri: "workspace:../secret" }), undefined);
    assert.equal(outcomeTargetForResource({ uri: "javascript:alert(1)" }), undefined);
  });
});

describe("repository Outcome contributor", () => {
  const repos: GitRepo[] = [
    { id: "a", cwd: "/root/a", toplevel: "/root/a" },
    { id: "b", cwd: "/root/b", toplevel: "/root/b" },
  ];
  const status = (value: GitStatusResult) => async () => value;

  test("attributes and sorts every file state across repositories", async () => {
    const result = await repositoryContributor({ repos, readStatus: status({
      repos: [], missing: [], failures: [], files: [
        { path: "b/z.ts", status: "untracked" },
        { path: "a/d.ts", status: "deleted" },
        { path: "a/c.ts", status: "conflicted" },
        { path: "a/a.ts", status: "added" },
        { path: "a/m.ts", status: "modified" },
      ],
    }) }).contribute();
    assert.equal(result.availability, "available");
    assert.deepEqual(result.entries.map((entry) => [entry.group, entry.title, entry.status]), [
      ["a", "a/a.ts", "added"], ["a", "a/c.ts", "conflicted"], ["a", "a/d.ts", "deleted"],
      ["a", "a/m.ts", "modified"], ["b", "b/z.ts", "untracked"],
    ]);
  });

  // openlore: scenario=TheBadgeSaysAtLeast spec=git
  test("TheBadgeSaysAtLeast: a collapsed directory is one entry with its count and no diff to open", async () => {
    const result = await repositoryContributor({ repos, readStatus: status({
      repos: [], missing: [], failures: [], files: [{ path: "a/vendor", status: "untracked", atLeast: 2000 }],
    }) }).contribute();
    assert.deepEqual(result.entries.map((entry) => [entry.title, entry.status, entry.detail, entry.target]), [
      ["a/vendor/", "untracked", "At least 2,000 untracked files", undefined],
    ]);
  });

  test("distinguishes clean, no repository, unavailable, and partial", async () => {
    const clean = await repositoryContributor({ repos, readStatus: status({ repos: [], files: [], missing: [], failures: [] }) }).contribute();
    assert.deepEqual([clean.availability, clean.summary], ["empty", "No changed files."]);
    const none = await repositoryContributor({ repos: [], gitUnavailable: { reason: "no-repository" } }).contribute();
    assert.equal(none.availability, "empty");
    const unavailable = await repositoryContributor({ repos: [], gitUnavailable: { reason: "no-executable", message: "not found" } }).contribute();
    assert.equal(unavailable.availability, "unavailable");
    const partial = await repositoryContributor({ repos, readStatus: status({
      repos: [], files: [{ path: "a/a.ts", status: "modified" }], missing: ["b"], failures: [{ repo: "b", message: "gone" }],
    }) }).contribute();
    assert.equal(partial.availability, "partial");
    assert.ok(partial.entries.some((entry) => entry.status === "unavailable" && entry.title === "b"));
  });
});
