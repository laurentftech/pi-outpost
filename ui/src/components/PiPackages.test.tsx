/**
 * The pi packages in Settings: what each says, and the confirmations in front of the
 * two actions that change what runs.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PiPackageInfo } from "@pi-outpost/shared";
import { PiPackages } from "./PiPackages";

const base = (overrides: Partial<PiPackageInfo> = {}): PiPackageInfo => ({
  source: "npm:@gotgenes/pi-permission-system",
  name: "@gotgenes/pi-permission-system",
  scope: "user",
  installed: "33.0.1",
  ...overrides,
});

function setup(props: Partial<React.ComponentProps<typeof PiPackages>> = {}) {
  const handlers = { onCheck: vi.fn(), onUpdate: vi.fn(), onRestart: vi.fn() };
  render(<PiPackages packages={[base()]} update={null} locked={false} canRestart restarting={false} {...handlers} {...props} />);
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
    expect(screen.getByTestId("pi-package-result")).toHaveTextContent(/restart pi-outpost to use it/);
  });
});

describe("restarting", () => {
  it("is offered when a package needs it, confirmed, and then sent", () => {
    const { onRestart } = setup({ packages: [base({ restartNeeded: true })] });
    fireEvent.click(screen.getByRole("button", { name: "Restart pi-outpost to use the updates" }));
    expect(screen.getByTestId("pi-packages-restart")).toHaveTextContent(/reconnects by itself, and conversations are kept/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRestart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restart pi-outpost to use the updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(onRestart).toHaveBeenCalled();
  });

  it("is not offered in a widget, nor when nothing needs it", () => {
    // AWidgetCannotRestartTheServer (interface half)
    setup({ packages: [base({ restartNeeded: true })], canRestart: false });
    expect(screen.queryByTestId("pi-packages-restart")).toBeNull();
  });

  it("is not offered when nothing needs it", () => {
    setup();
    expect(screen.queryByTestId("pi-packages-restart")).toBeNull();
  });
});
