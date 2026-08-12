import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { GitLogEntry } from "@pi-outpost/shared";
import { GitMenu } from "./GitMenu";
import type { GitStatusState } from "../useAgent";

function status(overrides: Partial<GitStatusState> = {}): GitStatusState {
  return { branch: "main", ahead: 0, behind: 0, files: {}, ...overrides };
}

const LOG: GitLogEntry[] = [
  { sha: "aaaaaaa1111", author: "Ada", date: new Date().toISOString(), subject: "most recent" },
  { sha: "bbbbbbb2222", author: "Grace", date: new Date(Date.now() - 3 * 86400_000).toISOString(), subject: "three days back" },
];

function setup(props: Partial<React.ComponentProps<typeof GitMenu>> = {}) {
  const onFetchLog = vi.fn();
  const onShowCommit = vi.fn();
  const view = render(<GitMenu status={status()} log={LOG} onFetchLog={onFetchLog} onShowCommit={onShowCommit} {...props} />);
  return { onFetchLog, onShowCommit, ...view };
}

/** The branch chip, which is also the menu's toggle. */
function chip() {
  return screen.getByRole("button", { name: /⎇/ });
}

describe("GitMenu", () => {
  it("shows the current branch", () => {
    setup();
    expect(chip()).toHaveTextContent("main");
  });

  it("waits for the branch rather than inventing one", () => {
    setup({ status: null });
    expect(chip()).toHaveTextContent("…");
  });

  it("shows ahead and behind counts only when there is something to report", () => {
    const { rerender } = setup();
    expect(chip()).not.toHaveTextContent("↑");
    rerender(<GitMenu status={status({ ahead: 2, behind: 3 })} log={LOG} onFetchLog={vi.fn()} onShowCommit={vi.fn()} />);
    expect(chip()).toHaveTextContent("↑2");
    expect(chip()).toHaveTextContent("↓3");
  });

  it("keeps the menu closed until asked", () => {
    setup();
    expect(screen.queryByText("most recent")).not.toBeInTheDocument();
  });

  it("fetches the log when it opens, not on every render", () => {
    const { onFetchLog, rerender } = setup();
    expect(onFetchLog).not.toHaveBeenCalled();
    fireEvent.click(chip());
    expect(onFetchLog).toHaveBeenCalledTimes(1);
    rerender(<GitMenu status={status()} log={LOG} onFetchLog={onFetchLog} onShowCommit={vi.fn()} />);
    expect(onFetchLog).toHaveBeenCalledTimes(1);
  });

  it("lists the commits once open", () => {
    setup();
    fireEvent.click(chip());
    expect(screen.getByText("most recent")).toBeInTheDocument();
    expect(screen.getByText("three days back")).toBeInTheDocument();
  });

  it("abbreviates the commit id", () => {
    setup();
    fireEvent.click(chip());
    expect(screen.getByText("aaaaaaa")).toBeInTheDocument();
    expect(screen.queryByText("aaaaaaa1111")).not.toBeInTheDocument();
  });

  it("dates commits relative to now", () => {
    setup();
    fireEvent.click(chip());
    expect(screen.getByText(/Ada · now/)).toBeInTheDocument();
    expect(screen.getByText(/Grace · 3d ago/)).toBeInTheDocument();
  });

  it("reports the chosen commit and closes", () => {
    const { onShowCommit } = setup();
    fireEvent.click(chip());
    fireEvent.click(screen.getByText("three days back"));
    expect(onShowCommit).toHaveBeenCalledWith("bbbbbbb2222");
    expect(screen.queryByText("three days back")).not.toBeInTheDocument();
  });

  it("says it is loading rather than showing an empty list", () => {
    setup({ log: null });
    fireEvent.click(chip());
    expect(screen.getByText("loading…")).toBeInTheDocument();
  });

  it("distinguishes a repository with no commits from one still loading", () => {
    setup({ log: [] });
    fireEvent.click(chip());
    expect(screen.getByText("no commits")).toBeInTheDocument();
    expect(screen.queryByText("loading…")).not.toBeInTheDocument();
  });

  it("closes when the pointer goes down outside it", () => {
    setup();
    fireEvent.click(chip());
    expect(screen.getByText("most recent")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("most recent")).not.toBeInTheDocument();
  });

  it("stays open when the pointer goes down inside it", () => {
    setup();
    fireEvent.click(chip());
    fireEvent.mouseDown(within(screen.getByText("most recent")).getByText("most recent"));
    expect(screen.getByText("most recent")).toBeInTheDocument();
  });
});
