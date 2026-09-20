/**
 * What waits on a restart, and the confirmed restart — offered in the standalone
 * interface only.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RestartNeeded } from "./RestartNeeded";

describe("the restart panel", () => {
  it("names what waits, and restarts only after a confirmation", () => {
    // ARestartLoadsTheUpdatedPackage (interface half)
    const onRestart = vi.fn();
    render(<RestartNeeded reasons={["pi-fake-ext", "tools-repo"]} canRestart restarting={false} onRestart={onRestart} />);
    expect(screen.getByTestId("restart-needed")).toHaveTextContent("pi-fake-ext, tools-repo");
    fireEvent.click(screen.getByRole("button", { name: "Restart pi-outpost" }));
    expect(screen.getByTestId("restart-needed")).toHaveTextContent(/reconnects by itself, and conversations are kept/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRestart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restart pi-outpost" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(onRestart).toHaveBeenCalled();
  });

  it("says what waits in a widget, and offers no restart there", () => {
    // AWidgetCannotRestartTheServer (interface half)
    render(<RestartNeeded reasons={["pi-fake-ext"]} canRestart={false} restarting={false} onRestart={vi.fn()} />);
    expect(screen.getByTestId("restart-needed")).toHaveTextContent("pi-fake-ext");
    expect(screen.queryByRole("button", { name: "Restart pi-outpost" })).toBeNull();
  });

  it("is absent when nothing waits", () => {
    render(<RestartNeeded reasons={[]} canRestart restarting={false} onRestart={vi.fn()} />);
    expect(screen.queryByTestId("restart-needed")).toBeNull();
  });
});
