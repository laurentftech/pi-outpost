/**
 * The notice that a newer pi-outpost exists: what it says, and that dismissing it holds
 * for that version only.
 */
import { afterEach, describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UpdateNotice } from "./UpdateNotice";

const notice = (latest: string) => ({
  running: "0.26.0",
  latest,
  instruction: 'Run "pi-outpost update" in a terminal, then restart it.',
  copy: "pi-outpost update",
});

describe("the update notice", () => {
  afterEach(() => window.localStorage.clear());

  it("names both versions, says what to run, and offers to copy it", () => {
    // ANewerVersionIsAnnouncedInTheInterface
    render(<UpdateNotice notice={notice("0.27.0")} />);
    const shown = screen.getByTestId("update-notice");
    expect(shown).toHaveTextContent("pi-outpost 0.27.0 is available (you have 0.26.0)");
    expect(shown).toHaveTextContent("pi-outpost update");
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("stays dismissed for that version, and comes back for the next one", () => {
    // ADismissedNoticeStaysDismissedForThatVersion
    const first = render(<UpdateNotice notice={notice("0.27.0")} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the update notice" }));
    expect(screen.queryByTestId("update-notice")).toBeNull();
    first.unmount();

    const again = render(<UpdateNotice notice={notice("0.27.0")} />);
    expect(screen.queryByTestId("update-notice")).toBeNull();
    again.unmount();

    render(<UpdateNotice notice={notice("0.28.0")} />);
    expect(screen.getByTestId("update-notice")).toHaveTextContent("0.28.0");
  });
});
