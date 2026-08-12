/**
 * The rendered menu. The lane maths lives in TreeMenu.test.tsx, which exercises
 * layoutGraph directly; this covers what the component does around it — fetching,
 * searching, and the three ways a turn can be acted on.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { TreeNode } from "@pi-outpost/shared";
import { TreeMenu } from "./TreeMenu";

function node(entryId: string, text: string, onPath: boolean, children: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode {
  return { entryId, text, onPath, children, ...extra };
}

/**
 *   root ── a ── a1        (current)
 *        └─ b              (abandoned, carries a label)
 */
const TREE: TreeNode[] = [
  node("root", "start the project", true, [
    node("a", "add the parser", true, [node("a1", "fix the parser", true, [], { tipId: "a1-tip" })]),
    node("b", "try a different parser", false, [], { label: "parser spike" }),
  ]),
];

type Props = React.ComponentProps<typeof TreeMenu>;

function setup(overrides: Partial<Props> = {}) {
  const handlers = { onListTree: vi.fn(), onNavigate: vi.fn(), onFork: vi.fn() };
  const props: Props = { tree: TREE, isStreaming: false, ...handlers, ...overrides };
  const view = render(<TreeMenu {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<TreeMenu {...props} {...next} />);
  return { ...handlers, ...view, rerenderWith };
}

const toggle = () => screen.getByRole("button", { name: "tree" });
const openMenu = () => fireEvent.click(toggle());
const searchBox = () => screen.getByRole("searchbox", { name: "Search conversation tree" });
/** The row whose turn text this is — rows are a div wrapping the navigate button. */
const row = (text: string) => screen.getByText(text).closest("div")!;

describe("TreeMenu", () => {
  describe("opening", () => {
    it("stays closed until asked", () => {
      setup();
      expect(screen.queryByText("Conversation tree")).not.toBeInTheDocument();
      openMenu();
      expect(screen.getByText("Conversation tree")).toBeInTheDocument();
    });

    it("asks for the tree when it opens", () => {
      const { onListTree } = setup();
      openMenu();
      expect(onListTree).toHaveBeenCalled();
    });

    it("refetches rather than stranding an open menu on a reset tree", () => {
      // A session switch nulls the tree while the menu is open
      const { onListTree, rerenderWith } = setup();
      openMenu();
      onListTree.mockClear();
      rerenderWith({ tree: null });
      expect(onListTree).toHaveBeenCalled();
      expect(screen.getByText("loading…")).toBeInTheDocument();
    });

    it("says a fresh session has no turns yet", () => {
      setup({ tree: [] });
      openMenu();
      expect(screen.getByText("no messages yet")).toBeInTheDocument();
    });

    it("closes on a second click, and on a click outside", () => {
      setup();
      openMenu();
      fireEvent.click(toggle());
      expect(screen.queryByText("Conversation tree")).not.toBeInTheDocument();
      openMenu();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByText("Conversation tree")).not.toBeInTheDocument();
    });
  });

  describe("the header count", () => {
    it("counts turns and branch points", () => {
      setup();
      openMenu();
      expect(screen.getByText("4 turns · 1 branch point")).toBeInTheDocument();
    });

    it("says it in the singular when there is one of each", () => {
      setup({ tree: [node("only", "just this", true)] });
      openMenu();
      expect(screen.getByText("1 turn · 0 branch points")).toBeInTheDocument();
    });
  });

  describe("acting on a turn", () => {
    it("restores the state after the exchange when the turn has a reply", () => {
      const { onNavigate } = setup();
      openMenu();
      fireEvent.click(screen.getByText("fix the parser"));
      expect(onNavigate).toHaveBeenCalledWith("a1-tip");
    });

    it("rewinds to before the turn when it has no reply yet", () => {
      const { onNavigate } = setup();
      openMenu();
      fireEvent.click(screen.getByText("try a different parser"));
      expect(onNavigate).toHaveBeenCalledWith("b");
    });

    it("rewinds to before the message on redo, reply or not", () => {
      const { onNavigate } = setup();
      openMenu();
      fireEvent.click(within(row("fix the parser")).getByRole("button", { name: "Rewind to before this message" }));
      expect(onNavigate).toHaveBeenCalledWith("a1");
    });

    it("forks a new session from the turn", () => {
      const { onFork } = setup();
      openMenu();
      fireEvent.click(within(row("try a different parser")).getByRole("button", { name: /fork/ }));
      expect(onFork).toHaveBeenCalledWith("b");
    });

    it("closes after acting", () => {
      setup();
      openMenu();
      fireEvent.click(screen.getByText("fix the parser"));
      expect(screen.queryByText("Conversation tree")).not.toBeInTheDocument();
    });

    it("refuses navigation while the agent is running, but still allows a fork", () => {
      const { onFork } = setup({ isStreaming: true });
      openMenu();
      // While streaming the title stops describing the action and says why it is refused
      expect(within(row("fix the parser")).getByTitle("unavailable while the agent is running")).toBeDisabled();
      // Forking makes a new session, so a running agent is no reason to refuse it
      fireEvent.click(within(row("fix the parser")).getByRole("button", { name: /fork/ }));
      expect(onFork).toHaveBeenCalled();
    });

    it("labels an empty turn rather than rendering a blank row", () => {
      setup({ tree: [node("empty", "", true)] });
      openMenu();
      expect(screen.getByText("(empty)")).toBeInTheDocument();
    });
  });

  describe("chips", () => {
    it("marks where the conversation stands", () => {
      setup();
      openMenu();
      expect(within(row("fix the parser")).getByText("current")).toBeInTheDocument();
    });

    it("counts the branches at a fork", () => {
      setup();
      openMenu();
      expect(within(row("add the parser")).queryByText(/branches/)).not.toBeInTheDocument();
      expect(within(row("start the project")).getByText("2 branches")).toBeInTheDocument();
    });

    it("numbers each branch, and says when an off-leaf turn is still on the current one", () => {
      setup();
      openMenu();
      expect(within(row("add the parser")).getByText("branch 1 · current")).toBeInTheDocument();
      expect(within(row("try a different parser")).getByText("branch 2")).toBeInTheDocument();
    });

    it("shows the label the agent gave an abandoned branch", () => {
      setup();
      openMenu();
      expect(within(row("try a different parser")).getByText("parser spike")).toBeInTheDocument();
    });
  });

  describe("searching", () => {
    it("filters turns by their text", () => {
      setup();
      openMenu();
      fireEvent.change(searchBox(), { target: { value: "different" } });
      expect(screen.getByText("try a different parser")).toBeInTheDocument();
      expect(screen.queryByText("start the project")).not.toBeInTheDocument();
    });

    it("matches case-insensitively", () => {
      setup();
      openMenu();
      fireEvent.change(searchBox(), { target: { value: "PARSER" } });
      expect(screen.getByText("add the parser")).toBeInTheDocument();
    });

    it("searches labels too, the most memorable handle on an abandoned branch", () => {
      setup();
      openMenu();
      fireEvent.change(searchBox(), { target: { value: "spike" } });
      expect(screen.getByText("try a different parser")).toBeInTheDocument();
      expect(screen.queryByText("add the parser")).not.toBeInTheDocument();
    });

    it("says when nothing matches", () => {
      setup();
      openMenu();
      fireEvent.change(searchBox(), { target: { value: "zzz" } });
      expect(screen.getByText("no matches")).toBeInTheDocument();
    });

    it("returns to the graph when the query is cleared", () => {
      setup();
      openMenu();
      fireEvent.change(searchBox(), { target: { value: "different" } });
      fireEvent.change(searchBox(), { target: { value: "  " } });
      expect(screen.getByText("start the project")).toBeInTheDocument();
    });

    it("marks which results sit on the current branch", () => {
      setup();
      openMenu();
      fireEvent.change(searchBox(), { target: { value: "parser" } });
      expect(within(row("add the parser")).getByText("on current branch")).toBeInTheDocument();
      expect(within(row("try a different parser")).queryByText("on current branch")).not.toBeInTheDocument();
    });

    it("acts on a result the same way as on a graph row", () => {
      const { onNavigate, onFork } = setup();
      openMenu();
      fireEvent.change(searchBox(), { target: { value: "fix" } });
      fireEvent.click(within(row("fix the parser")).getByTitle(/restore the conversation/));
      expect(onNavigate).toHaveBeenCalledWith("a1-tip");

      openMenu();
      fireEvent.change(searchBox(), { target: { value: "fix" } });
      fireEvent.click(within(row("fix the parser")).getByRole("button", { name: /fork/ }));
      expect(onFork).toHaveBeenCalledWith("a1");
    });

    it("starts from a blank query each time the menu opens", () => {
      setup();
      openMenu();
      fireEvent.change(searchBox(), { target: { value: "different" } });
      fireEvent.click(toggle());
      openMenu();
      expect(searchBox()).toHaveValue("");
    });
  });
});
