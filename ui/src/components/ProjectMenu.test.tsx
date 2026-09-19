/**
 * The project selector, at the boundaries the spec draws around it:
 * what it offers, what it refuses to offer, and what it says without words.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { WorkspaceInfo } from "@pi-outpost/shared";
import { ProjectMenu } from "./ProjectMenu";

function workspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    root: "/srv/alpha",
    name: "alpha",
    activity: "idle",
    needsAttention: false,
    ...overrides,
  };
}

type Props = React.ComponentProps<typeof ProjectMenu>;

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    workspace: workspace(),
    workspaces: [workspace(), workspace({ root: "/srv/beta", name: "beta" })],
    locked: false,
    onSwitch: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<ProjectMenu {...props} />), props };
}

describe("what the selector offers", () => {
  it("names every open project with its path and its state in words", () => {
    setup({
      workspaces: [
        workspace(),
        workspace({ root: "/srv/beta", name: "beta", activity: "working" }),
        workspace({ root: "/srv/gamma", name: "gamma", activity: "stopped" }),
        workspace({ root: "/srv/delta", name: "delta", activity: "ready-for-review", needsAttention: true }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const menu = screen.getByRole("menu");

    for (const [name, path, state] of [
      ["alpha", "/srv/alpha", "idle"],
      ["beta", "/srv/beta", "working"],
      ["gamma", "/srv/gamma", "stopped"],
      ["delta", "/srv/delta", "ready for review"],
    ]) {
      expect(within(menu).getByText(name)).toBeInTheDocument();
      // The path is what separates two projects sharing a basename.
      expect(within(menu).getByText(path)).toBeInTheDocument();
      expect(within(menu).getByText(state)).toBeInTheDocument();
    }
  });

  it("switches to the project that was clicked, and not to the current one", () => {
    const { props } = setup();

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("menuitem", { name: /beta/ }));
    expect(props.onSwitch).toHaveBeenCalledWith("/srv/beta");

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("menuitem", { name: /alpha/ }));
    expect(props.onSwitch).toHaveBeenCalledTimes(1);
  });

  it("offers closing a project even while it works — the server owns the refusal", () => {
    const { props } = setup({
      workspaces: [workspace(), workspace({ root: "/srv/beta", name: "beta", activity: "working" })],
    });

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "Close beta" }));
    expect(props.onClose).toHaveBeenCalledWith("/srv/beta");
  });

  // openlore: scenario=OneProjectIsStillNamed spec=multi-project-workspaces
  it("names the project even when it is the only one open", () => {
    setup({ workspaces: [workspace()] });

    // The one thing a user cannot work without is which project this is. A bare
    // "+" stood here and said it nowhere.
    const button = screen.getByRole("button", { expanded: false });
    expect(button).toHaveAttribute("title", "Project: alpha (idle)");
    expect(button).toHaveTextContent("alpha");
  });

  // openlore: scenario=OpeningStaysReachableFromTheControl spec=multi-project-workspaces
  it("keeps opening reachable with a single project, from that same control", () => {
    const { props } = setup({ workspaces: [workspace()] });

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const menu = screen.getByRole("menu");
    // One row, and the way to add another. Closing is absent because the server
    // refuses to close the last project anyway.
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
    expect(within(menu).queryByRole("button", { name: /^Close/ })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /Open a project/ }));
    expect(props.onOpen).toHaveBeenCalled();
  });

  // openlore: scenario=TheControlDoesNotChangeShape spec=multi-project-workspaces
  it("does not change shape when a second project appears", () => {
    const one = [workspace()];
    const two = [workspace(), workspace({ root: "/srv/beta", name: "beta" })];
    const { rerender, props } = setup({ workspaces: one });
    const before = screen.getByRole("button", { expanded: false });
    const shape = { tag: before.tagName, title: before.getAttribute("title"), text: before.textContent };

    rerender(<ProjectMenu {...props} workspaces={two} />);

    // The same control, saying the same thing about the current project. What
    // changed is the number of rows behind it, not the interface.
    const after = screen.getByRole("button", { expanded: false });
    expect({ tag: after.tagName, title: after.getAttribute("title"), text: after.textContent }).toEqual(shape);
    fireEvent.click(after);
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem")).toHaveLength(3);
  });
});

describe("what a pinned server offers", () => {
  it("offers nothing at all — not a disabled control", () => {
    const { container } = setup({ locked: true });

    // The widget embeds with this set, and a greyed-out selector would advertise
    // a choice the host has already made.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("attention, without interrupting anyone", () => {
  it("counts actionable projects without interrupting focus", () => {
    const focus = document.createElement("input");
    document.body.append(focus);
    focus.focus();
    setup({
      workspaces: [
        workspace(),
        workspace({ root: "/srv/beta", name: "beta", activity: "waiting", needsAttention: true }),
        workspace({ root: "/srv/gamma", name: "gamma", activity: "ready-for-review", needsAttention: true }),
      ],
    });

    const button = screen.getByRole("button", { expanded: false });
    expect(button).toHaveTextContent("2");
    // The badge is the only change to the current project's screen: no dialog,
    // no focus move.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(focus);
    focus.remove();
  });

  it("names the waiting project in words once the menu is open", () => {
    setup({
      workspaces: [workspace(), workspace({ root: "/srv/beta", name: "beta", activity: "waiting", needsAttention: true })],
    });

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const row = within(screen.getByRole("menu")).getByText("beta").closest("div")!;
    expect(within(row).getByText("waiting for you")).toBeInTheDocument();
  });

  it("counts mixed attention and distinguishes every review-ready workspace", () => {
    const active = workspace({ activity: "ready-for-review", needsAttention: true });
    setup({
      workspace: active,
      workspaces: [
        active,
        workspace({ root: "/srv/beta", name: "beta", activity: "waiting", needsAttention: true }),
        workspace({ root: "/srv/gamma", name: "gamma", activity: "ready-for-review", needsAttention: true }),
      ],
    });

    const button = screen.getByRole("button", { expanded: false });
    expect(button).toHaveTextContent("3");
    expect(button).toHaveAttribute("title", "Project: alpha (ready for review)");
    fireEvent.click(button);
    expect(within(screen.getByRole("menu")).getAllByText("ready for review")).toHaveLength(2);
    expect(within(screen.getByRole("menu")).getByText("waiting for you")).toBeInTheDocument();
  });
});

describe("dismissing the menu", () => {
  it("closes when the pointer lands outside it", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // A menu that survives a click elsewhere covers the screen it opened over.
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("stays open when the pointer lands inside it", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    fireEvent.mouseDown(screen.getByRole("menu"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on Escape, and leaves other keys alone", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes itself when opening a project is chosen from inside it", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Open a project/ }));

    // The picker takes over from here, so the menu must not still be over it.
    expect(props.onOpen).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

// openlore: scenario=TheControlDoesNotChangeShape spec=multi-project-workspaces
describe("what one project shows that only several used to", () => {
  it("marks the single project's activity like any other", () => {
    const working = workspace({ activity: "working" });
    setup({ workspace: working, workspaces: [working] });

    // The deleted branch is what kept these from ever being reached below two
    // projects: a bare "+" has no state to show.
    expect(screen.getByRole("button", { expanded: false })).toHaveAttribute(
      "title",
      "Project: alpha (working)",
    );
  });

  it("raises attention for the single project too", () => {
    setup({ workspaces: [workspace({ activity: "waiting", needsAttention: true })] });

    const button = screen.getByRole("button", { expanded: false });
    expect(button).toHaveTextContent("1");
    expect(button.className).toMatch(/amber/);
  });

  it("says so in words once the menu is open", () => {
    setup({ workspaces: [workspace({ activity: "waiting", needsAttention: true })] });
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(within(screen.getByRole("menu")).getByText("waiting for you")).toBeInTheDocument();
  });
});

// openlore: scenario=APinnedServerStillOffersNothing spec=multi-project-workspaces
describe("naming a project never resurrects a control a deployment refused", () => {
  it("offers nothing on a pinned server, with one project open", () => {
    const { container } = setup({ workspaces: [workspace()], locked: true });

    // The lock is the deployment's answer. Naming the project is about what the
    // control says when there is one, never about whether there is one.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("side sessions", () => {
  const side = (overrides: Partial<WorkspaceInfo> = {}) =>
    workspace({ id: "/srv/alpha#side-1", sideOf: "/srv/alpha", label: "fix typo", name: "alpha · fix typo", ...overrides });
  const open = () => fireEvent.click(screen.getByTitle(/^Project:/));

  it("offers a visible side-session control on each project, and none on a side session", () => {
    // TheProjectControlsOfferASideSession
    setup({ workspaces: [workspace(), side(), workspace({ root: "/srv/beta", name: "beta" })], onOpenSide: vi.fn() });
    open();
    const projects = screen.getAllByTestId("project-row");
    expect(projects).toHaveLength(2);
    for (const row of projects) {
      const control = within(row).getByRole("button", { name: /^New side session on / });
      // Always shown: not hidden until hover, as the close button is.
      expect(control.className).not.toMatch(/opacity-0/);
    }
    const sideRow = screen.getByTestId("side-session-row");
    expect(within(sideRow).queryByRole("button", { name: /New side session/ })).toBeNull();
  });

  it("starts a side session on the row's project, even when it is not the one shown", () => {
    // TheProjectRowStartsASideSession
    const { props } = setup({ onOpenSide: vi.fn() });
    open();
    fireEvent.click(screen.getByRole("button", { name: "New side session on beta" }));
    expect(props.onOpenSide).toHaveBeenCalledWith("/srv/beta");
    expect(props.onSwitch).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lists a side session under its project, by its label, and switches and closes it by id", () => {
    const { props } = setup({ workspaces: [side(), workspace({ root: "/srv/beta", name: "beta" }), workspace()] });
    open();
    const rows = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
    const alpha = rows.findIndex((text) => text.startsWith("alpha"));
    expect(rows[alpha + 1]).toMatch(/^fix typo/);

    const sideRow = screen.getByTestId("side-session-row");
    fireEvent.click(within(sideRow).getByRole("button", { name: "Close fix typo" }));
    expect(props.onClose).toHaveBeenCalledWith("/srv/alpha", "/srv/alpha#side-1");
    fireEvent.click(within(sideRow).getByRole("menuitem"));
    expect(props.onSwitch).toHaveBeenCalledWith("/srv/alpha", "/srv/alpha#side-1");
  });

  it("closes a side session even when its project is the only one open", () => {
    setup({ workspaces: [workspace(), side()] });
    open();
    expect(within(screen.getByTestId("side-session-row")).getByRole("button", { name: "Close fix typo" })).toBeInTheDocument();
    expect(within(screen.getByTestId("project-row")).queryByRole("button", { name: /^Close/ })).toBeNull();
  });

  it("offers no side session where none was wired", () => {
    setup();
    open();
    expect(screen.queryByRole("button", { name: /New side session/ })).toBeNull();
  });
});
