import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OutcomeState } from "../useAgent";
import { OutcomePanel } from "./OutcomePanel";

function loaded(): Extract<NonNullable<OutcomeState>, { status: "loaded" }> {
  return {
    status: "loaded",
    requestId: "r",
    workspaceRoot: "/work",
    sessionId: "s",
    outcome: {
      workspaceRoot: "/work",
      sessionId: "s",
      sections: [
        { id: "work-plan", title: "Work Plan", order: 10, availability: "available", summary: "1 done · 1 blocked", entries: [
          { id: "done", source: "Work Plan", title: "Compile", status: "done", target: { kind: "work-plan-task", taskId: "done" } },
          { id: "todo", source: "Work Plan", title: "Queue", status: "todo" },
          { id: "active", source: "Work Plan", title: "Implement", status: "in_progress" },
          { id: "blocked", source: "Work Plan", title: "Release", status: "blocked", detail: "Waiting for CI" },
          { id: "review", source: "Work Plan", title: "Review", status: "needs_review" },
        ] },
        { id: "verification", title: "Verification", order: 20, availability: "available", summary: "Verification inconclusive.", entries: [
          { id: "failed", source: "test", title: "Browser checks", status: "failed" },
          { id: "uncertain", source: "command", title: "Flaky check", status: "inconclusive" },
          { id: "info", source: "note", title: "Manual note", status: "informational", reference: "opaque:note" },
          { id: "url", source: "external-check", title: "CI", status: "passed", target: { kind: "external-url", url: "https://example.com/ci" } },
        ] },
        { id: "changed-files", title: "Changed files", order: 30, availability: "partial", summary: "1 repository is unavailable.", entries: [
          { id: "file", source: "Git working tree", title: "src/app.ts", status: "modified", group: ".", target: { kind: "workspace-diff", path: "src/app.ts" } },
          { id: "new-file", source: "Git working tree", title: "src/new.ts", status: "untracked", group: ".", target: { kind: "workspace-file", path: "src/new.ts" } },
          { id: "missing", source: "Git working tree", title: "nested", status: "unavailable", detail: "repository vanished" },
        ] },
      ],
    },
  };
}

describe("OutcomePanel", () => {
  it("shows adverse, review, evidence, source, and partial states without claiming success", () => {
    render(<OutcomePanel state={loaded()} onClose={() => {}} onRefresh={() => {}} onTarget={() => {}} />);
    expect(screen.getByRole("complementary", { name: "Workspace Outcome" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for CI")).toBeInTheDocument();
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Informational")).toBeInTheDocument();
    expect(screen.getAllByText("Inconclusive")).not.toHaveLength(0);
    expect(screen.getByText("Verification inconclusive.")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.queryByText(/successfully completed/i)).toBeNull();
  });

  it("routes typed targets and leaves unsupported references as text", () => {
    const onTarget = vi.fn();
    render(<OutcomePanel state={loaded()} onClose={() => {}} onRefresh={() => {}} onTarget={onTarget} />);
    fireEvent.click(screen.getByRole("button", { name: /Compile/ }));
    expect(onTarget).toHaveBeenCalledWith({ kind: "work-plan-task", taskId: "done" });
    fireEvent.click(screen.getByRole("button", { name: /src\/app.ts/ }));
    expect(onTarget).toHaveBeenCalledWith({ kind: "workspace-diff", path: "src/app.ts" });
    expect(screen.getByRole("link", { name: /CI/ })).toHaveAttribute("href", "https://example.com/ci");
    expect(screen.getByText("opaque:note").closest("button, a")).toBeNull();
  });

  it("distinguishes loading and empty legacy source messages", () => {
    const { rerender } = render(<OutcomePanel state={null} onClose={() => {}} onRefresh={() => {}} onTarget={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Outcome");
    const state = loaded();
    state.outcome.sections = [
      { id: "work-plan", title: "Work Plan", order: 10, availability: "empty", summary: "No Work Plan is recorded for this session.", entries: [] },
      { id: "verification", title: "Verification", order: 20, availability: "empty", summary: "Verification not recorded.", entries: [] },
      { id: "changed-files", title: "Changed files", order: 30, availability: "empty", summary: "No repositories are present in this workspace.", entries: [] },
    ];
    rerender(<OutcomePanel state={state} onClose={() => {}} onRefresh={() => {}} onTarget={() => {}} />);
    const panel = screen.getByRole("complementary", { name: "Workspace Outcome" });
    expect(within(panel).getByText(/No Work Plan/)).toBeInTheDocument();
    expect(within(panel).getByText("Verification not recorded.")).toBeInTheDocument();
    expect(within(panel).getByText(/No repositories/)).toBeInTheDocument();
    state.outcome.sections[2] = { id: "changed-files", title: "Changed files", order: 30, availability: "empty", summary: "No changed files.", entries: [] };
    rerender(<OutcomePanel state={state} onClose={() => {}} onRefresh={() => {}} onTarget={() => {}} />);
    expect(screen.getByText("No changed files.")).toBeInTheDocument();
  });

  it("surfaces a disconnected refresh as an error instead of loading forever", () => {
    render(<OutcomePanel state={{ status: "error", requestId: "r", workspaceRoot: "/work", sessionId: "s", message: "Connection lost while loading Outcome." }} onClose={() => {}} onRefresh={() => {}} onTarget={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost while loading Outcome.");
  });
});
