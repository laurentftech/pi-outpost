import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsMenu } from "./SettingsMenu";

type Props = React.ComponentProps<typeof SettingsMenu>;
type Sandbox = NonNullable<Props["sandbox"]>;

function sandbox(overrides: Partial<Sandbox> = {}): Sandbox {
  return { root: "/work", allowWrite: true, allowBash: false, ...overrides };
}

type Browse = NonNullable<Props["serverBrowse"]>;

function browse(overrides: Partial<Browse> = {}): Browse {
  return { status: "loaded", path: "/", parent: null, entries: [], requestId: "r1", ...overrides };
}

function setup(overrides: Partial<Props> = {}) {
  const onUpdateConfig = vi.fn();
  const onBrowseServerPath = vi.fn();
  const onCloseServerBrowser = vi.fn();
  const props: Props = {
    extensionPaths: [],
    configuredExtensionPaths: [],
    userExtensionPaths: [],
    extensionLock: false,
    tools: [],
    commands: [],
    sandbox: sandbox(),
    userSkillPaths: [],
    serverBrowse: null,
    gitUnavailable: null,
    applyState: null,
    onBrowseServerPath,
    onCloseServerBrowser,
    onUpdateConfig,
    ...overrides,
  };
  const view = render(<SettingsMenu {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<SettingsMenu {...props} {...next} />);
  return { onUpdateConfig, onBrowseServerPath, onCloseServerBrowser, ...view, rerenderWith };
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Settings" }));
const field = (name: RegExp) => screen.getByRole("textbox", { name });
const check = (name: RegExp) => screen.getByRole("checkbox", { name });
const applyButton = () => screen.getByRole("button", { name: /Apply/ });

describe("SettingsMenu", () => {
  it("shows the effective tools and loaded skills", () => {
    setup({
      tools: [{ name: "present_structure", active: true }, { name: "bash", active: false }],
      commands: [{ name: "skill:structured-exchange", source: "skill" }],
    });
    openMenu();
    expect(screen.getByText("1 tools active · 1 inactive")).toBeInTheDocument();
    expect(screen.getByText("1 skills loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByText("1 tools active · 1 inactive"));
    fireEvent.click(screen.getByText("1 skills loaded"));
    expect(screen.getByText("present_structure")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
    expect(screen.getByText("skill:structured-exchange")).toBeInTheDocument();
  });

  it("stays closed until asked", () => {
    setup();
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("closes when the pointer goes down outside", () => {
    setup();
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
  });

  describe("extensions", () => {
    it("says when none are loaded", () => {
      setup({ extensionPaths: [] });
      openMenu();
      expect(screen.getByText("No extensions loaded")).toBeInTheDocument();
    });

    it("lists the loaded ones", () => {
      setup({ extensionPaths: ["/ext/openlore", "/ext/omni"] });
      openMenu();
      expect(screen.getByText("/ext/openlore")).toBeInTheDocument();
      expect(screen.getByText("/ext/omni")).toBeInTheDocument();
    });
  });

  describe("the sandbox form", () => {
    it("says when there is no sandbox to configure and delegates resource changes", () => {
      const { onUpdateConfig } = setup({ sandbox: null, userSkillPaths: ["/mnt/skills"] });
      openMenu();
      expect(screen.getByText("No sandbox configured")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Manage agent resources" })).toBeInTheDocument();
      expect(onUpdateConfig).not.toHaveBeenCalled();
    });

    it("starts from the current configuration", () => {
      setup({ sandbox: sandbox({ root: "/work", writableRoot: "src", allowWrite: true, allowBash: true }) });
      openMenu();
      expect(field(/^Root/)).toHaveValue("/work");
      expect(field(/Writable root/)).toHaveValue("src");
      expect(check(/Allow write/)).toBeChecked();
      expect(check(/Allow bash/)).toBeChecked();
    });

    it("takes a fresh configuration when the server acknowledges one", () => {
      const { rerenderWith } = setup();
      openMenu();
      rerenderWith({ sandbox: sandbox({ root: "/elsewhere", allowBash: true }) });
      expect(field(/^Root/)).toHaveValue("/elsewhere");
      expect(check(/Allow bash/)).toBeChecked();
    });

    it("sends every field, since the server validates the whole payload", () => {
      const { onUpdateConfig } = setup();
      openMenu();
      fireEvent.change(field(/^Root/), { target: { value: "/new-root" } });
      fireEvent.click(check(/Allow bash/));
      fireEvent.click(applyButton());
      expect(onUpdateConfig).toHaveBeenCalledWith({
        sandbox: { root: "/new-root", allowWrite: true, allowBash: true, writableRoot: undefined },
      });
    });

    it("treats a blank writable root as absent rather than empty", () => {
      const { onUpdateConfig } = setup({ sandbox: sandbox({ writableRoot: "src" }) });
      openMenu();
      fireEvent.change(field(/Writable root/), { target: { value: "   " } });
      fireEvent.click(applyButton());
      expect(onUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ sandbox: expect.objectContaining({ writableRoot: undefined }) }));
    });

    it("passes a writable root through when one is given", () => {
      const { onUpdateConfig } = setup();
      openMenu();
      fireEvent.change(field(/Writable root/), { target: { value: "src/app" } });
      fireEvent.click(applyButton());
      expect(onUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ sandbox: expect.objectContaining({ writableRoot: "src/app" }) }));
    });

    it("stays open while the apply is in flight, and closes once it is acknowledged", () => {
      const { rerenderWith } = setup();
      openMenu();
      fireEvent.click(applyButton());
      rerenderWith({ applyState: { status: "applying" } });
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(applyButton()).toBeDisabled();

      // The acknowledgement only arrives once the server has persisted the change.
      rerenderWith({ applyState: null });
      expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
    });

    it("refuses to apply without a root", () => {
      const { onUpdateConfig } = setup();
      openMenu();
      fireEvent.change(field(/^Root/), { target: { value: "  " } });
      expect(applyButton()).toBeDisabled();
      fireEvent.click(applyButton());
      expect(onUpdateConfig).not.toHaveBeenCalled();
    });
  });

  describe("locked fields", () => {
    it("disables what the server has locked, and says so", () => {
      setup({ sandbox: sandbox({ locks: { root: true, allowBash: true } }) });
      openMenu();
      expect(field(/^Root/)).toBeDisabled();
      expect(check(/Allow bash/)).toBeDisabled();
      // The others stay editable
      expect(field(/Writable root/)).toBeEnabled();
      expect(check(/Allow write/)).toBeEnabled();
    });

    it("still sends the locked values, which the server re-checks", () => {
      // Omitting them would fail the server's typeof validation on a missing boolean
      const { onUpdateConfig } = setup({ sandbox: sandbox({ locks: { root: true, allowBash: true }, allowBash: true }) });
      openMenu();
      fireEvent.click(applyButton());
      expect(onUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ sandbox: expect.objectContaining({ root: "/work", allowBash: true }) }));
    });
  });

  describe("resource management entry point", () => {
    it("keeps inventory summaries but delegates every path change to the manager", () => {
      setup({
        userSkillPaths: ["/mnt/team-skills"],
        commands: [{ name: "skill:structured-exchange", source: "skill" }],
      });
      openMenu();
      fireEvent.click(screen.getByText("1 skills loaded"));
      expect(screen.getByText("skill:structured-exchange")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Manage agent resources" })).toBeInTheDocument();
      expect(screen.queryByText("/mnt/team-skills")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add skills directory/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Remove \/mnt\/team-skills/ })).not.toBeInTheDocument();
    });

    it("restores focus to Settings when the manager closes", () => {
      setup();
      const settings = screen.getByRole("button", { name: "Settings" });
      fireEvent.click(settings);
      fireEvent.click(screen.getByRole("button", { name: "Manage agent resources" }));
      expect(screen.getByRole("button", { name: "Close agent resources" })).toHaveFocus();
      fireEvent.click(screen.getByRole("button", { name: "Close agent resources" }));
      expect(settings).toHaveFocus();
    });
  });

  describe("extension paths", () => {
    it("moves extension add and remove controls into the manager", () => {
      setup();
      openMenu();
      expect(screen.queryByRole("button", { name: "Add extensions directory…" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Manage agent resources" }));
      expect(screen.getByRole("dialog", { name: "Agent resources" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add local folder…" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add Git repository…" })).toBeInTheDocument();
    });

    it("offers nothing to change when the deployment locks them", () => {
      setup({ extensionLock: true, extensionPaths: ["/opt/ext/a.ts"], userExtensionPaths: ["/mnt/a"] });
      openMenu();
      expect(screen.getByTestId("extensions-locked")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add extensions directory…" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove /mnt/a" })).not.toBeInTheDocument();
      // Still says what is loaded: the lock is about changing them, not about hiding them.
      expect(screen.getByText("1 extension loaded")).toBeInTheDocument();
    });

    it("leaves a locked list out of the payload rather than sending it unchanged", () => {
      const { onUpdateConfig } = setup({ extensionLock: true, userExtensionPaths: ["/mnt/a"] });
      openMenu();
      fireEvent.click(applyButton());
      // The server refuses any update carrying extension paths under a lock, which
      // would take the rest of the apply down with it.
      expect(onUpdateConfig).toHaveBeenCalledWith(expect.not.objectContaining({ userExtensionPaths: expect.anything() }));
    });

    it("tells an unreported inventory apart from an empty one", () => {
      const { rerenderWith } = setup({ extensionPaths: null });
      openMenu();
      expect(screen.getByTestId("extensions-unknown")).toHaveTextContent("Not reported by this runtime");
      expect(screen.queryByText("No extensions loaded")).not.toBeInTheDocument();

      rerenderWith({ extensionPaths: [] });
      expect(screen.getByText("No extensions loaded")).toBeInTheDocument();
      expect(screen.queryByTestId("extensions-unknown")).not.toBeInTheDocument();
    });

    it("opens every inventory from a counted summary and sorts every list", () => {
      setup({
        tools: [
          { name: "write", active: true },
          { name: "bash", active: false },
          { name: "read", active: true },
        ],
        commands: [
          { name: "z-last", source: "skill" },
          { name: "a-first", source: "skill" },
        ],
        extensionPaths: ["/opt/ext/c.ts", "/opt/ext/a.ts", "/opt/ext/b.ts"],
      });
      openMenu();

      const tools = screen.getByTestId("tools-loaded");
      const skills = screen.getByTestId("skills-loaded");
      const extensions = screen.getByTestId("extensions-loaded");
      for (const inventory of [tools, skills, extensions]) expect(inventory).not.toHaveAttribute("open");

      expect(screen.getByText("2 tools active · 1 inactive")).toBeInTheDocument();
      expect(screen.getByText("2 skills loaded")).toBeInTheDocument();
      expect(screen.getByText("3 extensions loaded")).toBeInTheDocument();

      fireEvent.click(screen.getByText("2 tools active · 1 inactive"));
      fireEvent.click(screen.getByText("2 skills loaded"));
      fireEvent.click(screen.getByText("3 extensions loaded"));

      expect(Array.from(tools.querySelectorAll("li span:first-child")).map((span) => span.textContent)).toEqual([
        "bash",
        "read",
        "write",
      ]);
      expect(Array.from(skills.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["a-first", "z-last"]);
      expect(Array.from(extensions.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
        "/opt/ext/a.ts",
        "/opt/ext/b.ts",
        "/opt/ext/c.ts",
      ]);
    });

    it("shows the deployment's own paths, and offers no way to remove them", () => {
      setup({ configuredExtensionPaths: ["/opt/deployment"] });
      openMenu();
      expect(screen.getByText("1 configured by this deployment")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove /opt/deployment" })).not.toBeInTheDocument();
    });
  });

  describe("the server path picker", () => {
    it("browses from whatever the sandbox root already points at", () => {
      const { onBrowseServerPath } = setup({ sandbox: sandbox({ root: "/work" }) });
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));
      expect(onBrowseServerPath).toHaveBeenCalledWith("/work");
    });

    it("puts the chosen directory in the field it was opened for", () => {
      const { rerenderWith } = setup();
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Browse for writable root" }));
      rerenderWith({ serverBrowse: browse({ path: "/work/scratch", parent: "/work" }) });
      fireEvent.click(screen.getByRole("button", { name: "Use this directory" }));
      expect(field(/Writable root/)).toHaveValue("/work/scratch");
      expect(screen.queryByTestId("server-path-picker")).not.toBeInTheDocument();
    });

    it("spells a Windows drive the way Windows does", () => {
      const { onBrowseServerPath, rerenderWith } = setup();
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));
      // The server's virtual root on Windows: its entries are the drives.
      rerenderWith({ serverBrowse: browse({ path: "/", parent: null, entries: [{ name: "C:", path: "C:\\" }] }) });
      fireEvent.click(screen.getByRole("button", { name: "C:\\" }));
      expect(onBrowseServerPath).toHaveBeenLastCalledWith("C:\\");
    });

    it("walks back up through the parent", () => {
      const { onBrowseServerPath, rerenderWith } = setup();
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));
      rerenderWith({ serverBrowse: browse({ path: "/mnt/skills", parent: "/mnt" }) });
      fireEvent.click(screen.getByRole("button", { name: "Up" }));
      expect(onBrowseServerPath).toHaveBeenLastCalledWith("/mnt");
    });

    it("shows a path it could not read, and changes no field", () => {
      const { onUpdateConfig, rerenderWith } = setup({ sandbox: sandbox({ root: "/work" }) });
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));
      // The refused path is named in the error; the picker still stands on the
      // directory that did list, which is the only one selectable.
      rerenderWith({
        serverBrowse: browse({ status: "error", path: "/mnt", parent: "/", error: 'Cannot list "/private": permission denied' }),
      });
      expect(screen.getByRole("alert")).toHaveTextContent('Cannot list "/private": permission denied');
      expect(field(/^Root/)).toHaveValue("/work");
      // The current directory is a field now, not a caption: it says where "Up"
      // goes from, and a path can be typed straight into it.
      expect(screen.getByTestId("picker-path")).toHaveValue("/mnt");

      fireEvent.click(screen.getByRole("button", { name: "Use this directory" }));
      fireEvent.click(applyButton());
      expect(onUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ sandbox: expect.objectContaining({ root: "/mnt" }) }));
    });

    it("gives up the listing when the picker is cancelled", () => {
      const { onCloseServerBrowser, rerenderWith } = setup();
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));
      rerenderWith({ serverBrowse: browse() });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByTestId("server-path-picker")).not.toBeInTheDocument();
      expect(onCloseServerBrowser).toHaveBeenCalled();
    });
  });

    it("browses to a path typed into the current-directory field", () => {
      const { onBrowseServerPath, rerenderWith } = setup({ sandbox: sandbox({ root: "/work" }) });
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));
      rerenderWith({ serverBrowse: browse({ path: "/mnt", parent: "/" }) });

      // Typing the destination beats descending to it by mouse, and is the whole
      // reason the caption became a field.
      fireEvent.change(screen.getByTestId("picker-path"), { target: { value: "/srv/projects" } });
      fireEvent.click(screen.getByRole("button", { name: "Go" }));
      expect(onBrowseServerPath).toHaveBeenLastCalledWith("/srv/projects");
    });

  it("shows no picker at all while another one holds the listing", () => {
    /*
     * The invariant, not the timing.
     *
     * Two pickers at once is not a cosmetic overlap: everything inside one is
     * duplicated, so "the Go button" stops naming a single thing — a browser test
     * failed with `getByRole('button', { name: 'Go' }) resolved to 2 elements`,
     * which a reader would have seen as a flicker of two stacked panels.
     *
     * The overlap itself lasted a single frame, between the render that yielded
     * and the effect that closed the picker, and it cannot be observed from here:
     * the test renderer flushes effects synchronously, so this assertion holds
     * whether the decision is made during the render or one tick later. The frame
     * is guarded in a real browser, by e2e/settings-sandbox.spec.ts. What is
     * pinned here is the end state that both must reach.
     */
    const { rerenderWith } = setup({ sandbox: sandbox({ root: "/work" }) });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));
    expect(screen.getAllByRole("button", { name: "Go" })).toHaveLength(1);

    // Another header control opens its own picker and takes the shared listing.
    rerenderWith({ pickerBlocked: true });

    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
  });

  describe("a refused apply", () => {
    it("stays open, says why, and leaves the settings as the server still has them", () => {
      const { rerenderWith } = setup({ sandbox: sandbox({ root: "/work" }), userSkillPaths: ["/mnt/a"] });
      openMenu();
      fireEvent.change(field(/^Root/), { target: { value: "/nowhere" } });
      fireEvent.click(applyButton());
      rerenderWith({ applyState: { status: "applying" } });
      rerenderWith({ applyState: { status: "error", message: "cannot save /etc/pi.json: does not exist" } });

      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("cannot save /etc/pi.json: does not exist");
      expect(applyButton()).toBeEnabled();

      // The server kept its configuration, so the menu goes back to showing it.
      rerenderWith({ applyState: { status: "error", message: "cannot save" }, sandbox: sandbox({ root: "/work" }), userSkillPaths: ["/mnt/a"] });
      expect(field(/^Root/)).toHaveValue("/work");
      expect(screen.queryByText("/mnt/a")).not.toBeInTheDocument();
    });
  });

  describe("versions", () => {
    it("shows them when the server reported them", () => {
      setup({ versions: { piOutpost: "0.6.7", piSdk: "1.2.3" } });
      openMenu();
      expect(screen.getByText("0.6.7")).toBeInTheDocument();
      expect(screen.getByText("1.2.3")).toBeInTheDocument();
    });

    /**
     * Under the RPC runtime the SDK version pi-outpost ships is not what answers
     * prompts — a fork at its own version is. Reading "pi SDK: 0.84.1" while
     * little-coder 0.83.0 does the work is a wrong answer, not a missing one.
     */
    it("names the harness, and not the SDK, when a child answers the prompts", () => {
      setup({ versions: { piOutpost: "0.6.7", agent: "little-coder 0.83.0" } });
      openMenu();
      expect(screen.getByText("little-coder 0.83.0")).toBeInTheDocument();
      // The bundled SDK still reads the session store under RPC, but a version a
      // reader takes for the agent's — and that is not — is worse than no line.
      expect(screen.queryByText(/pi SDK/)).not.toBeInTheDocument();
    });

    it("says nothing about a harness on the embedded runtime", () => {
      setup({ versions: { piOutpost: "0.6.7", piSdk: "1.2.3" } });
      openMenu();
      expect(screen.queryByText(/agent:/)).not.toBeInTheDocument();
    });

    it("omits the section when it has nothing to report", () => {
      setup({ versions: null });
      openMenu();
      expect(screen.queryByRole("heading", { name: /Versions/i })).not.toBeInTheDocument();
    });
  });

  describe("why git is unavailable", () => {
    // openlore: scenario=AnOrdinaryDirectoryIsNotAFault spec=git
    it("states a directory with no repository plainly, with nothing to fix", () => {
      setup({ gitUnavailable: { reason: "no-repository" } });
      openMenu();
      const section = screen.getByTestId("git-unavailable");
      expect(section).toHaveTextContent(/not in a git repository/i);
      expect(section).not.toHaveTextContent(/PATH/);
    });

    // openlore: scenario=TheFaultIsVisibleWhereAUserLooks spec=git
    it("names the fault and the remedy when the executable could not be run", () => {
      setup({ gitUnavailable: { reason: "no-executable", message: "git could not be run (tried git)" } });
      openMenu();
      const section = screen.getByTestId("git-unavailable");
      expect(section).toHaveTextContent(/executable could not be run/i);
      expect(section).toHaveTextContent("git could not be run (tried git)");
      expect(section).toHaveTextContent(/gitPath/);
    });

    it("repeats git's own words when git refused the repository", () => {
      // The message names the directory AND the remedy; paraphrasing loses both
      const message = "fatal: detected dubious ownership in repository at '/work/proj'";
      setup({ gitUnavailable: { reason: "refused", message } });
      openMenu();
      const section = screen.getByTestId("git-unavailable");
      expect(section).toHaveTextContent(/refused this repository/i);
      expect(section).toHaveTextContent(message);
    });

    it("says nothing at all when git is available", () => {
      setup({ gitUnavailable: null });
      openMenu();
      expect(screen.queryByTestId("git-unavailable")).not.toBeInTheDocument();
    });

    it("survives a missing value rather than taking the panel down with it", () => {
      // Every other section here is unrelated to git: one absent prop must not blank
      // the whole panel, which is exactly how a viewer crash unmounted the app once
      setup({ gitUnavailable: undefined as never });
      openMenu();
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(screen.queryByTestId("git-unavailable")).not.toBeInTheDocument();
    });
  });
});
