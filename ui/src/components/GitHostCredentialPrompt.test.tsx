import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentResourceInventory, GitAuthFailure } from "@pi-outpost/shared";
import type { AgentResourceOperationState, GitHostCredentialState } from "../useAgent";
import { AgentResourceManager } from "./AgentResourceManager";
import { GitHostList } from "./GitHostCredentialPrompt";

const HTTPS: GitAuthFailure = { scheme: "https", host: "https://git.acme.example:8447" };
const SSH: GitAuthFailure = { scheme: "ssh", host: "git.acme.example" };

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

const cloneRefused = (auth: GitAuthFailure, requestId = "p1") =>
  operations({ preview: { requestId, status: "error", message: `Could not clone: ${auth.host} requires authentication`, auth } });

const inventory = (auth?: GitAuthFailure): AgentResourceInventory => ({
  capabilities: { skills: "available", extensions: "available" },
  resources: [{ id: "skill:demo", kind: "skill", name: "demo", origin: "user", path: "/repos/demo/skills/demo/SKILL.md" }],
  repositories: [{
    id: "repo-demo",
    name: "demo",
    path: "/repos/demo",
    resourceIds: ["skill:demo"],
    containsExtensions: false,
    assessment: auth
      ? { repositoryId: "repo-demo", status: "failed", reason: `${auth.host.replace("https://", "")} requires authentication (fatal: …)`, auth }
      : { repositoryId: "repo-demo", status: "unchecked" },
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
    onSetGitHostCredential: vi.fn(() => "g1"),
  };
  const base = {
    open: true,
    inventory: inventory(),
    operations: operations(),
    extensionLock: false,
    userSkillPaths: [],
    userExtensionPaths: [],
    serverBrowse: null,
    applyState: null,
    credentialsLocked: false,
    gitHostCredential: null as GitHostCredentialState | null,
    ...callbacks,
    ...overrides,
  };
  let props = base;
  const view = render(<AgentResourceManager {...props} />);
  return {
    ...callbacks,
    ...view,
    /** Cumulative: each call changes only what it names, like the real state does. */
    update: (next: Record<string, unknown>) => {
      props = { ...props, ...next };
      view.rerender(<AgentResourceManager {...props} />);
    },
  };
}

/** Open Add Git repository and fill both fields, as a person would before cloning. */
function startClone(address = "https://git.acme.example:8447/team/demo.git", folder = "/srv/resources/demo") {
  fireEvent.click(screen.getByRole("button", { name: "Add Git repository…" }));
  fireEvent.change(screen.getByLabelText("Repository address"), { target: { value: address } });
  fireEvent.change(screen.getByLabelText("Local clone folder"), { target: { value: folder } });
}

function enterCredential(username: string, secret: string) {
  fireEvent.change(screen.getByLabelText("Git user name"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("Git password or token"), { target: { value: secret } });
  fireEvent.click(screen.getByRole("button", { name: "Save and retry" }));
}

describe("a host that wants credentials, when adding a repository", () => {
  // openlore: scenario=Clone asks, stores and retries spec=git-host-credentials
  it("Clone asks, stores and retries: the host is named, the credential is stored, then the same clone runs again", () => {
    const view = setup();
    startClone();
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    expect(view.onCloneRepository).toHaveBeenCalledTimes(1);
    view.update({ operations: cloneRefused(HTTPS) });

    const form = screen.getByRole("form", { name: "Credentials for git.acme.example:8447" });
    expect(within(form).getByText("git.acme.example:8447 requires authentication")).toBeInTheDocument();
    enterCredential("alice", "tok-123");
    expect(view.onSetGitHostCredential).toHaveBeenCalledWith(HTTPS.host, "alice", "tok-123");
    // Not retried on submit: the server has not stored it yet.
    expect(view.onCloneRepository).toHaveBeenCalledTimes(1);

    view.update({ gitHostCredential: { requestId: "g1", status: "saving" } });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    view.update({ gitHostCredential: { requestId: "g1", status: "saved", host: HTTPS.host } });
    expect(view.onCloneRepository).toHaveBeenCalledTimes(2);
    expect(view.onCloneRepository).toHaveBeenLastCalledWith("https://git.acme.example:8447/team/demo.git", "/srv/resources/demo");
  });

  // openlore: scenario=A wrong secret is said on the prompt spec=git-host-credentials
  it("A wrong secret is said on the prompt: it stays open, says so, and the address and folder are kept", () => {
    const view = setup();
    startClone();
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    view.update({ operations: cloneRefused(HTTPS) });
    enterCredential("alice", "wrong");
    view.update({ gitHostCredential: { requestId: "g1", status: "saved", host: HTTPS.host } });
    view.update({ operations: operations({ preview: { requestId: "p2", status: "loading" } }) });
    view.update({ operations: cloneRefused(HTTPS, "p2") });

    expect(screen.getByRole("alert")).toHaveTextContent("git.acme.example:8447 refused this user name or secret");
    expect(screen.getByRole("form", { name: "Credentials for git.acme.example:8447" })).toBeInTheDocument();
    expect(screen.getByLabelText("Repository address")).toHaveValue("https://git.acme.example:8447/team/demo.git");
    expect(screen.getByLabelText("Local clone folder")).toHaveValue("/srv/resources/demo");
    expect(screen.getByLabelText("Git user name")).toHaveValue("alice");
    expect(screen.getByLabelText("Git password or token")).toHaveValue("");
  });

  it("an address edited while the credential is being stored cancels the retry", () => {
    const view = setup();
    startClone();
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    view.update({ operations: cloneRefused(HTTPS) });
    enterCredential("alice", "tok");
    fireEvent.change(screen.getByLabelText("Repository address"), { target: { value: "https://elsewhere.example/x.git" } });
    view.update({ gitHostCredential: { requestId: "g1", status: "saved", host: HTTPS.host } });
    expect(view.onCloneRepository).toHaveBeenCalledTimes(1);
  });

  it("cancelling Add Git repository while the credential is being stored cancels the retry", () => {
    const view = setup();
    startClone();
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    view.update({ operations: cloneRefused(HTTPS) });
    enterCredential("alice", "tok");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    view.update({ gitHostCredential: { requestId: "g1", status: "saved", host: HTTPS.host } });
    expect(view.onCloneRepository).toHaveBeenCalledTimes(1);
  });

  it("closing the dialog while the credential is being stored cancels the retry", () => {
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: /^demo/ }));
    view.update({ inventory: inventory(HTTPS) });
    enterCredential("alice", "tok");
    view.update({ open: false });
    view.update({ open: true, gitHostCredential: { requestId: "g1", status: "saved", host: HTTPS.host } });
    expect(view.onRefresh).not.toHaveBeenCalled();
  });

  it("a store the server refused is said on the prompt and nothing is retried", () => {
    const view = setup();
    startClone();
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    view.update({ operations: cloneRefused(HTTPS) });
    enterCredential("alice", "tok");
    view.update({ gitHostCredential: { requestId: "g1", status: "error", message: "Credentials are kept for HTTPS hosts only" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Credentials are kept for HTTPS hosts only");
    expect(view.onCloneRepository).toHaveBeenCalledTimes(1);
  });

  it("a double submit stores once", () => {
    const view = setup();
    startClone();
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    view.update({ operations: cloneRefused(HTTPS) });
    fireEvent.change(screen.getByLabelText("Git user name"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Git password or token"), { target: { value: "tok" } });
    const submit = screen.getByRole("button", { name: "Save and retry" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(view.onSetGitHostCredential).toHaveBeenCalledTimes(1);
  });

  // openlore: scenario=SSH is pointed to the documentation spec=git-host-credentials
  it("SSH is pointed to the documentation: the host is named, no fields are offered", () => {
    const view = setup();
    startClone("git@git.acme.example:team/demo.git");
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    view.update({ operations: cloneRefused(SSH) });
    expect(screen.getByRole("alert")).toHaveTextContent("git.acme.example refused SSH authentication");
    expect(screen.getByRole("link", { name: "How to configure Git credentials" })).toHaveAttribute("href", expect.stringContaining("#git-credentials-for-agent-resources"));
    expect(screen.queryByLabelText("Git password or token")).toBeNull();
  });

  // openlore: scenario=A locked server does not prompt spec=git-host-credentials
  it("A locked server does not prompt: it names the host and says credentials are locked here", () => {
    const view = setup({ credentialsLocked: true });
    startClone();
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    view.update({ operations: cloneRefused(HTTPS) });
    expect(screen.getByRole("alert")).toHaveTextContent("git.acme.example:8447 requires authentication");
    expect(screen.getByRole("alert")).toHaveTextContent("Credentials are locked on this server");
    expect(screen.queryByLabelText("Git password or token")).toBeNull();
  });

  it("a failure that is not authentication keeps the plain error", () => {
    const view = setup();
    startClone();
    fireEvent.click(screen.getByRole("button", { name: "Clone and inspect" }));
    view.update({ operations: operations({ preview: { requestId: "p1", status: "error", message: "Could not clone: fatal: repository not found" } }) });
    expect(screen.getByRole("alert")).toHaveTextContent("fatal: repository not found");
    expect(screen.queryByLabelText("Git user name")).toBeNull();
  });
});

describe("a host that wants credentials, on refresh", () => {
  // openlore: scenario=Refresh asks too spec=git-host-credentials
  it("Refresh asks too: the repository's row asks, stores, then checks that repository again", () => {
    const view = setup({ inventory: inventory(HTTPS) });
    fireEvent.click(screen.getByRole("button", { name: /^demo/ }));
    const form = screen.getByRole("form", { name: "Credentials for git.acme.example:8447" });
    expect(form).toBeInTheDocument();
    enterCredential("alice", "tok");
    expect(view.onSetGitHostCredential).toHaveBeenCalledWith(HTTPS.host, "alice", "tok");
    view.update({ gitHostCredential: { requestId: "g1", status: "saved", host: HTTPS.host } });
    expect(view.onRefresh).toHaveBeenCalledWith("repo-demo");
  });

  it("a check started by hand after a retry does not blame the credential typed earlier", () => {
    const view = setup({ inventory: inventory(HTTPS) });
    fireEvent.click(screen.getByRole("button", { name: /^demo/ }));
    enterCredential("alice", "tok");
    view.update({ gitHostCredential: { requestId: "g1", status: "saved", host: HTTPS.host } });
    // The retry was refused: that is about the credential.
    view.update({ operations: operations({ refresh: { requestId: "r1", repositoryId: "repo-demo", status: "ready" } }) });
    expect(screen.getByRole("alert")).toHaveTextContent("refused this user name or secret");
    // Later the person checks again themselves (the credential was removed meanwhile): no blame.
    fireEvent.click(screen.getByRole("button", { name: "Check", exact: true }));
    view.update({ operations: operations({ refresh: { requestId: "r2", repositoryId: "repo-demo", status: "ready" } }) });
    expect(screen.queryByText(/refused this user name or secret/)).toBeNull();
    expect(screen.getByRole("form", { name: "Credentials for git.acme.example:8447" })).toBeInTheDocument();
  });

  it("while that check runs, the prompt steps aside", () => {
    setup({ inventory: inventory(HTTPS), operations: operations({ refresh: { requestId: "r1", repositoryId: "repo-demo", status: "loading" } }) });
    fireEvent.click(screen.getByRole("button", { name: /^demo/ }));
    expect(screen.queryByRole("form", { name: /Credentials for/ })).toBeNull();
  });
});

describe("Settings → Accounts → Git hosts", () => {
  // openlore: scenario=Removing a host spec=git-host-credentials
  it("Removing a host: hosts and user names are listed, never a secret, and removal names the host", () => {
    const onRemove = vi.fn(() => "g9");
    const view = render(<GitHostList hosts={[{ host: HTTPS.host, username: "alice" }]} locked={false} removing={null} onRemove={onRemove} />);
    const section = screen.getByRole("region", { name: "Git hosts" });
    expect(section).toHaveTextContent("git.acme.example:8447");
    expect(section).toHaveTextContent("alice");
    fireEvent.click(screen.getByRole("button", { name: "Remove the credential for git.acme.example:8447" }));
    expect(onRemove).toHaveBeenCalledWith(HTTPS.host);
    view.rerender(<GitHostList hosts={[{ host: HTTPS.host, username: "alice" }]} locked={false} removing={{ requestId: "g9", status: "saving" }} onRemove={onRemove} />);
    expect(screen.getByRole("button", { name: "Remove the credential for git.acme.example:8447" })).toHaveTextContent("Removing…");
    view.rerender(<GitHostList hosts={[]} locked={false} removing={{ requestId: "g9", status: "saved", host: HTTPS.host }} onRemove={onRemove} />);
    expect(section).toHaveTextContent("No Git host credential stored");
  });

  it("a locked server lists hosts without a remove action", () => {
    render(<GitHostList hosts={[{ host: HTTPS.host, username: "alice" }]} locked onRemove={vi.fn(() => "x")} removing={null} />);
    expect(screen.getByRole("region", { name: "Git hosts" })).toHaveTextContent("alice");
    expect(screen.queryByRole("button", { name: /Remove the credential/ })).toBeNull();
  });

  it("a refused removal is said", () => {
    const onRemove = vi.fn(() => "g9");
    const view = render(<GitHostList hosts={[{ host: HTTPS.host, username: "alice" }]} locked={false} removing={null} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /Remove the credential/ }));
    view.rerender(<GitHostList hosts={[{ host: HTTPS.host, username: "alice" }]} locked={false} removing={{ requestId: "g9", status: "error", message: "Credentials are locked on this server" }} onRemove={onRemove} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Credentials are locked on this server");
  });
});
