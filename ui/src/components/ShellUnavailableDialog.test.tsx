import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ConfinementVerdict } from "@pi-outpost/shared";
import { ShellUnavailableDialog, shellNoticeKey, shellNoticeSeen, UNCONFINE_COMMAND } from "./ShellUnavailableDialog";
import { ModelBar } from "./ModelBar";

type Unavailable = Extract<ConfinementVerdict, { state: "unavailable" }>;

const windowsUpdate: Unavailable = {
  state: "unavailable",
  runner: "mxc",
  reason:
    "The agent's shell is unavailable on this machine: this Windows (build 26100.6584) lacks the August 2026 cumulative update (KB5120998) (build 26100.9278), without which MXC cannot confine a command, and no command runs unconfined. Update Windows to build 26100.9278 or later, then restart pi-outpost.",
  remedy: { kind: "windows-update", build: "26100.6584", needed: "26100.9278", update: "the August 2026 cumulative update (KB5120998)" },
};
const before24H2: Unavailable = {
  state: "unavailable",
  runner: "mxc",
  reason: "The agent's shell is unavailable on this machine: this Windows (build 22631.4890) lacks Windows 11 24H2 or later, …",
  remedy: { kind: "windows-update", build: "22631.4890", needed: "26100.9278", update: "Windows 11 24H2 or later, with the August 2026 cumulative update (KB5120998)" },
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
  it("names the missing update, what it means, and two ways out side by side — the update, and the command to run unconfined with its cost — and runs neither", () => {
    render(<ShellUnavailableDialog verdict={windowsUpdate} onClose={() => {}} />);
    const dialog = screen.getByRole("alertdialog", { name: "The agent has no shell on this machine" });
    expect(dialog).toHaveTextContent("This Windows (build 26100.6584) lacks the August 2026 cumulative update (KB5120998)");
    expect(dialog).toHaveTextContent("the agent can read and edit the project's files, but not run a command");
    expect(screen.getByTestId("shell-unavailable-update")).toHaveTextContent("Update Windows to build 26100.9278 or later, then restart pi-outpost");
    const unconfine = screen.getByTestId("shell-unavailable-unconfine");
    expect(unconfine).toHaveTextContent("If you cannot update Windows, run commands unconfined");
    expect(unconfine).toHaveTextContent(UNCONFINE_COMMAND);
    expect(unconfine).toHaveTextContent('"sandbox.bashRunner": "none"');
    expect(unconfine).toHaveTextContent("every right of your account: they can read, change and delete any file you can, outside the project too");
    expect(unconfine).toHaveTextContent("pi-outpost config --confine confines them again");
    // Generic words: whoever decides about this machine's updates, the dialog does not guess.
    expect(dialog).not.toHaveTextContent(/IT department|administrator/i);
    expect(screen.getByTestId("shell-unavailable-windows-update")).toHaveAttribute("href", "ms-settings:windowsupdate");
    // Loosening the sandbox stays a line in the file: nothing here sets it.
    expect(screen.queryByRole("button", { name: /unconfine|none/i })).toBeNull();
    expect(screen.getByTestId("shell-unavailable-continue")).toHaveFocus();
  });

  it("before 24H2, names the version Windows must move to, not an update it cannot take", () => {
    render(<ShellUnavailableDialog verdict={before24H2} onClose={() => {}} />);
    expect(screen.getByTestId("shell-unavailable-cause")).toHaveTextContent("This Windows (build 22631.4890) lacks Windows 11 24H2 or later, with the August 2026 cumulative update (KB5120998)");
    expect(screen.getByTestId("shell-unavailable-update")).toHaveTextContent("Update Windows to build 26100.9278 or later");
    expect(screen.getByTestId("shell-unavailable-unconfine")).toHaveTextContent(UNCONFINE_COMMAND);
  });

  it("for another cause, gives the server's reason, the command to run unconfined, and no Windows Update", () => {
    render(<ShellUnavailableDialog verdict={otherCause} onClose={() => {}} />);
    expect(screen.getByTestId("shell-unavailable-cause")).toHaveTextContent("MXC's parts are not installed");
    expect(screen.queryByTestId("shell-unavailable-windows-update")).toBeNull();
    expect(screen.queryByTestId("shell-unavailable-update")).toBeNull();
    expect(screen.getByTestId("shell-unavailable-unconfine")).toHaveTextContent(`Run commands unconfined. On this machine, run${UNCONFINE_COMMAND}`);
  });

  it("copies the command, and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ShellUnavailableDialog verdict={windowsUpdate} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("shell-unavailable-copy"));
    expect(writeText).toHaveBeenCalledWith("pi-outpost config --unconfine");
    expect(await screen.findByText("copied")).toBeInTheDocument();
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
