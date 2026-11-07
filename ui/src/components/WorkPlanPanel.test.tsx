import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkPlan } from "@pi-outpost/shared";
import { WorkPlanPanel } from "./WorkPlanPanel";

const plan: WorkPlan = {
  version: 1,
  id: "release",
  title: "Ship the feature",
  updatedAt: "2026-08-23T00:00:00.000Z",
  tasks: [
    { id: "analyse", title: "Analyse impact", status: "done", evidence: [], dependsOn: [], resources: [] },
    { id: "build", title: "Build UI", description: "Keep the plan readable.", status: "in_progress", evidence: [], dependsOn: ["analyse"], resources: [{ uri: "workspace:ui/src/App.tsx", label: "App" }] },
    { id: "review", title: "Review output", status: "needs_review", parentId: "build", evidence: [], dependsOn: ["build"], resources: [{ uri: "model:SYS-421", label: "SYS-421" }], statusReason: "Needs human acceptance" },
    { id: "blocked", title: "Publish", status: "blocked", evidence: [], dependsOn: ["review"], resources: [], statusReason: "Credentials unavailable" },
  ],
};

describe("WorkPlanPanel", () => {
  it("shows hierarchy, distinct states, focus, and aggregate progress", () => {
    render(<WorkPlanPanel plan={plan} open onToggle={() => {}} onOpenWorkspace={() => {}} />);
    expect(screen.getByText("Progress: 1 / 4")).toBeTruthy();
    expect(screen.getByLabelText("In progress").closest("button")?.getAttribute("aria-current")).toBe("step");
    expect(screen.getByLabelText("Done")).toBeTruthy();
    expect(screen.getByLabelText("Needs review")).toBeTruthy();
    expect(screen.getByLabelText("Blocked")).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /Build UI/ })).toHaveAttribute("aria-level", "1");
    expect(screen.getByRole("treeitem", { name: /Review output/ })).toHaveAttribute("aria-level", "2");
  });

  it("inspects details and navigates known workspace resources", () => {
    const onOpenWorkspace = vi.fn();
    render(<WorkPlanPanel plan={plan} open onToggle={() => {}} onOpenWorkspace={onOpenWorkspace} />);
    fireEvent.click(screen.getByRole("treeitem", { name: /Build UI/ }));
    expect(screen.getByText("Keep the plan readable.")).toBeTruthy();
    expect(screen.getByLabelText("Task details").textContent).toContain("Depends on: Analyse impact");
    fireEvent.click(screen.getByRole("button", { name: "App" }));
    expect(onOpenWorkspace).toHaveBeenCalledWith("ui/src/App.tsx");
  });

  it("keeps an unresolved generic resource visible but not clickable", () => {
    render(<WorkPlanPanel plan={plan} open onToggle={() => {}} onOpenWorkspace={() => {}} />);
    fireEvent.click(screen.getByRole("treeitem", { name: /Review output/ }));
    expect(screen.getByText("Needs human acceptance")).toBeTruthy();
    expect(screen.getByText("SYS-421").tagName).toBe("SPAN");
    fireEvent.click(screen.getByRole("treeitem", { name: /Publish/ }));
    expect(screen.getByText("Credentials unavailable")).toBeTruthy();
  });

  it("does not make a traversing workspace reference navigable", () => {
    const unsafe: WorkPlan = {
      ...plan,
      tasks: [{ ...plan.tasks[0], resources: [{ uri: "workspace:../../etc/passwd", label: "outside" }] }],
    };
    const onOpenWorkspace = vi.fn();
    render(<WorkPlanPanel plan={unsafe} open onToggle={() => {}} onOpenWorkspace={onOpenWorkspace} />);
    fireEvent.click(screen.getByRole("treeitem", { name: /Analyse impact/ }));
    expect(screen.getByText("outside").tagName).toBe("SPAN");
    expect(onOpenWorkspace).not.toHaveBeenCalled();
  });

  it("previews task lines from the collapsed progress control before opening details", () => {
    const onToggle = vi.fn();
    render(<WorkPlanPanel plan={plan} open={false} onToggle={onToggle} onOpenWorkspace={() => {}} />);
    const control = screen.getByRole("button", { name: "Open Work Plan" });
    const preview = screen.getByRole("tooltip");
    expect(control).toHaveAttribute("aria-describedby", preview.id);
    expect(preview).toHaveClass("hidden");
    fireEvent.mouseEnter(control.parentElement!);
    expect(preview).toHaveClass("block");
    expect(preview.textContent).toContain("Analyse impact");
    expect(preview.textContent).toContain("Build UI");
    expect(preview.textContent).toContain("Review output");
    expect(preview.textContent).toContain("Publish");
    expect(preview.querySelectorAll("li")).toHaveLength(4);
    expect(screen.getByLabelText("Done").textContent).toBe("☑");
    expect(screen.getByLabelText("In progress").textContent).toBe("☐");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(preview).toHaveClass("hidden");
    fireEvent.click(control);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("selects a task requested by Outcome and reports one that disappeared", async () => {
    const handled = vi.fn();
    const { rerender } = render(<WorkPlanPanel plan={plan} open onToggle={() => {}} onOpenWorkspace={() => {}} requestedTaskId="build" onTaskRequestHandled={handled} />);
    await waitFor(() => expect(screen.getByRole("treeitem", { name: /Build UI/ })).toHaveAttribute("aria-selected", "true"));
    expect(handled).toHaveBeenCalled();
    rerender(<WorkPlanPanel plan={plan} open onToggle={() => {}} onOpenWorkspace={() => {}} requestedTaskId="removed" onTaskRequestHandled={handled} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/no longer exists/i));
  });

  it("does not replay a handled request over what the reader selected afterwards", async () => {
    // The agent rewrites the plan constantly. A request left standing would be
    // re-applied on each of those updates and pull the selection back. The
    // wrapper mirrors what App does: hold the request, drop it once applied.
    function Host({ plan: current }: { plan: WorkPlan }) {
      const [requestedTaskId, setRequestedTaskId] = useState<string | null>("build");
      const clear = useCallback(() => setRequestedTaskId(null), []);
      return <WorkPlanPanel plan={current} open onToggle={() => {}} onOpenWorkspace={() => {}} requestedTaskId={requestedTaskId} onTaskRequestHandled={clear} />;
    }
    const { rerender } = render(<Host plan={plan} />);
    await waitFor(() => expect(screen.getByRole("treeitem", { name: /Build UI/ })).toHaveAttribute("aria-selected", "true"));

    fireEvent.click(screen.getByRole("treeitem", { name: /Publish/ }));
    expect(screen.getByRole("treeitem", { name: /Publish/ })).toHaveAttribute("aria-selected", "true");

    const updated: WorkPlan = { ...plan, updatedAt: "2026-08-24T00:00:00.000Z", tasks: plan.tasks.map((task) => ({ ...task })) };
    rerender(<Host plan={updated} />);
    await waitFor(() => expect(screen.getByRole("treeitem", { name: /Publish/ })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("treeitem", { name: /Build UI/ })).toHaveAttribute("aria-selected", "false");
  });
});
