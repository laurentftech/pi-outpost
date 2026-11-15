import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SandboxRulesState } from "@pi-outpost/shared";
import { SandboxRulesPanel } from "./SandboxRulesPanel";

const state = (overrides: Partial<SandboxRulesState> = {}): SandboxRulesState => ({
  enabled: true,
  files: "reported",
  rules: [{ id: "r1", kind: "host", target: "example.com", decision: "allow", createdAt: "2026-11-15T10:00:00Z" }],
  refusals: [
    { key: "directory:read:/work/other", kind: "directory", target: "/work/other", access: "read", command: "cat /work/other/x", count: 2, lastSeen: "2026-11-15T10:00:00Z" },
    { key: "directory:read:/home/u/.pi/agent", kind: "directory", target: "/home/u/.pi/agent", access: "read", command: "cat auth.json", count: 1, lastSeen: "2026-11-15T10:00:00Z", notAllowable: "never granted: the agent directory holds the provider keys" },
    { key: "host:example.com", kind: "host", target: "example.com", command: "curl", count: 1, lastSeen: "2026-11-15T10:00:00Z", ruleId: "r1" },
    { key: "info:[::1]:0", kind: "info", target: "[::1]:0", detail: "network bind", command: "python3 -m venv", count: 1, lastSeen: "2026-11-15T10:00:00Z", notAllowable: "no rule can name it" },
  ],
  ...overrides,
});

const row = (key: string) => document.querySelector(`[data-refusal-key="${CSS.escape(key)}"]`) as HTMLElement;

describe("the sandbox rules panel", () => {
  // openlore: scenario=RulesAreListedAndRevoked spec=sandbox-durable-rules
  it("lists each rule and revokes it in one click", () => {
    const onRevoke = vi.fn();
    render(<SandboxRulesPanel state={state()} error={null} onSet={() => {}} onRevoke={onRevoke} />);
    const list = screen.getByTestId("sandbox-rules-list");
    expect(list.textContent).toContain("Always allow host example.com");
    fireEvent.click(within(list).getByRole("button", { name: "Revoke" }));
    expect(onRevoke).toHaveBeenCalledWith("r1");
  });

  // openlore: scenario=ARuleIsMadeFromARecordedRefusal spec=sandbox-durable-rules
  it("makes a rule from a recorded refusal, and shows which ones a rule covers", () => {
    const onSet = vi.fn();
    render(<SandboxRulesPanel state={state()} error={null} onSet={onSet} onRevoke={() => {}} />);
    fireEvent.click(within(row("directory:read:/work/other")).getByRole("button", { name: "Always allow" }));
    expect(onSet).toHaveBeenCalledWith("directory:read:/work/other", "allow");
    fireEvent.click(within(row("directory:read:/work/other")).getByRole("button", { name: "Always refuse" }));
    expect(onSet).toHaveBeenCalledWith("directory:read:/work/other", "refuse");
    expect(row("host:example.com").textContent).toContain("A rule of yours covers it");
    expect(within(row("host:example.com")).queryByRole("button")).toBeNull();
    expect(row("directory:read:/work/other").textContent).toContain("2×");
  });

  // openlore: scenario=TheAgentDirectoryTakesNoRule spec=sandbox-durable-rules
  it("offers no always allow on what is never granted, and says why; information takes no rule at all", () => {
    render(<SandboxRulesPanel state={state()} error={null} onSet={() => {}} onRevoke={() => {}} />);
    const keys = row("directory:read:/home/u/.pi/agent");
    expect(within(keys).queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(within(keys).getByTestId("sandbox-refusal-not-allowable").textContent).toMatch(/the agent directory holds the provider keys/);
    expect(within(row("info:[::1]:0")).queryByRole("button")).toBeNull();
  });

  // openlore: scenario=ARunnerThatReportsNothingSaysSo spec=sandbox-durable-rules
  // openlore: scenario=ARunnerThatReportsOnDemandSaysSo spec=sandbox-durable-rules
  it("says when the runner does not report refused files, or only on a diagnosis, rather than an empty list alone", () => {
    const { rerender } = render(<SandboxRulesPanel state={state({ files: "not-reported", refusals: [] })} error={null} onSet={() => {}} onRevoke={() => {}} />);
    expect(screen.getByTestId("sandbox-rules-files").textContent).toMatch(/does not report refused files/);
    rerender(<SandboxRulesPanel state={state({ files: "on-demand", refusals: [] })} error={null} onSet={() => {}} onRevoke={() => {}} />);
    expect(screen.getByTestId("sandbox-rules-files").textContent).toMatch(/only when the agent asks for a diagnosis/);
    rerender(<SandboxRulesPanel state={state({ files: "reported" })} error={null} onSet={() => {}} onRevoke={() => {}} />);
    expect(screen.queryByTestId("sandbox-rules-files")).toBeNull();
  });

  // openlore: scenario=NeverMeansNoRules spec=sandbox-durable-rules
  it("with rules off, says so and offers no way to make one", () => {
    render(<SandboxRulesPanel state={state({ enabled: false })} error={null} onSet={() => {}} onRevoke={() => {}} />);
    expect(screen.getByTestId("sandbox-rules-off").textContent).toMatch(/Rules are off/);
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Always refuse" })).toBeNull();
  });

  it("shows why a rule was refused, and waits while the rules are not yet known", () => {
    const { rerender } = render(<SandboxRulesPanel state={null} error={null} onSet={() => {}} onRevoke={() => {}} />);
    expect(screen.getByTestId("sandbox-rules-panel").getAttribute("data-loading")).toBe("true");
    rerender(<SandboxRulesPanel state={state()} error="Always allow is not offered for /x" onSet={() => {}} onRevoke={() => {}} />);
    expect(screen.getByRole("alert").textContent).toBe("Always allow is not offered for /x");
  });
});
