import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentResourceInventory, AgentResourceRepositoryAssessment } from "@pi-outpost/shared";
import type { AgentResourceOperationState } from "../useAgent";
import { AgentResourceManager } from "./AgentResourceManager";

const operations = (overrides: Partial<AgentResourceOperationState> = {}): AgentResourceOperationState => ({
  clonePath: null,
  preview: null,
  enrollment: null,
  refresh: null,
  updates: {},
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
      roots: [{ kind: "skill", path: "/srv/custom/resources/skills", name: "skills" }],
    } } }) });
    fireEvent.click(screen.getByRole("button", { name: "Activate selected resources" }));
    expect(onEnrollRepository).toHaveBeenCalledWith("preview-token", ["/srv/custom/resources/skills"], []);
  });

  it("requires explicit trust before enrolling extensions discovered in a repository", () => {
    const { onEnrollRepository } = setup({ operations: operations({ preview: { requestId: "preview", status: "ready", preview: {
      token: "preview-token",
      repositoryPath: "/srv/custom/resources",
      repositoryName: "resources",
      headRevision: "abc",
      roots: [{ kind: "extension", path: "/srv/custom/resources/extensions", name: "extensions" }],
    } } }) });
    fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
    expect(screen.getByText(/Extensions execute code/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate selected resources" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I trust the selected extension roots/ }));
    fireEvent.click(screen.getByRole("button", { name: "Activate selected resources" }));
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
    expect(screen.queryByText("remote-only")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
    expect(screen.getByRole("button", { name: /team-resources/ })).toBeInTheDocument();
    expect(screen.getByText("deploy")).toBeInTheDocument();
  });

  it("directs dirty repositories to external resolution without mutation controls", () => {
    setup({ inventory: inventory("dirty") });
    expect(screen.getByText(/external terminal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update repository" })).toBeDisabled();
    for (const forbidden of ["Commit", "Stash", "Discard", "Rebase", "Merge"]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
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

  it("keeps an in-flight result keyed to its repository and falls back after stale identity", () => {
    const { rerenderWith } = setup({ operations: operations({ updates: { "repo-team": { requestId: "update", status: "loading" } } }) });
    fireEvent.click(screen.getByRole("button", { name: /Provenance unavailable/ }));
    expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
    rerenderWith({ inventory: { ...inventory(), repositories: [], resources: [inventory().resources[2]] } });
    expect(screen.getByText("remote-only")).toBeInTheDocument();
    expect(screen.queryByText("team-resources")).not.toBeInTheDocument();
  });
});
