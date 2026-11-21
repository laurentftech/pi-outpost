import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ConfinementVerdict } from "@pi-outpost/shared";
import { ShellUnavailableDialog, shellNoticeKey, shellNoticeSeen } from "./ShellUnavailableDialog";
import { ModelBar } from "./ModelBar";

type Unavailable = Extract<ConfinementVerdict, { state: "unavailable" }>;

const windowsUpdate: Unavailable = {
  state: "unavailable",
  runner: "mxc",
  reason:
    "The agent's shell is unavailable on this machine: this Windows (build 26100.6584) lacks the August 2026 cumulative update (KB5120998) (build 26100.9278), without which MXC cannot confine a command, and no command runs unconfined. Install it with Windows Update, then restart pi-outpost.",
  remedy: { kind: "windows-update", build: "26100.6584", needed: "26100.9278", update: "the August 2026 cumulative update (KB5120998)" },
};
const otherCause: Unavailable = {
  state: "unavailable",
  runner: "",
  reason: "The agent's shell is unavailable: nothing can confine it on this machine — MXC's parts are not installed. No command runs unconfined.",
};

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("ShellUnavailableDialog", () => {
  // openlore: scenario=AMachineThatCannotConfineIsSaidOnce spec=sandbox-defaults
  it("names the missing update, what it means, what to do, and the way round with its cost — and offers no unconfined switch", () => {
    render(<ShellUnavailableDialog verdict={windowsUpdate} onClose={() => {}} />);
    const dialog = screen.getByRole("alertdialog", { name: "The agent has no shell on this machine" });
    expect(dialog).toHaveTextContent("This Windows (build 26100.6584) lacks the August 2026 cumulative update (KB5120998)");
    expect(dialog).toHaveTextContent("the agent can read and edit the project's files, but not run a command");
    expect(dialog).toHaveTextContent("install the update with Windows Update (build 26100.9278 or later), then restart pi-outpost");
    expect(dialog).toHaveTextContent('"sandbox.bashRunner": "none"');
    expect(dialog).toHaveTextContent("every right of your account");
    expect(screen.getByTestId("shell-unavailable-windows-update")).toHaveAttribute("href", "ms-settings:windowsupdate");
    // Loosening the sandbox stays a line in the file: nothing here sets it.
    expect(screen.queryByRole("button", { name: /unconfined|none/i })).toBeNull();
    expect(screen.getByTestId("shell-unavailable-continue")).toHaveFocus();
  });

  it("for another cause, gives the server's reason and no Windows Update button", () => {
    render(<ShellUnavailableDialog verdict={otherCause} onClose={() => {}} />);
    expect(screen.getByTestId("shell-unavailable-cause")).toHaveTextContent("MXC's parts are not installed");
    expect(screen.queryByTestId("shell-unavailable-windows-update")).toBeNull();
  });

  it("closing it — the button or Escape — remembers that cause in this browser, and only that one", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ShellUnavailableDialog verdict={windowsUpdate} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("shell-unavailable-continue"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(shellNoticeSeen(shellNoticeKey(windowsUpdate))).toBe(true);
    expect(shellNoticeSeen(shellNoticeKey(otherCause))).toBe(false);
    unmount();
    render(<ShellUnavailableDialog verdict={otherCause} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(shellNoticeSeen(shellNoticeKey(otherCause))).toBe(true);
  });
});

describe("the padlock of a shell that cannot be confined", () => {
  const bar = (shellConfinement: ConfinementVerdict, onShellUnavailable?: () => void) =>
    render(
      <ModelBar
        model="m/x"
        models={[]}
        thinkingLevel="off"
        thinkingLevels={[]}
        modelSupportsReasoning={false}
        isStreaming={false}
        contextUsage={null}
        sessionUsage={{ turns: 0, unpriced: 0 } as never}
        analysisOpen={false}
        onToggleAnalysis={() => {}}
        isCompacting={false}
        onSetModel={() => {}}
        onSetThinking={() => {}}
        onCompact={() => {}}
        shellConfinement={shellConfinement}
        {...(onShellUnavailable ? { onShellUnavailable } : {})}
      />,
    );

  it("says the cause when it is an update, and opens the notice again", () => {
    const open = vi.fn();
    bar(windowsUpdate, open);
    expect(screen.getByTestId("shell-confinement")).toHaveTextContent("⛔ shell unavailable — Windows update needed");
    fireEvent.click(screen.getByRole("button", { name: "Why the agent has no shell" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("for another cause says unavailable alone", () => {
    bar(otherCause);
    expect(screen.getByTestId("shell-confinement")).toHaveTextContent("⛔ shell unavailable");
    expect(screen.getByTestId("shell-confinement")).not.toHaveTextContent("Windows update");
  });
});
