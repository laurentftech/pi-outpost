import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentCollectionSkill,
  AgentResourceInventory,
  AgentResourceRepository,
  AgentResourceRepositoryAssessment,
  AgentResourceRepositoryPreview,
} from "@pi-outpost/shared";
import type { AgentResourceOperationState } from "../useAgent";
import { AgentResourceManager } from "./AgentResourceManager";

const operations = (overrides: Partial<AgentResourceOperationState> = {}): AgentResourceOperationState => ({
  clonePath: null,
  preview: null,
  enrollment: null,
  refresh: null,
  updates: {},
  skills: {},
  removals: {},
  ...overrides,
});

function assessment(repositoryId: string, status: AgentResourceRepositoryAssessment["status"], reason?: string): AgentResourceRepositoryAssessment {
  return {
    repositoryId,
    status,
    ...(reason ? { reason } : {}),
    ...(status === "updateable" ? {
      branch: "main",
      upstream: "origin/main",
      localRevision: "1111111111111111111111111111111111111111",
      upstreamRevision: "2222222222222222222222222222222222222222",
      token: `token-${repositoryId}`,
    } : {}),
  };
}

const inventory = (repoStatus: AgentResourceRepositoryAssessment["status"] = "updateable"): AgentResourceInventory => ({
  capabilities: { skills: "available", extensions: "unavailable" },
  resources: [
    { id: "skill:review", kind: "skill", name: "review", origin: "user", path: "/repos/team/skills/review/SKILL.md", userRoot: "/repos/team/skills" },
    { id: "extension:deploy", kind: "extension", name: "deploy", origin: "runtime", path: "/repos/team/extensions/deploy.ts" },
    { id: "skill:remote", kind: "skill", name: "remote-only", origin: "runtime", unavailableReason: "RPC omitted sourceInfo" },
  ],
  repositories: [{
    id: "repo-team",
    name: "team-resources",
    path: "/repos/team",
    resourceIds: ["skill:review", "extension:deploy"],
    containsExtensions: true,
    assessment: assessment("repo-team", repoStatus, repoStatus === "dirty" ? "Local changes must be resolved outside the updater" : undefined),
  }],
});

function setup(overrides: Record<string, unknown> = {}) {
  const callbacks = {
    onClose: vi.fn(),
    onBrowseServerPath: vi.fn(),
    onCloseServerBrowser: vi.fn(),
    onUpdateConfig: vi.fn(),
    onSuggestClonePath: vi.fn(),
    onCloneRepository: vi.fn(),
    onEnrollRepository: vi.fn(),
    onSetSkills: vi.fn(),
    onRemoveRepository: vi.fn(),
    onRefresh: vi.fn(),
    onUpdate: vi.fn(),
  };
  const props = {
    open: true,
    inventory: inventory(),
    operations: operations(),
    extensionLock: false,
    userSkillPaths: ["/repos/team/skills"],
    userExtensionPaths: [],
    serverBrowse: null,
    applyState: null,
    ...callbacks,
    ...overrides,
  };
  const view = render(<AgentResourceManager {...props} />);
  return { ...callbacks, ...view, rerenderWith: (next: Record<string, unknown>) => view.rerender(<AgentResourceManager {...props} {...next} />) };
}

describe("AgentResourceManager", () => {
  it("opens a repository-first split inventory and keeps unavailable provenance visible", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Agent resources" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /team-resources/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /Provenance unavailable/ })).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("deploy")).toBeInTheDocument();
  });

  it("adds a local skill folder once through the picker", () => {
    const { onBrowseServerPath, onUpdateConfig, rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add local folder…" }));
    expect(onBrowseServerPath).toHaveBeenCalledWith("/");
    rerenderWith({ serverBrowse: { status: "loaded", path: "/new-skills", parent: "/", entries: [], requestId: "dir" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this directory" }));
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    expect(onUpdateConfig).toHaveBeenCalledWith({ userSkillPaths: ["/repos/team/skills", "/new-skills"] });
  });

  it("returns to the inventory after a local-folder update is acknowledged", () => {
    const { rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add local folder…" }));
    rerenderWith({ applyState: { status: "applying" } });
    expect(screen.getByRole("heading", { name: "Add local folder" })).toBeInTheDocument();
    rerenderWith({ applyState: null });
    expect(screen.queryByRole("heading", { name: "Add local folder" })).not.toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("requires an executable warning and respects extension lock for local folders", () => {
    const { onUpdateConfig, rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add local folder…" }));
    fireEvent.click(screen.getByRole("button", { name: "Extension folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Local resource folder" }), { target: { value: "/extensions" } });
    expect(screen.getByRole("button", { name: "Add folder" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Add folder" })).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Local resource folder" }), { target: { value: "/other-extensions" } });
    expect(screen.getByRole("button", { name: "Add folder" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    expect(onUpdateConfig).toHaveBeenCalledWith({ userExtensionPaths: ["/other-extensions"] });

    rerenderWith({ extensionLock: true });
    expect(screen.getByRole("button", { name: "Extension folder" })).toBeDisabled();
  });

  it("requires a fresh acknowledgement when the local extension flow is reopened", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add local folder…" }));
    fireEvent.click(screen.getByRole("button", { name: "Extension folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Local resource folder" }), { target: { value: "/first-extensions" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Add local folder…" }));
    expect(screen.getByRole("button", { name: "Add folder" })).toBeDisabled();
  });

  it("suggests an editable clone folder and previews before enrollment", () => {
    const { onSuggestClonePath, onCloneRepository, onEnrollRepository, rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    const address = screen.getByRole("textbox", { name: "Repository address" });
    fireEvent.change(address, { target: { value: "https://example.test/team/resources.git" } });
    fireEvent.blur(address);
    expect(onSuggestClonePath).toHaveBeenCalledWith("https://example.test/team/resources.git");
    rerenderWith({ operations: operations({ clonePath: { requestId: "path", status: "ready", path: "/managed/resources-a1b2" } }) });
    const destination = screen.getByRole("textbox", { name: "Local clone folder" });
    expect(destination).toHaveValue("/managed/resources-a1b2");
    fireEvent.change(destination, { target: { value: "/srv/custom/resources" } });
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    expect(onCloneRepository).toHaveBeenCalledWith("https://example.test/team/resources.git", "/srv/custom/resources");
    expect(onEnrollRepository).not.toHaveBeenCalled();

    rerenderWith({ operations: operations({ preview: { requestId: "preview", status: "ready", preview: {
      token: "preview-token",
      repositoryPath: "/srv/custom/resources",
      repositoryName: "resources",
      headRevision: "abc",
      mode: "roots",
      skills: [],
      roots: [{ kind: "skill", path: "/srv/custom/resources/skills", name: "skills" }],
    } } }) });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEnrollRepository).toHaveBeenCalledWith("preview-token", ["/srv/custom/resources/skills"], []);
  });

  it("requires explicit trust before enrolling extensions discovered in a repository", () => {
    const { onEnrollRepository } = setup({ operations: operations({ preview: { requestId: "preview", status: "ready", preview: {
      token: "preview-token",
      repositoryPath: "/srv/custom/resources",
      repositoryName: "resources",
      headRevision: "abc",
      mode: "roots",
      skills: [],
      roots: [{ kind: "extension", path: "/srv/custom/resources/extensions", name: "extensions" }],
    } } }) });
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    expect(screen.getByText(/Extensions execute code/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I trust the selected extension roots/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEnrollRepository).toHaveBeenCalledWith("preview-token", [], ["/srv/custom/resources/extensions"]);
  });

  it("keeps the clone folder name when choosing a different parent", () => {
    const { onBrowseServerPath, onCloseServerBrowser, rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Local clone folder" }), { target: { value: "/managed/team-resources-a1b2" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose parent…" }));
    expect(onBrowseServerPath).toHaveBeenCalledWith("/managed");
    rerenderWith({ serverBrowse: { status: "loaded", path: "/srv/resources", parent: "/srv", entries: [], requestId: "parent" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this directory" }));
    expect(screen.getByRole("textbox", { name: "Local clone folder" })).toHaveValue("/srv/resources/team-resources-a1b2");
    expect(onCloseServerBrowser).toHaveBeenCalled();
  });

  it("handles adversarial clone paths without regex backtracking", () => {
    const { onBrowseServerPath } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    const destination = screen.getByRole("textbox", { name: "Local clone folder" });
    fireEvent.change(destination, { target: { value: `${"/".repeat(30_000)}resources` } });

    const startedAt = performance.now();
    fireEvent.click(screen.getByRole("button", { name: "Choose parent…" }));

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(onBrowseServerPath).toHaveBeenCalledOnce();
  });

  it("does not overwrite a clone folder edited while a suggestion is pending", () => {
    const { rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    const address = screen.getByRole("textbox", { name: "Repository address" });
    fireEvent.change(address, { target: { value: "https://example.test/team/resources.git" } });
    fireEvent.blur(address);
    const destination = screen.getByRole("textbox", { name: "Local clone folder" });
    fireEvent.change(destination, { target: { value: "/srv/my-choice" } });
    rerenderWith({ operations: operations({ clonePath: { requestId: "late", status: "ready", path: "/managed/late-suggestion" } }) });
    expect(destination).toHaveValue("/srv/my-choice");
  });

  it("keeps focus where the user put it when the parent re-renders", () => {
    // SettingsMenu passes a fresh onClose on every one of its renders, and the
    // server pushes inventory and assessment updates while the dialog is open.
    // The focus effect used to depend on that identity, so every push pulled the
    // caret out of whatever the user was typing into.
    const { rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    const address = screen.getByRole("textbox", { name: "Repository address" });
    address.focus();
    fireEvent.change(address, { target: { value: "https://exam" } });

    rerenderWith({ onClose: () => {}, inventory: inventory("current") });

    expect(document.activeElement).toBe(address);
    expect(address).toHaveValue("https://exam");
  });

  it("still moves focus into the dialog when it opens", () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close agent resources" }));
  });

  it("still closes on Escape after the parent has re-rendered", () => {
    const { rerenderWith } = setup();
    const laterClose = vi.fn();
    rerenderWith({ onClose: laterClose });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(laterClose).toHaveBeenCalled();
  });

  it("stops showing a refused address once the field no longer holds it", () => {
    const { rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    const address = screen.getByRole("textbox", { name: "Repository address" });
    fireEvent.change(address, { target: { value: "https:" } });
    fireEvent.blur(address);
    rerenderWith({ operations: operations({ clonePath: { requestId: "one", status: "error", message: "Use an HTTPS, SSH, Git, file, or user@host:path repository address" } }) });
    expect(screen.getByRole("alert")).toHaveTextContent("Use an HTTPS");

    fireEvent.change(screen.getByRole("textbox", { name: "Repository address" }), { target: { value: "https://example.test/team/resources.git" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes only the selected user-owned root", () => {
    const { onUpdateConfig } = setup({ userSkillPaths: ["/repos/team/skills", "/other"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove /repos/team/skills" }));
    expect(onUpdateConfig).toHaveBeenCalledWith({ userSkillPaths: ["/other"] });
  });

  it("offers no extension removal control when extension paths are locked", () => {
    setup({ extensionLock: true, userExtensionPaths: ["/repos/team/extensions"] });
    expect(screen.queryByRole("button", { name: "Remove /repos/team/extensions" })).not.toBeInTheDocument();
  });

  it("keeps the preview visible when an expired or reused token is refused", () => {
    setup({ operations: operations({
      preview: { requestId: "preview", status: "ready", preview: {
        token: "expired-token",
        repositoryPath: "/srv/resources",
        repositoryName: "resources",
        headRevision: "abc",
        mode: "roots",
        skills: [],
        roots: [{ kind: "skill", path: "/srv/resources/skills", name: "skills" }],
      } },
      enrollment: { requestId: "enroll", status: "error", message: "This repository preview has expired; preview it again" },
    }) });
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    expect(screen.getByTestId("resource-preview")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("expired");
  });

  it("filters groups without leaving details on a hidden selection", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Provenance unavailable/ }));
    expect(screen.getByText("remote-only")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search resources" }), { target: { value: "team" } });
    expect(screen.queryByText("remote-only")).not.toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("filters by kind and attention while preserving a matching repository context", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /extensions/i }));
    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(screen.queryByText("review")).not.toBeInTheDocument();
    expect(screen.queryByText("remote-only")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /team-resources/ })).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
    expect(screen.getByRole("button", { name: /team-resources/ })).toBeInTheDocument();
    expect(screen.getByText("deploy")).toBeInTheDocument();
  });

  it("directs dirty repositories to external resolution without mutation controls", () => {
    setup({ inventory: inventory("dirty") });
    expect(screen.getByText(/external terminal/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update repository" })).not.toBeInTheDocument();
    for (const forbidden of ["Commit", "Stash", "Discard", "Rebase", "Merge"]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
  });

  // openlore: scenario=UpdateIsOfferedOnlyWhenThereIsOne spec=components
  it("offers Update repository only once an update is available", () => {
    const { rerenderWith } = setup({ inventory: inventory("unchecked") });
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update repository" })).not.toBeInTheDocument();
    rerenderWith({ inventory: inventory("current") });
    expect(screen.queryByRole("button", { name: "Update repository" })).not.toBeInTheDocument();
    rerenderWith({ inventory: inventory("updateable") });
    expect(screen.getByRole("button", { name: "Update repository" })).toBeEnabled();
    rerenderWith({ inventory: inventory("unchecked"), operations: operations({ updates: { "repo-team": { requestId: "u", status: "loading" } } }) });
    expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();
  });

  it("confirms revision-specific executable changes before invoking update", () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Update repository" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("11111111");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("22222222");
    fireEvent.click(screen.getByRole("button", { name: "Confirm executable update" }));
    expect(onUpdate).toHaveBeenCalledWith("repo-team", "token-repo-team", "1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222", true);
  });

  it("lets a discovered root be deselected before anything is enrolled", () => {
    // Every root arrives selected, and the point of a preview is that the user may want
    // only some of them. Nothing had exercised unticking one.
    const { onEnrollRepository, rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository address" }), { target: { value: "https://example.test/team/resources.git" } });
    rerenderWith({ operations: operations({ preview: { requestId: "preview", status: "ready", preview: {
      token: "preview-token",
      repositoryPath: "/srv/resources",
      repositoryName: "resources",
      headRevision: "abc",
      mode: "roots",
      skills: [],
      roots: [
        { kind: "skill", path: "/srv/resources/skills", name: "skills" },
        { kind: "skill", path: "/srv/resources/.agents/skills", name: ".agents/skills" },
      ],
    } } }) });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEnrollRepository).toHaveBeenCalledWith("preview-token", ["/srv/resources/skills"], []);

    // ...and unticking the last one leaves nothing to activate.
    fireEvent.click(checkboxes[0]);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("closes on Escape and on a click outside the dialog, but not on a click inside it", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Agent resources" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("asks for a refresh, and says nothing while one is running", () => {
    const { onRefresh, rerenderWith } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Refresh all" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerenderWith({ operations: operations({ refresh: { requestId: "refresh", status: "loading" } }) });
    expect(screen.getByRole("button", { name: "Refresh all" })).toBeDisabled();
  });

  it("removes a user-owned extension root from the extension paths, not the skill paths", () => {
    // The skill half of this branch was covered; the extension half sends a different
    // config key, and sending the wrong one would drop an unrelated skill.
    const { onUpdateConfig } = setup({
      userExtensionPaths: ["/repos/team/extensions"],
      inventory: {
        capabilities: { skills: "available", extensions: "available" },
        resources: [
          { id: "extension:deploy", kind: "extension", name: "deploy", origin: "user", path: "/repos/team/extensions/deploy.ts", userRoot: "/repos/team/extensions" },
        ],
        repositories: [],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove /repos/team/extensions" }));
    expect(onUpdateConfig).toHaveBeenCalledWith({ userExtensionPaths: [] });
  });

  it("leaves the update alone when the executable confirmation is declined", () => {
    // The confirming half is covered; declining must not fall through to the update.
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Update repository" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("abandons the add flow and closes the server browser with it", () => {
    const { onCloseServerBrowser } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCloseServerBrowser).toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Repository address" })).not.toBeInTheDocument();
  });

  it("keeps an in-flight result keyed to its repository and falls back after stale identity", () => {
    const { rerenderWith } = setup({ operations: operations({ updates: { "repo-team": { requestId: "update", status: "loading" } } }) });
    fireEvent.click(screen.getByRole("button", { name: /Provenance unavailable/ }));
    expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
    rerenderWith({ inventory: { ...inventory(), repositories: [], resources: [inventory().resources[2]] } });
    expect(screen.getByText("remote-only")).toBeInTheDocument();
    expect(screen.queryByText("team-resources")).not.toBeInTheDocument();
  });
});

const COLLECTION_SKILLS: AgentCollectionSkill[] = [
  { relativePath: "agent-skills/a2a", name: "a2a", group: "agent-skills", state: "off" },
  { relativePath: "dev-skills/react", name: "react", group: "dev-skills", state: "on-not-loaded", reason: "Another skill named \"react\" was loaded first, from /elsewhere/react/SKILL.md" },
  { relativePath: "dev-skills/rust", name: "rust", group: "dev-skills", state: "on-loaded" },
  { relativePath: "skills/agent-a2a", name: "agent-a2a", group: "skills", state: "on-missing", reason: "This skill is no longer in the repository" },
];

function collectionRepository(overrides: Partial<AgentResourceRepository> = {}, skills: AgentCollectionSkill[] = COLLECTION_SKILLS): AgentResourceRepository {
  return {
    id: "repo-collection",
    name: "claude-skills-collection",
    path: "/repos/collection",
    resourceIds: [],
    containsExtensions: false,
    assessment: { repositoryId: "repo-collection", status: "unchecked" },
    collection: {
      skills,
      groups: [...new Set(skills.map((skill) => skill.group))].sort().map((group) => ({ path: group, label: group })),
    },
    removal: { allowed: true, deletesFiles: true, path: "/repos/collection" },
    ...overrides,
  };
}

const collectionInventory = (repository: AgentResourceRepository = collectionRepository(), extra: AgentResourceRepository[] = []): AgentResourceInventory => ({
  capabilities: { skills: "available", extensions: "available" },
  resources: [
    { id: "skill:rust", kind: "skill", name: "rust", origin: "runtime", path: "/repos/collection/dev-skills/rust/SKILL.md" },
    ...(extra.length ? inventory().resources.slice(0, 2) : []),
  ],
  repositories: [repository, ...extra],
});

const teamRepository = (): AgentResourceRepository => inventory().repositories[0];
const skillSwitch = (relativePath: string) => screen.getByRole("switch", { name: new RegExp(`\\(${relativePath}\\)`) });

describe("AgentResourceManager collections", () => {
  // openlore: scenario=CollectionSkillsAreGroupedByFolderWithSwitches spec=components
  it("lists a collection's skills by folder, with a switch each and an on-count per group", () => {
    setup({ inventory: collectionInventory() });
    expect(screen.getByRole("button", { name: /claude-skills-collection/ })).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: /^dev-skills/ })).toHaveTextContent("2/2 on");
    expect(screen.getByRole("button", { name: /^agent-skills/ })).toHaveTextContent("0/1 on");
    expect(skillSwitch("dev-skills/rust")).toBeChecked();
    expect(skillSwitch("agent-skills/a2a")).not.toBeChecked();
    expect(screen.getByText(/3 of 4 on/)).toBeInTheDocument();
  });

  // openlore: scenario=SkillStatesAreDistinguished spec=components
  it("renders each state distinctly, with the reason for the ones not loaded", () => {
    setup({ inventory: collectionInventory() });
    const row = (relativePath: string) => skillSwitch(relativePath).closest("label")!;
    expect(row("dev-skills/rust")).toHaveTextContent("Loaded");
    expect(row("dev-skills/react")).toHaveTextContent(/Not loaded — Another skill named "react" was loaded first/);
    expect(row("skills/agent-a2a")).toHaveTextContent(/Missing — This skill is no longer in the repository/);
    expect(row("agent-skills/a2a")).not.toHaveTextContent(/Loaded|Not loaded|Missing|Pending/);
  });

  // openlore: scenario=TheSkillsThatAreOnCanBeFound spec=components
  it("opens the folder holding a skill that is on in a large collection, and filters to the skills that are on", () => {
    const many: AgentCollectionSkill[] = [];
    for (const group of ["alpha", "beta", "gamma"]) {
      for (let index = 0; index < 20; index += 1) {
        many.push({ relativePath: `${group}/skill-${index}`, name: `${group}-skill-${index}`, group, state: "off" });
      }
    }
    many[25] = { ...many[25], state: "on-loaded" };
    setup({ inventory: { ...collectionInventory(collectionRepository({}, many)), resources: [] } });
    expect(screen.getByRole("button", { name: /^beta/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^alpha/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /^gamma/ })).toHaveAttribute("aria-expanded", "false");
    expect(skillSwitch("beta/skill-5")).toBeChecked();
    expect(screen.getByRole("region", { name: "Skills that are on" })).toHaveTextContent(/beta-skill-5\s*beta/);
    expect(screen.getByRole("button", { name: /claude-skills-collection/ })).toHaveTextContent("1 on · 60");
    fireEvent.click(screen.getByRole("button", { name: "Only on (1)" }));
    expect(screen.queryByRole("region", { name: "Skills that are on" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(skillSwitch("beta/skill-5")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Only on (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off beta-skill-5 (beta/skill-5)" }));
    expect(skillSwitch("beta/skill-5")).not.toBeChecked();
    expect(screen.getByText(/1 pending change\b/)).toBeInTheDocument();
  });

  // openlore: scenario=SearchNarrowsACollectionsSkills spec=components
  it("narrows the skills by search, and a folder's All on then acts on its matches only", () => {
    setup({ inventory: collectionInventory() });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), { target: { value: "rea" } });
    expect(screen.getAllByRole("switch").map((element) => element.getAttribute("aria-label"))).toEqual(["react (dev-skills/react)"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), { target: { value: "a2a" } });
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "All off in skills" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), { target: { value: "" } });
    expect(skillSwitch("skills/agent-a2a")).not.toBeChecked();
    expect(skillSwitch("dev-skills/rust")).toBeChecked();
    expect(skillSwitch("dev-skills/react")).toBeChecked();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), { target: { value: "no such skill" } });
    expect(screen.getByText("No skill matches.")).toBeInTheDocument();
  });

  it("folds and unfolds a folder group", () => {
    setup({ inventory: collectionInventory() });
    const group = screen.getByRole("button", { name: /^dev-skills/ });
    expect(group).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch", { name: /\(dev-skills\/rust\)/ })).not.toBeInTheDocument();
    fireEvent.click(group);
    expect(skillSwitch("dev-skills/rust")).toBeInTheDocument();
  });

  it("keeps a collection with nothing loaded in the list", () => {
    const allOff = COLLECTION_SKILLS.map((skill) => ({ ...skill, state: "off" as const, reason: undefined }));
    setup({ inventory: { ...collectionInventory(collectionRepository({}, allOff)), resources: [] } });
    expect(screen.getByRole("button", { name: /claude-skills-collection/ })).toHaveTextContent("4");
    expect(screen.getByText(/0 of 4 on/)).toBeInTheDocument();
  });

  // openlore: scenario=AllOnAndAllOffStageTheWholeRepository spec=components
  it("stages the whole repository with All on and All off, without calling back", () => {
    const { onSetSkills } = setup({ inventory: collectionInventory() });
    fireEvent.click(screen.getByRole("button", { name: "All on" }));
    for (const skill of COLLECTION_SKILLS) expect(skillSwitch(skill.relativePath)).toBeChecked();
    expect(skillSwitch("agent-skills/a2a").closest("label")).toHaveTextContent("Pending: on");
    expect(screen.getByText(/1 pending change\b/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All off" }));
    for (const skill of COLLECTION_SKILLS) expect(skillSwitch(skill.relativePath)).not.toBeChecked();
    expect(screen.getByText(/3 pending changes/)).toBeInTheDocument();
    expect(onSetSkills).not.toHaveBeenCalled();
  });

  // openlore: scenario=FolderLevelAllOnStagesOneGroupOnly spec=components
  it("stages one folder group with its own All on", () => {
    setup({ inventory: collectionInventory() });
    fireEvent.click(screen.getByRole("button", { name: "All off in dev-skills" }));
    expect(skillSwitch("dev-skills/react")).not.toBeChecked();
    expect(skillSwitch("dev-skills/rust")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "All on in agent-skills" }));
    expect(skillSwitch("agent-skills/a2a")).toBeChecked();
    expect(skillSwitch("skills/agent-a2a")).toBeChecked();
    expect(skillSwitch("dev-skills/rust")).not.toBeChecked();
  });

  // openlore: scenario=ApplyReportsTheWholePendingSelectionOnce spec=components
  it("applies the complete resulting selection once, letting go of skills that are gone", () => {
    const { onSetSkills } = setup({ inventory: collectionInventory() });
    fireEvent.click(skillSwitch("agent-skills/a2a"));
    fireEvent.click(skillSwitch("dev-skills/rust"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onSetSkills).toHaveBeenCalledTimes(1);
    expect(onSetSkills.mock.calls[0][0]).toBe("repo-collection");
    expect([...onSetSkills.mock.calls[0][1]].sort()).toEqual(["agent-skills/a2a", "dev-skills/react"]);
  });

  // openlore: scenario=DiscardRestoresTheSuppliedState spec=components
  it("discards pending changes back to the supplied state", () => {
    const { onSetSkills } = setup({ inventory: collectionInventory() });
    fireEvent.click(skillSwitch("agent-skills/a2a"));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(skillSwitch("agent-skills/a2a")).not.toBeChecked();
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument();
    expect(onSetSkills).not.toHaveBeenCalled();
  });

  // openlore: scenario=APendingSelectionStaysWithItsRepository spec=components
  it("keeps a pending selection with its own repository across a switch and back", () => {
    setup({ inventory: collectionInventory(collectionRepository(), [teamRepository()]) });
    fireEvent.click(screen.getByRole("button", { name: /claude-skills-collection/ }));
    fireEvent.click(skillSwitch("agent-skills/a2a"));
    expect(screen.getByText(/1 pending change\b/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /team-resources/ }));
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /claude-skills-collection/ }));
    expect(screen.getByText(/1 pending change\b/)).toBeInTheDocument();
    expect(skillSwitch("agent-skills/a2a")).toBeChecked();
  });

  it("keeps a pending selection across an unrelated inventory, and clears it once applied", () => {
    const { rerenderWith } = setup({ inventory: collectionInventory() });
    fireEvent.click(skillSwitch("agent-skills/a2a"));
    rerenderWith({ inventory: collectionInventory(collectionRepository({ assessment: { repositoryId: "repo-collection", status: "checking" } })) });
    expect(screen.getByText(/1 pending change\b/)).toBeInTheDocument();
    const applied = COLLECTION_SKILLS.map((skill) => (skill.relativePath === "agent-skills/a2a" ? { ...skill, state: "on-loaded" as const } : skill));
    rerenderWith({ inventory: collectionInventory(collectionRepository({}, applied)) });
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument();
    expect(skillSwitch("agent-skills/a2a")).toBeChecked();
  });

  it("drops a pending selection whose repository vanished", () => {
    const { rerenderWith } = setup({ inventory: collectionInventory() });
    fireEvent.click(skillSwitch("agent-skills/a2a"));
    rerenderWith({ inventory: { ...collectionInventory(), repositories: [] } });
    rerenderWith({ inventory: collectionInventory() });
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument();
    expect(skillSwitch("agent-skills/a2a")).not.toBeChecked();
  });

  it("shows an apply in flight and a refused one", () => {
    const { rerenderWith } = setup({ inventory: collectionInventory() });
    fireEvent.click(skillSwitch("agent-skills/a2a"));
    rerenderWith({ operations: operations({ skills: { "repo-collection": { requestId: "s", status: "loading" } } }) });
    expect(screen.getByText("Applying…")).toBeInTheDocument();
    expect(skillSwitch("dev-skills/rust")).toBeDisabled();
    rerenderWith({ operations: operations({ skills: { "repo-collection": { requestId: "s", status: "error", message: "workspace-b is busy; wait for its current turn to finish" } } }) });
    expect(screen.getByRole("alert")).toHaveTextContent("is busy");
    expect(skillSwitch("agent-skills/a2a")).toBeChecked();
  });

  // openlore: scenario=AddRepositoryPreviewsRootsBeforeApplying spec=components
  it("previews a collection with every skill off and adds it with nothing on", () => {
    const preview: AgentResourceRepositoryPreview = {
      token: "collection-token",
      repositoryPath: "/srv/collection",
      repositoryName: "collection",
      headRevision: "abc",
      mode: "collection",
      roots: [],
      skills: [
        { relativePath: "dev-skills/react", name: "react", group: "dev-skills" },
        { relativePath: "agent-skills/a2a", name: "a2a", group: "agent-skills" },
      ],
    };
    const { onEnrollRepository } = setup({ operations: operations({ preview: { requestId: "p", status: "ready", preview } }) });
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    expect(skillSwitch("dev-skills/react")).not.toBeChecked();
    expect(skillSwitch("agent-skills/a2a")).not.toBeChecked();
    expect(screen.getByRole("heading", { name: "collection" })).toBeInTheDocument();
    fireEvent.click(skillSwitch("dev-skills/react"));
    fireEvent.click(skillSwitch("dev-skills/react"));
    expect(onEnrollRepository).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEnrollRepository).toHaveBeenCalledWith("collection-token", [], [], []);
  });

  it("adds a previewed collection with the skills turned on", () => {
    const preview: AgentResourceRepositoryPreview = {
      token: "collection-token",
      repositoryPath: "/srv/collection",
      repositoryName: "collection",
      headRevision: "abc",
      mode: "collection",
      roots: [],
      skills: [
        { relativePath: "dev-skills/react", name: "react", group: "dev-skills" },
        { relativePath: "dev-skills/rust", name: "rust", group: "dev-skills" },
        { relativePath: "agent-skills/a2a", name: "a2a", group: "agent-skills" },
      ],
    };
    const { onEnrollRepository } = setup({ operations: operations({ preview: { requestId: "p", status: "ready", preview } }) });
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    fireEvent.click(skillSwitch("dev-skills/rust"));
    fireEvent.click(skillSwitch("agent-skills/a2a"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEnrollRepository).toHaveBeenCalledTimes(1);
    const [token, roots, extensions, enabled] = onEnrollRepository.mock.calls[0];
    expect([token, roots, extensions]).toEqual(["collection-token", [], []]);
    expect([...enabled].sort()).toEqual(["agent-skills/a2a", "dev-skills/rust"]);
  });

  // openlore: scenario=RemoveRepositoryRequiresConfirmation spec=components
  it("confirms before removing, names the path, and does nothing on cancel", () => {
    const { onRemoveRepository } = setup({ inventory: collectionInventory() });
    fireEvent.click(screen.getByRole("button", { name: "Remove repository" }));
    const dialog = screen.getByRole("alertdialog", { name: /Remove claude-skills-collection/ });
    expect(dialog).toHaveTextContent("/repos/collection");
    expect(dialog).toHaveTextContent("cannot be undone");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onRemoveRepository).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove repository" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete and remove" }));
    expect(onRemoveRepository).toHaveBeenCalledWith("repo-collection");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  // openlore: scenario=RemovingAnUnmanagedRepositorySaysTheFilesStay spec=components
  it("says the files stay when pi-outpost does not manage the repository", () => {
    const { onRemoveRepository } = setup({ inventory: collectionInventory(collectionRepository({ removal: { allowed: true, deletesFiles: false, path: "/repos/collection" } })) });
    fireEvent.click(screen.getByRole("button", { name: "Remove repository" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/files will be kept/);
    expect(dialog).not.toHaveTextContent(/cannot be undone/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove repository" }));
    expect(onRemoveRepository).toHaveBeenCalledWith("repo-collection");
  });

  // openlore: scenario=AConfigurationFileRepositoryCannotBeRemovedHere spec=components
  it("offers no removal for a configuration-file repository, and says why", () => {
    setup({ inventory: collectionInventory(collectionRepository({
      removal: { allowed: false, deletesFiles: false, path: "/repos/collection", reason: "This repository supplies a path from the configuration file, so it can only be removed there" },
    })) });
    expect(screen.queryByRole("button", { name: "Remove repository" })).not.toBeInTheDocument();
    expect(screen.getByText(/can only be removed there/)).toBeInTheDocument();
  });

  it("shows what removal did after the repository has left the list", () => {
    const { rerenderWith } = setup({ inventory: collectionInventory(collectionRepository(), [teamRepository()]) });
    fireEvent.click(screen.getByRole("button", { name: /claude-skills-collection/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete and remove" }));
    rerenderWith({ operations: operations({ removals: { "repo-collection": { requestId: "r", status: "loading" } } }) });
    expect(screen.getByRole("status")).toHaveTextContent("Removing claude-skills-collection…");
    rerenderWith({
      inventory: inventory(),
      operations: operations({ removals: { "repo-collection": { requestId: "r", status: "ready", result: { status: "removed-delete-failed", path: "/repos/collection", reason: "Could not delete every file: EBUSY" } } } }),
    });
    expect(screen.queryByRole("button", { name: /claude-skills-collection/ })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/not every file could be deleted — Could not delete every file: EBUSY\. What remains is at \/repos\/collection/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
