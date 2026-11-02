/**
 * The pi packages in Settings: what each says, and the confirmations in front of the
 * two actions that change what runs.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PiPackageInfo } from "@pi-outpost/shared";
import { PiPackages, parsePackageInput, type PiPackageEdits } from "./PiPackages";

const base = (overrides: Partial<PiPackageInfo> = {}): PiPackageInfo => ({
  source: "npm:@gotgenes/pi-permission-system",
  name: "@gotgenes/pi-permission-system",
  scope: "user",
  installed: "33.0.1",
  ...overrides,
});

function setup(props: Partial<React.ComponentProps<typeof PiPackages>> = {}) {
  const handlers = { onCheck: vi.fn(), onUpdate: vi.fn() };
  render(<PiPackages packages={[base()]} update={null} locked={false} {...handlers} {...props} />);
  return handlers;
}

const statusOf = (name: string) =>
  within(screen.getAllByTestId("pi-package").find((row) => row.textContent?.includes(name))!).getByTestId("pi-package-status").textContent;

describe("the packages listed", () => {
  it("say their version, a newer one, a failed check with its reason, pinned, and not installed", () => {
    // AnInstalledPackageIsListed, APinnedPackageIsSaidToBePinned, ANewerVersionIsShown, AFailedCheckIsNotUpToDate
    setup({
      packages: [
        base({ check: { state: "newer", latest: "33.1.0" } }),
        base({ source: "npm:openlore", name: "openlore", installed: "3.1.1", check: { state: "failed", reason: "the registry answered 503" } }),
        base({ source: "npm:fixed@1.0.0", name: "fixed", installed: "1.0.0", pinned: "1.0.0" }),
        base({ source: "npm:absent", name: "absent", installed: undefined }),
        base({ source: "npm:quiet", name: "quiet", installed: "2.0.0", check: { state: "off", reason: "update checks are turned off" } }),
      ],
    });
    expect(statusOf("pi-permission-system")).toBe("33.0.1 — 33.1.0 available");
    expect(statusOf("openlore")).toBe("3.1.1, not checked: the registry answered 503");
    expect(statusOf("openlore")).not.toMatch(/up to date/);
    expect(statusOf("fixed")).toBe("1.0.0, pinned");
    expect(statusOf("absent")).toBe("not installed");
    expect(statusOf("quiet")).toMatch(/turned off/);
    // CheckingOffLooksUpNothing: an update is offered only for a newer version.
    expect(screen.getAllByRole("button", { name: "Update" })).toHaveLength(1);
  });

  it("ask the server to look again", () => {
    const { onCheck } = setup();
    fireEvent.click(screen.getByRole("button", { name: "check for updates" }));
    expect(onCheck).toHaveBeenCalled();
  });
});

describe("updating a package", () => {
  it("is confirmed in place, naming both versions, and cancelling sends nothing", () => {
    // NothingIsSentWithoutConfirmation
    const { onUpdate } = setup({ packages: [base({ check: { state: "newer", latest: "33.1.0" } })] });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(screen.getByTestId("pi-package-confirm")).toHaveTextContent("@gotgenes/pi-permission-system 33.0.1 → 33.1.0");
    expect(screen.getByTestId("pi-package-confirm")).toHaveTextContent(/agent's privileges/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    fireEvent.click(screen.getByRole("button", { name: "Install 33.1.0" }));
    expect(onUpdate).toHaveBeenCalledWith("npm:@gotgenes/pi-permission-system");
  });

  it("is not offered when extensions are locked", () => {
    // LockedExtensionsOfferNoUpdate (interface half)
    setup({ packages: [base({ check: { state: "newer", latest: "33.1.0" } })], locked: true });
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("shows the answer, and an installed update as needing a restart", () => {
    // AConfirmedUpdateIsInstalledAndAsksForARestart (interface half)
    setup({
      packages: [base({ installed: "33.1.0", restartNeeded: true })],
      update: { requestId: "r", source: "npm:@gotgenes/pi-permission-system", status: "installed", message: "@gotgenes/pi-permission-system 33.1.0 is installed — restart pi-outpost to use it" },
    });
    expect(statusOf("pi-permission-system")).toBe("33.1.0 installed — restart to use it");
  });

  it("says a failed update in the package's own status line, and its progress there while it runs", () => {
    // AFailedInstallChangesNothing (interface half)
    const newer = base({ check: { state: "newer", latest: "33.1.0" } });
    const { rerender } = render(
      <PiPackages packages={[newer]} update={{ requestId: "r", source: newer.source, status: "pending" }} locked={false} onCheck={vi.fn()} onUpdate={vi.fn()} />,
    );
    expect(statusOf("pi-permission-system")).toBe("updating to 33.1.0…");
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
    rerender(
      <PiPackages
        packages={[newer]}
        update={{ requestId: "r", source: newer.source, status: "failed", message: "@gotgenes/pi-permission-system is still at 33.0.1" }}
        locked={false}
        onCheck={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(statusOf("pi-permission-system")).toBe("@gotgenes/pi-permission-system is still at 33.0.1");
  });
});

/** A host's add and remove actions, recorded; `state` sets what the hook would hold. */
function edits(state: Partial<Pick<PiPackageEdits, "lookup" | "change">> = {}): PiPackageEdits {
  return {
    lookup: null,
    change: null,
    projectName: "pi-outpost",
    onLookup: vi.fn(),
    onCloseLookup: vi.fn(),
    onInstall: vi.fn(),
    onRemove: vi.fn(),
    onRestore: vi.fn(),
    ...state,
  };
}

describe("adding a package", () => {
  it("AnEmptyListOffersToAddAPackage: an empty list says so and offers to add one", () => {
    setup({ packages: [], edits: edits() });
    expect(screen.getByTestId("pi-packages-empty")).toHaveTextContent("No packages installed");
    expect(screen.getByRole("button", { name: "Add a package" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "check for updates" })).toBeNull();
  });

  it("looks the typed name up, for all projects by default or for this project, named", () => {
    const host = edits();
    setup({ packages: [], edits: host });
    fireEvent.click(screen.getByRole("button", { name: "Add a package" }));
    const field = screen.getByLabelText("npm package");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "  npm:openlore@2.3.0 " } });
    fireEvent.click(screen.getByRole("button", { name: "Install…" }));
    expect(host.onLookup).toHaveBeenLastCalledWith("openlore", "2.3.0", "user");
    fireEvent.click(screen.getByLabelText(/this project only \(\s*pi-outpost\s*\)/));
    fireEvent.submit(field.closest("form")!);
    expect(host.onLookup).toHaveBeenLastCalledWith("openlore", "2.3.0", "project");
  });

  it("each add starts for all projects, even after one for this project", () => {
    setup({ packages: [], edits: edits() });
    fireEvent.click(screen.getByRole("button", { name: "Add a package" }));
    fireEvent.click(screen.getByLabelText(/this project only/));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a package" }));
    expect(screen.getByLabelText("all projects")).toBeChecked();
  });

  it("AnUnknownPackageIsRefusedInPlace: a refusal keeps the field open, with what was typed, below the buttons", () => {
    const host = edits();
    const { rerender } = render(<PiPackages packages={[]} update={null} locked={false} onCheck={vi.fn()} onUpdate={vi.fn()} edits={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a package" }));
    fireEvent.change(screen.getByLabelText("npm package"), { target: { value: "nope-xyz" } });
    const refused = edits({ lookup: { requestId: "l", name: "nope-xyz", scope: "user", status: "refused", message: "nope-xyz was not found on the registry" } });
    rerender(<PiPackages packages={[]} update={null} locked={false} onCheck={vi.fn()} onUpdate={vi.fn()} edits={refused} />);
    expect(screen.getByLabelText("npm package")).toHaveValue("nope-xyz");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("nope-xyz was not found on the registry");
    // Below the buttons: nothing above them moves when it appears.
    expect(screen.getByRole("button", { name: "Install…" }).compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Retyped, the answer about the old name is not shown against the new one.
    fireEvent.change(screen.getByLabelText("npm package"), { target: { value: "nope-xy" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("NoInstallWithoutConfirmation: a found package is confirmed, naming version and scope, and cancelling installs nothing", () => {
    const found = edits({ lookup: { requestId: "l", name: "openlore", scope: "project", status: "found", resolved: "2.4.1", message: "openlore 2.4.1" } });
    const { rerender } = render(<PiPackages packages={[]} update={null} locked={false} onCheck={vi.fn()} onUpdate={vi.fn()} edits={edits()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a package" }));
    fireEvent.click(screen.getByLabelText(/this project only/));
    fireEvent.change(screen.getByLabelText("npm package"), { target: { value: "openlore" } });
    rerender(<PiPackages packages={[]} update={null} locked={false} onCheck={vi.fn()} onUpdate={vi.fn()} edits={found} />);
    const confirm = screen.getByTestId("pi-package-add-confirm");
    expect(confirm).toHaveTextContent("openlore 2.4.1, for the pi-outpost project");
    expect(confirm).toHaveTextContent(/agent's privileges/);
    expect(confirm).toHaveTextContent(/takes effect when pi-outpost restarts/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(found.onCloseLookup).toHaveBeenCalled();
    expect(found.onInstall).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Install openlore" }));
    expect(found.onInstall).toHaveBeenCalledWith("openlore", undefined, "project", "2.4.1");
  });

  it("ADoubleConfirmationInstallsOnce: once confirmed, the confirmation gives way to progress", () => {
    const installing = edits({ change: { requestId: "c", key: "user:openlore", action: "install", status: "pending" } });
    setup({ packages: [], edits: installing });
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("installing openlore…");
  });

  it("AFailedInstallLeavesTheSettingsAlone: a failed install says why, where the add action is", () => {
    setup({
      packages: [],
      edits: edits({ change: { requestId: "c", key: "user:openlore", action: "install", status: "failed", message: "openlore was not installed: E404" } }),
    });
    expect(screen.getByRole("alert")).toHaveTextContent("openlore was not installed: E404");
    expect(screen.getByRole("button", { name: "Add a package" })).toBeEnabled();
  });

  it("parses a name with a scope and a version", () => {
    expect(parsePackageInput("@scope/name@1.2.3")).toEqual({ name: "@scope/name", version: "1.2.3" });
    expect(parsePackageInput("@scope/name")).toEqual({ name: "@scope/name" });
    expect(parsePackageInput("npm:openlore")).toEqual({ name: "openlore" });
  });
});

describe("removing and restoring a package", () => {
  it("NoRemovalWithoutConfirmation: removal is confirmed, naming the settings, and cancelling sends nothing", () => {
    const host = edits();
    setup({ packages: [base(), base({ source: "npm:pi-landstrip", name: "pi-landstrip", scope: "project", installed: "0.9.0" })], edits: host });
    fireEvent.click(screen.getByRole("button", { name: "Remove pi-landstrip" }));
    const confirm = screen.getByTestId("pi-package-confirm");
    expect(confirm).toHaveTextContent("Removes pi-landstrip from the pi-outpost project's settings and uninstalls it");
    expect(confirm).toHaveTextContent(/keeps running it until pi-outpost restarts/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(host.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove pi-landstrip" }));
    fireEvent.click(within(screen.getByTestId("pi-package-confirm")).getByRole("button", { name: "Remove" }));
    expect(host.onRemove).toHaveBeenCalledWith(expect.objectContaining({ name: "pi-landstrip", scope: "project" }));
  });

  it("AProjectPackageIsSaidToBeThisProjects, and a removed one is struck through with Undo", () => {
    const host = edits();
    const removed = base({ source: "npm:pi-landstrip", name: "pi-landstrip", scope: "project", installed: undefined, removed: true, loaded: "0.9.0" });
    setup({ packages: [base(), removed], edits: host });
    const row = screen.getAllByTestId("pi-package")[1]!;
    expect(row).toHaveTextContent("this project · removed — still running until pi-outpost restarts");
    expect(within(row).queryByRole("button", { name: /Remove/ })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Undo" }));
    expect(host.onRestore).toHaveBeenCalledWith(removed);
  });

  it("LockedExtensionsOfferNoInstallOrRemoval: nothing to add, remove or undo when locked", () => {
    const removed = base({ source: "npm:x", name: "x", installed: undefined, removed: true, loaded: "1.0.0" });
    setup({ packages: [base(), removed], locked: true, edits: edits() });
    expect(screen.queryByRole("button", { name: /Add a package|Remove|Undo|Update/ })).toBeNull();
  });

  it("a failed removal is said in the package's status line", () => {
    setup({
      packages: [base()],
      edits: edits({ change: { requestId: "c", key: "user:@gotgenes/pi-permission-system", action: "remove", status: "failed", message: "x was not removed: EACCES" } }),
    });
    expect(statusOf("pi-permission-system")).toBe("x was not removed: EACCES");
  });

  it("every action is held while another change runs", () => {
    setup({
      packages: [base({ check: { state: "newer", latest: "33.1.0" } })],
      edits: edits({ change: { requestId: "c", key: "user:openlore", action: "install", status: "pending" } }),
    });
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Remove/ })).toBeDisabled();
  });
});
