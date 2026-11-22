import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ProjectExtensionDecision, ProjectExtensionQuestion } from "@pi-outpost/shared";
import { ExtensionApprovalDialog } from "./ExtensionApprovalDialog";
import { ProjectExtensionDecisions } from "./ProjectExtensionDecisions";

const file: ProjectExtensionQuestion = { id: "q1", kind: "file", label: ".pi/extensions/x.ts", path: ".pi/extensions/x.ts", size: 2048 };
const pkg: ProjectExtensionQuestion = { id: "q2", kind: "package", label: "npm:some-pi-package@1.0.0" };

describe("ExtensionApprovalDialog", () => {
  // openlore: scenario=AllowingLoadsIt spec=project-extension-approval
  it("names the extension, says it runs outside the sandbox, and answers once", () => {
    const onAnswer = vi.fn();
    const onView = vi.fn();
    render(<ExtensionApprovalDialog question={file} remaining={1} onAnswer={onAnswer} onView={onView} />);
    expect(screen.getByTestId("extension-approval-label")).toHaveTextContent(".pi/extensions/x.ts");
    expect(screen.getByTestId("extension-approval-warning")).toHaveTextContent("It would run outside the sandbox, with every right of your account");
    expect(screen.getByRole("region")).toHaveTextContent("2.0 KB");
    expect(screen.getByRole("region")).toHaveTextContent("1 more after this one.");
    fireEvent.click(screen.getByTestId("extension-approval-view"));
    expect(onView).toHaveBeenCalledWith(".pi/extensions/x.ts");
    fireEvent.click(screen.getByTestId("extension-approval-allow"));
    fireEvent.click(screen.getByTestId("extension-approval-allow"));
    fireEvent.click(screen.getByTestId("extension-approval-refuse"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("q1", "allow");
  });

  // openlore: scenario=RefusingIsRemembered spec=project-extension-approval
  it("refuses, and for a package names its install scripts and offers no code to view", () => {
    const onAnswer = vi.fn();
    render(<ExtensionApprovalDialog question={pkg} remaining={0} onAnswer={onAnswer} onView={vi.fn()} />);
    expect(screen.getByRole("heading")).toHaveTextContent("This project asks pi to install a package");
    expect(screen.getByTestId("extension-approval-warning")).toHaveTextContent("its install scripts, would run outside the sandbox");
    expect(screen.queryByTestId("extension-approval-view")).toBeNull();
    fireEvent.click(screen.getByTestId("extension-approval-refuse"));
    expect(onAnswer).toHaveBeenCalledWith("q2", "refuse");
  });

  it("a new question in the same place starts unanswered", () => {
    const onAnswer = vi.fn();
    const { rerender } = render(<ExtensionApprovalDialog question={file} remaining={1} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByTestId("extension-approval-allow"));
    rerender(<ExtensionApprovalDialog question={{ ...file, id: "q3", label: ".pi/extensions/y.ts", path: ".pi/extensions/y.ts" }} remaining={0} onAnswer={onAnswer} />);
    expect(screen.getByTestId("extension-approval-allow")).not.toBeDisabled();
  });
});

describe("ProjectExtensionDecisions", () => {
  const decisions: ProjectExtensionDecision[] = [
    { kind: "file", key: "C:\\p\\.pi\\extensions\\x.ts", label: ".pi/extensions/x.ts", decision: "allow", decidedAt: "2026-11-22T10:00:00Z" },
    { kind: "package", key: "npm:bad@1.0.0", label: "npm:bad@1.0.0", decision: "refuse", decidedAt: "2026-11-22T10:01:00Z" },
  ];

  it("asks for the decisions when shown, lists each, and withdraws one", () => {
    const onLoad = vi.fn();
    const onWithdraw = vi.fn();
    render(<ProjectExtensionDecisions decisions={decisions} onLoad={onLoad} onWithdraw={onWithdraw} />);
    expect(onLoad).toHaveBeenCalledTimes(1);
    const rows = screen.getAllByTestId("extension-decision");
    expect(rows.map((row) => row.getAttribute("data-decision"))).toEqual(["allow", "refuse"]);
    expect(rows[0]).toHaveTextContent("allowed.pi/extensions/x.ts");
    fireEvent.click(screen.getAllByTestId("extension-decision-withdraw")[1]);
    expect(onWithdraw).toHaveBeenCalledWith("package", "npm:bad@1.0.0");
  });

  it("shows nothing before an answer, or with no decision", () => {
    const { container, rerender } = render(<ProjectExtensionDecisions decisions={null} onLoad={() => {}} onWithdraw={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ProjectExtensionDecisions decisions={[]} onLoad={() => {}} onWithdraw={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
