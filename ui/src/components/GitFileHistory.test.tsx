import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { GitFileLogEntry, GitRevision } from "@pi-outpost/shared";
import { GitFileHistory } from "./GitFileHistory";
import type { GitFileDiffState, GitFileHistoryState } from "../useAgent";

function entry(sha: string, parents: string[], subject: string): GitFileLogEntry {
  return { sha, parents, author: "Ada", date: new Date().toISOString(), subject, path: "notes.txt", added: 3, deleted: 1 };
}

const ENTRIES = [entry("aaaaaaa1", ["bbbbbbb2"], "latest change"), entry("bbbbbbb2", ["ccccccc3"], "middle change"), entry("ccccccc3", [], "first commit")];

function loaded(overrides: Partial<GitFileHistoryState> = {}): GitFileHistoryState {
  return { path: "notes.txt", status: "loaded", entries: ENTRIES, requestId: "r1", ...overrides };
}

function setup(props: Partial<React.ComponentProps<typeof GitFileHistory>> = {}) {
  const onFetchDiff = vi.fn();
  const onClearDiff = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <GitFileHistory history={loaded()} diff={null} dirty={false} onFetchDiff={onFetchDiff} onClearDiff={onClearDiff} onClose={onClose} {...props} />,
  );
  return { onFetchDiff, onClearDiff, onClose, ...view };
}

/** The row whose accessible name carries this text. */
function row(text: string) {
  return screen.getByRole("button", { name: new RegExp(text) });
}

describe("GitFileHistory", () => {
  it("lists the file's commits newest first, with the working tree on top", () => {
    setup();
    const rows = within(screen.getByRole("group", { name: "Commits" })).getAllByRole("button", { name: /Working tree|change|commit/ });
    expect(rows[0]).toHaveAttribute("aria-label", "Working tree");
    expect(rows[1]).toHaveAttribute("aria-label", expect.stringContaining("latest change"));
  });

  it("spells out the line counts for a screen reader", () => {
    setup();
    expect(screen.getAllByLabelText("3 lines added, 1 removed").length).toBe(ENTRIES.length);
  });

  it("shows what a commit did to the file in one click", async () => {
    const { onFetchDiff } = setup();
    fireEvent.click(row("middle change"));
    // Target is the commit, base is its parent — the commit's own effect
    expect(onFetchDiff).toHaveBeenCalledWith({ rev: "ccccccc3", path: "notes.txt" }, { rev: "bbbbbbb2", path: "notes.txt" });
  });

  it("compares any two revisions when the roles are named", async () => {
    const { onFetchDiff } = setup();
    fireEvent.click(within(row("first commit")).getByRole("button", { name: "base" }));
    fireEvent.click(within(row("Working tree")).getByRole("button", { name: "target" }));
    expect(onFetchDiff).toHaveBeenCalledWith({ rev: "ccccccc3", path: "notes.txt" }, { rev: "worktree", path: "notes.txt" });
  });

  it("replaces a slot instead of accumulating", async () => {
    const { onFetchDiff } = setup();
    fireEvent.click(within(row("first commit")).getByRole("button", { name: "base" }));
    fireEvent.click(within(row("middle change")).getByRole("button", { name: "base" }));
    fireEvent.click(within(row("latest change")).getByRole("button", { name: "target" }));
    expect(onFetchDiff).toHaveBeenCalledTimes(1);
    expect(onFetchDiff).toHaveBeenCalledWith({ rev: "bbbbbbb2", path: "notes.txt" }, { rev: "aaaaaaa1", path: "notes.txt" });
  });

  it("asks for a pair once, however often the parent re-renders", () => {
    // useAgent hands back inline callbacks, so every parent render gives this
    // component new prop identities. An effect depending on them would loop:
    // request → loading state → render → request, which the pane shows as a
    // flicker between its loading and loaded styling.
    const onFetchDiff = vi.fn();
    const props = () => ({
      history: loaded(),
      diff: null,
      dirty: false,
      onFetchDiff: (base: GitRevision, target: GitRevision) => onFetchDiff(base, target),
      onClearDiff: () => {},
      onClose: () => {},
    });
    const { rerender } = render(<GitFileHistory {...props()} />);
    fireEvent.click(row("middle change"));
    expect(onFetchDiff).toHaveBeenCalledTimes(1);
    rerender(<GitFileHistory {...props()} />);
    rerender(<GitFileHistory {...props()} />);
    expect(onFetchDiff).toHaveBeenCalledTimes(1);
  });

  it("swaps rather than putting both roles on one revision", async () => {
    const { onFetchDiff } = setup();
    fireEvent.click(within(row("first commit")).getByRole("button", { name: "base" }));
    fireEvent.click(within(row("latest change")).getByRole("button", { name: "target" }));
    onFetchDiff.mockClear();
    // Claiming "target" on the row that is already the base has to move something:
    // silently refusing reads as a broken button
    fireEvent.click(within(row("first commit")).getByRole("button", { name: "target" }));
    expect(onFetchDiff).toHaveBeenCalledWith({ rev: "aaaaaaa1", path: "notes.txt" }, { rev: "ccccccc3", path: "notes.txt" });
  });

  it("never lands both roles on the same revision, whatever the keypress", () => {
    // Enter on a role button fires the button *and* bubbles to the row, whose own
    // handler used to run a plain selection: one keypress, two roles, both on the
    // same commit — and a pane stuck on "Loading…" because that pair is unfetchable
    const { onFetchDiff } = setup();
    const roleButton = within(row("middle change")).getByRole("button", { name: "base" });
    roleButton.focus();
    fireEvent.keyDown(roleButton, { key: "Enter" });
    fireEvent.click(roleButton);
    expect(screen.queryByLabelText(/Comparing (\w+) to \1/)).not.toBeInTheDocument();
    expect(onFetchDiff).not.toHaveBeenCalled();
  });

  it("swaps the pair and re-renders in the opposite direction", async () => {
    const { onFetchDiff } = setup();
    fireEvent.click(within(row("first commit")).getByRole("button", { name: "base" }));
    fireEvent.click(within(row("latest change")).getByRole("button", { name: "target" }));
    onFetchDiff.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /swap/ }));
    expect(onFetchDiff).toHaveBeenCalledWith({ rev: "aaaaaaa1", path: "notes.txt" }, { rev: "ccccccc3", path: "notes.txt" });
  });

  it("returns to the prompt when the selection is cleared", async () => {
    const { onClearDiff } = setup();
    fireEvent.click(row("middle change"));
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(onClearDiff).toHaveBeenCalled();
    expect(screen.getByText("Pick a commit to see what changed.")).toBeInTheDocument();
  });

  it("names the pair the diff belongs to", async () => {
    setup();
    fireEvent.click(within(row("first commit")).getByRole("button", { name: "base" }));
    fireEvent.click(within(row("Working tree")).getByRole("button", { name: "target" }));
    expect(screen.getByLabelText("Comparing ccccccc to working tree")).toBeInTheDocument();
  });

  it("sets a role from the keyboard", async () => {
    const { onFetchDiff } = setup();
    const list = row("Working tree").parentElement!;
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(row("middle change"), { key: "b" });
    fireEvent.keyDown(row("latest change"), { key: "t" });
    expect(onFetchDiff).toHaveBeenCalledWith({ rev: "bbbbbbb2", path: "notes.txt" }, { rev: "aaaaaaa1", path: "notes.txt" });
  });

  it("closes on Escape without letting the viewer beneath also close", async () => {
    const viewerSawEscape = vi.fn();
    document.addEventListener("keydown", viewerSawEscape, true);
    try {
      const { onClose } = setup();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", viewerSawEscape, true);
    }
  });

  it("prompts for a second revision when only one is picked", async () => {
    setup();
    fireEvent.click(within(row("first commit")).getByRole("button", { name: "base" }));
    expect(screen.getByText("Now pick the version to compare it against.")).toBeInTheDocument();
  });

  it("says so rather than rendering an empty diff for identical versions", () => {
    const diff: GitFileDiffState = {
      base: { rev: "aaaaaaa1", path: "notes.txt" },
      target: { rev: "bbbbbbb2", path: "notes.txt" },
      status: "loaded",
      beforeText: "same\n",
      afterText: "same\n",
      requestId: "d1",
    };
    setup({ diff });
    fireEvent.click(within(row("middle change")).getByRole("button", { name: "base" }));
    fireEvent.click(within(row("latest change")).getByRole("button", { name: "target" }));
    expect(screen.getByText("These two versions are identical.")).toBeInTheDocument();
  });

  it("keeps the list usable when a diff fails", async () => {
    const diff: GitFileDiffState = {
      base: { rev: "aaaaaaa1", path: "notes.txt" },
      target: { rev: "bbbbbbb2", path: "notes.txt" },
      status: "error",
      beforeText: "",
      afterText: "",
      error: "Binary file — diff not supported",
      requestId: "d1",
    };
    const { onFetchDiff } = setup({ diff });
    fireEvent.click(within(row("first commit")).getByRole("button", { name: "base" }));
    fireEvent.click(within(row("latest change")).getByRole("button", { name: "target" }));
    expect(onFetchDiff).toHaveBeenCalled();
    expect(screen.getByText("Binary file — diff not supported")).toBeInTheDocument();
  });

  it("reports a history that could not be read, in the pane", () => {
    render(
      <GitFileHistory
        history={loaded({ status: "error", entries: [], error: "fatal: not a git repository" })}
        diff={null}
        dirty={false}
        onFetchDiff={vi.fn()}
        onClearDiff={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("fatal: not a git repository")).toBeInTheDocument();
  });

  it("says a brand-new file has no history yet", () => {
    render(
      <GitFileHistory
        history={loaded({ entries: [] })}
        diff={null}
        dirty={false}
        onFetchDiff={vi.fn()}
        onClearDiff={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No commits touch this file yet.")).toBeInTheDocument();
  });
});
