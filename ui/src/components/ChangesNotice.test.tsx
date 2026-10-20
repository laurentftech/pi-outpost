/**
 * The news that pi-outpost was updated: what it says, what it shows when asked, and
 * that dismissing it holds for that version only.
 */
import { afterEach, describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OutpostChanges } from "@pi-outpost/shared";
import { ChangesNotice } from "./ChangesNotice";

const changes = (to: string, entries: OutpostChanges["entries"] = ENTRIES): OutpostChanges => ({
  from: "0.43.0",
  to,
  entries,
  releaseNotes: `https://github.com/laurentftech/pi-outpost/releases/tag/v${to}`,
});

const ENTRIES: OutpostChanges["entries"] = [
  {
    version: "0.45.0",
    date: "2026-10-22",
    markdown: "### Added\n\n- **Metro map** in the branch chip ([#341](https://github.com/laurentftech/pi-outpost/pull/341))",
  },
  { version: "0.44.0", markdown: "### Fixed\n\n- a smaller thing" },
];

describe("the changes notice", () => {
  afterEach(() => window.localStorage.clear());

  // openlore: scenario=WhatChangedIsShownAfterAnUpdate spec=update-changelog
  it("WhatChangedIsShownAfterAnUpdate: names both versions, and shows every section when asked", () => {
    render(<ChangesNotice changes={changes("0.45.0")} />);
    const shown = screen.getByTestId("changes-notice");
    expect(shown).toHaveTextContent("pi-outpost was updated to 0.45.0 (from 0.43.0)");
    // One line until asked
    expect(screen.queryByTestId("changes-notice-body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "What's changed" }));
    const body = screen.getByTestId("changes-notice-body");
    const headings = within(body).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["0.45.02026-10-22", "0.44.0"]);
    // The Markdown is rendered, not shown as source
    expect(within(body).getByText("Metro map").tagName).toBe("STRONG");
    expect(within(body).getByRole("heading", { name: "Fixed" })).toBeInTheDocument();
    const prLink = within(body).getByRole("link", { name: "#341" });
    expect(prLink).toHaveAttribute("target", "_blank");
    expect(within(body).getByRole("link", { name: "Release notes on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/laurentftech/pi-outpost/releases/tag/v0.45.0",
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide what changed" }));
    expect(screen.queryByTestId("changes-notice-body")).toBeNull();
  });

  it("links the release notes when the changelog has no section for the update", () => {
    render(<ChangesNotice changes={changes("0.46.0", [])} />);
    expect(screen.queryByRole("button", { name: "What's changed" })).toBeNull();
    expect(screen.getByRole("link", { name: "Release notes" })).toHaveAttribute(
      "href",
      "https://github.com/laurentftech/pi-outpost/releases/tag/v0.46.0",
    );
  });

  // openlore: scenario=TheNewsIsDismissedPerVersion spec=update-changelog
  it("TheNewsIsDismissedPerVersion: stays dismissed for that version, and comes back for the next", () => {
    const first = render(<ChangesNotice changes={changes("0.45.0")} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the update news" }));
    expect(screen.queryByTestId("changes-notice")).toBeNull();
    first.unmount();

    const again = render(<ChangesNotice changes={changes("0.45.0")} />);
    expect(screen.queryByTestId("changes-notice")).toBeNull();
    again.unmount();

    render(<ChangesNotice changes={changes("0.46.0")} />);
    expect(screen.getByTestId("changes-notice")).toHaveTextContent("0.46.0");
  });
});
