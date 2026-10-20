import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { GitCommitLogEntry, GitRepoStatus } from "@pi-outpost/shared";
import { GitMenu } from "./GitMenu";
import { CURRENT_COLOR, laneX, ROW_H } from "./graph/lanes";
import type { GitStatusState } from "../useAgent";

/** One repository at the browser root — the shape a single-project workspace has. */
const ONE: GitRepoStatus[] = [{ repo: "", branch: "main", ahead: 0, behind: 0 }];

/** A directory of projects: the root is no repository, each child is one. */
const TWO: GitRepoStatus[] = [
  { repo: "projA", branch: "main", ahead: 0, behind: 0 },
  { repo: "projB", branch: "release", ahead: 1, behind: 2 },
];

function status(repos: GitRepoStatus[] = ONE): GitStatusState {
  return { repos, files: {} };
}

const ENTRIES: GitCommitLogEntry[] = [
  {
    sha: "aaaaaaa1111",
    author: "Ada",
    date: new Date().toISOString(),
    subject: "most recent",
    parents: ["bbbbbbb2222"],
    refs: ["main"],
    tags: [],
    head: true,
  },
  {
    sha: "bbbbbbb2222",
    author: "Grace",
    date: new Date(Date.now() - 3 * 86400_000).toISOString(),
    subject: "three days back",
    parents: [],
    refs: [],
    tags: [],
    head: false,
  },
];

/** A log answered BY `repo` — the menu shows it only under that repository's chip. */
const logFor = (repo: string, entries: GitCommitLogEntry[] | null = ENTRIES) =>
  entries === null ? null : { repo, entries };

/** The repository a browser-root-relative path belongs to, for the fixtures below. */
const repoOf = (selected: string | null) => (selected === null ? "" : selected.split("/")[0]);

const LOG = logFor("");

function setup(props: Partial<React.ComponentProps<typeof GitMenu>> = {}) {
  const onFetchLog = vi.fn();
  const onShowCommit = vi.fn();
  const view = render(
    <GitMenu status={status()} selected={null} log={LOG} onFetchLog={onFetchLog} onShowCommit={onShowCommit} {...props} />,
  );
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
    rerender(
      <GitMenu
        status={status([{ repo: "", branch: "main", ahead: 2, behind: 3 }])}
        selected={null}
        log={LOG}
        onFetchLog={vi.fn()}
        onShowCommit={vi.fn()}
      />,
    );
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
    rerender(<GitMenu status={status()} selected={null} log={LOG} onFetchLog={onFetchLog} onShowCommit={vi.fn()} />);
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
    expect(onShowCommit).toHaveBeenCalledWith("", "bbbbbbb2222");
    expect(screen.queryByText("three days back")).not.toBeInTheDocument();
  });

  it("says it is loading rather than showing an empty list", () => {
    setup({ log: null });
    fireEvent.click(chip());
    expect(screen.getByText("loading…")).toBeInTheDocument();
  });

  it("distinguishes a repository with no commits from one still loading", () => {
    setup({ log: logFor("", []) });
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

  it("keeps the whole subject reachable on hover, since the row truncates it", () => {
    setup();
    fireEvent.click(chip());

    expect(screen.getByText("most recent")).toHaveAttribute("title", "most recent");
  });

  describe("a workspace holding several repositories", () => {
    const render2 = (selected: string | null, handlers: Partial<React.ComponentProps<typeof GitMenu>> = {}) =>
      setup({ status: status(TWO), selected, log: logFor(repoOf(selected)), ...handlers });

    it("names the branch of the repository owning the selected file", () => {
      const { rerender, onFetchLog, onShowCommit } = render2("projA/src/main.ts");
      expect(chip()).toHaveTextContent("main");
      expect(chip()).not.toHaveTextContent("release");

      rerender(
        <GitMenu status={status(TWO)} selected="projB/README.md" log={logFor("projB")} onFetchLog={onFetchLog} onShowCommit={onShowCommit} />,
      );
      expect(chip()).toHaveTextContent("release");
      expect(chip()).toHaveTextContent("↑1");
      expect(chip()).toHaveTextContent("↓2");
    });

    it("names the project too, since one branch name no longer says which", () => {
      render2("projB/README.md");
      expect(chip()).toHaveTextContent("projB");
    });

    it("names no branch while nothing is selected, and stays on screen", () => {
      render2(null);
      expect(chip()).toBeInTheDocument();
      expect(chip()).toHaveTextContent("—");
      expect(chip()).not.toHaveTextContent("main");
      expect(chip()).not.toHaveTextContent("release");
    });

    // openlore: scenario=ASelectionUnderNoRepositoryNamesNothing spec=git
    it("names no branch when the selection is under no repository", () => {
      const { rerender, onFetchLog, onShowCommit } = render2("projA/src/main.ts");
      expect(chip()).toHaveTextContent("main");
      rerender(<GitMenu status={status(TWO)} selected="notes.md" log={logFor("")} onFetchLog={onFetchLog} onShowCommit={onShowCommit} />);
      expect(chip()).toBeInTheDocument();
      expect(chip()).toHaveTextContent("—");
      expect(chip()).not.toHaveTextContent("main");
    });

    // openlore: scenario=TheChipFollowsADirectoryToo spec=git
    it("follows a directory, not only a file", () => {
      const { rerender, onFetchLog, onShowCommit } = render2("projA/src/main.ts");
      expect(chip()).toHaveTextContent("main");
      rerender(<GitMenu status={status(TWO)} selected="projB" log={logFor("projB")} onFetchLog={onFetchLog} onShowCommit={onShowCommit} />);
      expect(chip()).toHaveTextContent("release");
      expect(chip()).toHaveTextContent("projB");
    });

    it("asks for the selected repository's log, and reports a commit against it", () => {
      const { onFetchLog, onShowCommit } = render2("projB/README.md");
      fireEvent.click(chip());
      expect(onFetchLog).toHaveBeenCalledWith("projB");
      fireEvent.click(screen.getByText("three days back"));
      expect(onShowCommit).toHaveBeenCalledWith("projB", "bbbbbbb2222");
    });

    it("asks for the new repository's log when the selection moves under an open menu", () => {
      // The menu stays open while the user walks the tree. Asking only on the toggle
      // left it saying "loading…" for a request nobody had made.
      const { onFetchLog, rerender, onShowCommit } = setup({
        status: status(TWO),
        selected: "projA/src/main.ts",
        log: logFor("projA"),
      });
      fireEvent.click(chip());
      expect(onFetchLog).toHaveBeenLastCalledWith("projA");

      rerender(
        <GitMenu status={status(TWO)} selected="projB" log={logFor("projA")} onFetchLog={onFetchLog} onShowCommit={onShowCommit} />,
      );
      expect(onFetchLog).toHaveBeenLastCalledWith("projB");
      expect(screen.getByText("loading…")).toBeInTheDocument();

      rerender(
        <GitMenu status={status(TWO)} selected="projB" log={logFor("projB")} onFetchLog={onFetchLog} onShowCommit={onShowCommit} />,
      );
      expect(screen.getByText("most recent")).toBeInTheDocument();
    });

    it("shows no commits under a repository whose answer has not arrived", () => {
      // Opening projA's history, then projB's: projA's entries must not render under
      // projB's chip, and must not be clickable into a git_show against projB
      const { onShowCommit } = setup({ status: status(TWO), selected: "projB/README.md", log: logFor("projA") });
      fireEvent.click(chip());
      expect(screen.getByText("loading…")).toBeInTheDocument();
      expect(screen.queryByText("most recent")).not.toBeInTheDocument();
      expect(onShowCommit).not.toHaveBeenCalled();
    });

    it("offers no history to open while no repository is named", () => {
      const { onFetchLog } = render2(null);
      fireEvent.click(chip());
      expect(onFetchLog).not.toHaveBeenCalled();
      expect(screen.queryByText("most recent")).not.toBeInTheDocument();
    });
  });

  describe("metro map", () => {
    const at = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
    /** A feature branch newer than HEAD, both off one base commit. */
    const BRANCHED: GitCommitLogEntry[] = [
      { sha: "fff0000", author: "Ada", date: at(0), subject: "on feature", parents: ["bbb0000"], refs: ["feature"], tags: [], head: false },
      { sha: "hhh0000", author: "Ada", date: at(1), subject: "on main", parents: ["bbb0000"], refs: ["main"], tags: [], head: true },
      { sha: "bbb0000", author: "Ada", date: at(2), subject: "base", parents: [], refs: [], tags: [], head: false },
    ];

    function openMap(entries: GitCommitLogEntry[] = BRANCHED) {
      const view = setup({ log: logFor("", entries) });
      fireEvent.click(chip());
      return view;
    }

    /** The node of a commit's row: the rail's last circle, and its lane's x. */
    function node(subject: string) {
      const row = screen.getByText(subject).closest("button")!;
      const circles = row.querySelectorAll("svg circle");
      return circles[circles.length - 1];
    }

    // openlore: scenario=TheCheckedOutLineRunsOnTheFirstLane spec=git
    it("TheCheckedOutLineRunsOnTheFirstLane: HEAD's commit sits on the first lane in the reserved colour", () => {
      openMap();
      expect(node("on main").getAttribute("cx")).toBe(String(laneX(0)));
      expect(node("on main").getAttribute("fill")).toBe(CURRENT_COLOR);
      expect(node("base").getAttribute("cx")).toBe(String(laneX(0)));
      expect(node("on feature").getAttribute("cx")).toBe(String(laneX(1)));
      expect(node("on feature").getAttribute("fill")).not.toBe(CURRENT_COLOR);
      // Nothing on the first lane above HEAD: the feature row draws no line at x(0)
      const featureRail = screen.getByText("on feature").closest("button")!.querySelector("svg")!;
      const xs = [...featureRail.querySelectorAll("line")].map((line) => line.getAttribute("x1"));
      expect(xs).not.toContain(String(laneX(0)));
    });

    // openlore: scenario=ABranchTipNamesItsBranch spec=git
    it("ABranchTipNamesItsBranch: each tip names its branch, the checked-out one set apart", () => {
      openMap();
      const main = within(screen.getByText("on main").closest("button")!).getByText("main");
      const feature = within(screen.getByText("on feature").closest("button")!).getByText("feature");
      expect(main).toHaveClass("font-semibold");
      expect(main).toHaveStyle({ color: CURRENT_COLOR });
      expect(feature).not.toHaveClass("font-semibold");
      expect(feature).not.toHaveStyle({ color: CURRENT_COLOR });
      expect(within(screen.getByText("base").closest("button")!).queryByText(/main|feature/)).not.toBeInTheDocument();
    });

    // openlore: scenario=AMergeJoinsTwoLines spec=git
    it("AMergeJoinsTwoLines: a merge draws a curve to its second parent's lane", () => {
      openMap([
        { sha: "mmm0000", author: "Ada", date: at(0), subject: "merge", parents: ["xxx0000", "yyy0000"], refs: ["main"], tags: [], head: true },
        { sha: "xxx0000", author: "Ada", date: at(1), subject: "x", parents: ["zzz0000"], refs: [], tags: [], head: false },
        { sha: "yyy0000", author: "Ada", date: at(2), subject: "y", parents: ["zzz0000"], refs: [], tags: [], head: false },
        { sha: "zzz0000", author: "Ada", date: at(3), subject: "z", parents: [], refs: [], tags: [], head: false },
      ]);
      const curve = (subject: string) => screen.getByText(subject).closest("button")!.querySelector("svg path");
      // Leaves the merge downward, ends on lane 1 at the row's foot
      expect(curve("merge")?.getAttribute("d")).toMatch(new RegExp(`${laneX(1)} ${ROW_H}$`));
      // Arrives at the base from lane 1 at the row's top
      expect(curve("z")?.getAttribute("d")).toMatch(new RegExp(`${laneX(1)} 0$`));
      expect(node("y").getAttribute("cx")).toBe(String(laneX(1)));
    });

    // openlore: scenario=ATaggedCommitShowsItsTag spec=git
    it("ATaggedCommitShowsItsTag: a tag is named on its commit, unlike a branch", () => {
      openMap([
        { sha: "hhh0000", author: "Ada", date: at(0), subject: "release", parents: [], refs: ["main"], tags: ["v1.0.0"], head: true },
      ]);
      const row = within(screen.getByText("release").closest("button")!);
      const tag = row.getByText(/v1\.0\.0/);
      const branch = row.getByText("main");
      expect(tag).toHaveAttribute("title", "tag v1.0.0");
      expect(tag).not.toHaveClass("rounded-full");
      expect(branch).toHaveClass("rounded-full");
    });

    it("still opens a commit's patch from the map", () => {
      const { onShowCommit } = openMap();
      fireEvent.click(screen.getByText("on feature"));
      expect(onShowCommit).toHaveBeenCalledWith("", "fff0000");
    });
  });
});
