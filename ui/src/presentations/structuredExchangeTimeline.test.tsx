/**
 * A timeline, from the reader's side.
 *
 * The geometry is held under Node by the layout tests. What a mounted component
 * adds is the reader's half: that what the layout placed is what is painted, that
 * today is the reader's day, that labels stay out of the scrolled area, that an item
 * can be selected with the pointer or the keyboard and is described in full when it
 * is, and that the text equivalent says what the picture shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { structuredExchangePresentation } from "./StructuredExchangeView";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const withStructured = (document: unknown): ToolItem => ({
  kind: "tool",
  toolCallId: "t1",
  toolName: "present_structure",
  args: {},
  output: "presented",
  structured: JSON.stringify(document),
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const programme = (): any => ({
  schema: "urn:structured-exchange:3",
  kind: "timeline",
  data: {
    title: "Programme X",
    time: { start: "2026-10-01", end: "2028-03-31", scale: "month" },
    rows: [
      { type: "separator", label: "Système A" },
      {
        type: "task",
        id: "T1",
        label: "Études système",
        items: [
          { type: "activity", id: "etude-preliminaire", start: "2026-11-01", end: "2027-02-28", label: "Étude préliminaire" },
          { type: "milestone", id: "srr", date: "2027-03-01", kind: "SRR", label: "System Requirements Review" },
          { type: "activity", id: "etude-detaillee", start: "2027-03-15", end: "2027-07-31", label: "Étude détaillée" },
          { type: "milestone", id: "pdr", date: "2027-05-15", kind: "PDR" },
          { type: "milestone", id: "cdr", date: "2027-08-01", kind: "CDR", label: "Critical Design Review" },
        ],
      },
      {
        type: "task",
        id: "T2",
        label: "Développement",
        items: [{ type: "activity", id: "dev", start: "2027-03-01", end: "2027-09-30", label: "Développement" }],
      },
      { type: "separator" },
      { type: "task", id: "T4", label: "Recette", items: [{ type: "activity", start: "2027-10-01", end: "2027-12-31" }] },
    ],
    dependencies: [
      { from: "etude-preliminaire", to: "srr" },
      { from: "srr", to: "T2" },
      // dev runs to the end of September; CDR on 1 August cannot wait for it.
      { from: "dev", to: "cdr" },
    ],
  },
});

const renderBody = (document: unknown = programme()) =>
  render(<structuredExchangePresentation.Expanded item={withStructured(document)} dispatch={vi.fn()} />);

/** The inline copy: the enlarged view mounts a second one only when opened. */
const timeline = () => screen.getAllByTestId("timeline")[0];
const items = (type: "activity" | "milestone") => [...timeline().querySelectorAll(`[data-testid="timeline-${type}"]`)];
const itemAt = (row: number, item: number) =>
  timeline().querySelector(`[data-row="${row}"][data-item="${item}"]`) as SVGGElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2027, 0, 15, 10, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a timeline is drawn natively", () => {
  it("draws every task row, bar, star and separator the document declares", () => {
    renderBody();
    expect(screen.getAllByTestId("timeline-title")[0]).toHaveTextContent("Programme X");
    expect(items("activity")).toHaveLength(4);
    expect(items("milestone")).toHaveLength(3);
    expect(within(timeline()).getAllByTestId("timeline-separator")).toHaveLength(2);
    const labels = within(timeline()).getAllByTestId("timeline-task-label").map((label) => label.textContent);
    expect(labels).toEqual(["Études système", "Développement", "Recette"]);
    expect(within(timeline()).getAllByTestId("timeline-separator-label").map((label) => label.textContent)).toEqual([
      "Système A",
      "",
    ]);
  });

  it("annotates labelled items, falls back to a milestone's kind, and invents nothing", () => {
    renderBody();
    const annotations = within(timeline())
      .getAllByTestId("timeline-annotation")
      .map((text) => text.textContent);
    expect(annotations).toContain("Étude préliminaire");
    expect(annotations).toContain("System Requirements Review");
    expect(annotations).toContain("PDR");
    // T4's activity has no label and no annotation.
    expect(itemAt(4, 0).querySelector('[data-testid="timeline-annotation"]')).toBeNull();
  });

  it("names every kind in the legend and draws one kind alike", () => {
    renderBody();
    const legend = within(timeline()).getByTestId("timeline-legend");
    expect([...legend.querySelectorAll("[data-kind]")].map((entry) => entry.getAttribute("data-kind"))).toEqual([
      "SRR",
      "PDR",
      "CDR",
    ]);
    const fills = items("milestone").map((star) => star.querySelector("path")!.getAttribute("fill"));
    expect(new Set(fills).size).toBe(3);
  });

  it("colours a kinded bar by its kind, leaves an untyped one grey, and draws the legend by shape", () => {
    const document = programme();
    document.data.rows[1].items[0].kind = "étude";
    document.data.rows[1].items[2].kind = "étude";
    document.data.rows[2].items[0].kind = "SRR";
    renderBody(document);
    const fill = (row: number, item: number) => itemAt(row, item).querySelector("rect")!.getAttribute("fill");
    expect(fill(1, 0)).toBe(fill(1, 2));
    expect(fill(1, 0)).not.toBe(fill(4, 0));
    expect(itemAt(4, 0).querySelector("rect")!.getAttribute("fill")).toBe("#e4e4e7");
    // The bar and the star of one kind share its colour.
    expect(fill(2, 0)).toBe(itemAt(1, 1).querySelector("path")!.getAttribute("fill"));
    const entry = (kind: string) => within(timeline()).getByTestId("timeline-legend").querySelector(`[data-kind="${kind}"]`)!;
    expect(entry("étude").querySelector('[data-testid="timeline-legend-bar"]')).not.toBeNull();
    expect(entry("étude").querySelector('[data-testid="timeline-legend-star"]')).toBeNull();
    expect(entry("PDR").querySelector('[data-testid="timeline-legend-bar"]')).toBeNull();
    expect(entry("PDR").querySelector('[data-testid="timeline-legend-star"]')).not.toBeNull();
    expect(entry("SRR").querySelector('[data-testid="timeline-legend-bar"]')).not.toBeNull();
    expect(entry("SRR").querySelector('[data-testid="timeline-legend-star"]')).not.toBeNull();
  });

  it("puts the labels outside the area that scrolls", () => {
    renderBody();
    const scroller = within(timeline()).getByTestId("timeline-scroller");
    const labels = within(timeline()).getByTestId("timeline-labels");
    expect(scroller.contains(labels)).toBe(false);
    // Header, rows and today line are in the one scrolled area, so they move together.
    expect(scroller.contains(within(timeline()).getByTestId("timeline-header"))).toBe(true);
    expect(scroller.contains(within(timeline()).getByTestId("timeline-body"))).toBe(true);
    expect(scroller.contains(within(timeline()).getByTestId("timeline-today"))).toBe(true);
  });

  it("repeats the year each quarter, so a scrolled header still says which year", () => {
    renderBody();
    // October 2026 opens the range; January opens the 2027 and 2028 bands. The quarters
    // in between that open no band carry the year again.
    expect(within(timeline()).getAllByTestId("timeline-year-repeat").map((year) => year.textContent)).toEqual([
      "2027",
      "2027",
      "2027",
    ]);
  });

  it("offers no figure export for a timeline", () => {
    renderBody();
    expect(screen.queryByText("⤓ download SVG")).toBeNull();
    expect(screen.queryByText("copy markup")).toBeNull();
  });
});

describe("TheCurrentDateIsShownFromTheRenderingContext", () => {
  it("draws Today at the reader's date, across the rows, with its tag in the header", () => {
    renderBody();
    const line = within(timeline()).getByTestId("timeline-today");
    // 2026-10-01 to 2027-01-15 is 106 days; half a day in, at four pixels a day.
    expect(Number(line.getAttribute("x1"))).toBe((106 + 0.5) * 4);
    expect(Number(line.getAttribute("y2"))).toBe(Number(within(timeline()).getByTestId("timeline-body").getAttribute("height")));
    expect(within(timeline()).getByTestId("timeline-today-tag")).toHaveTextContent("Today");
    // It is not an item a reader can select.
    expect(line.getAttribute("tabindex")).toBeNull();
    expect(line.getAttribute("role")).toBeNull();
  });

  it("moves when the reader's date does, with the document unchanged", () => {
    const { unmount } = renderBody();
    const first = Number(within(timeline()).getByTestId("timeline-today").getAttribute("x1"));
    unmount();
    vi.setSystemTime(new Date(2027, 5, 15, 10, 0));
    renderBody();
    expect(Number(within(timeline()).getByTestId("timeline-today").getAttribute("x1"))).toBeGreaterThan(first);
  });

  it("says which side of the range today is on, and draws no line, when it is outside", () => {
    vi.setSystemTime(new Date(2026, 9, 3, 10, 0));
    const before = programme();
    before.data.time.start = "2026-10-15";
    renderBody(before);
    expect(within(timeline()).queryByTestId("timeline-today")).toBeNull();
    const marker = within(timeline()).getByTestId("timeline-today-outside");
    expect(marker.getAttribute("data-side")).toBe("before");
    expect(marker).toHaveTextContent("Today (2026-10-03) is before this range");
  });

  it("marks the end edge when the plan is over", () => {
    vi.setSystemTime(new Date(2028, 5, 1, 10, 0));
    renderBody();
    const marker = within(timeline()).getByTestId("timeline-today-outside");
    expect(marker.getAttribute("data-side")).toBe("after");
    expect(marker.getAttribute("text-anchor")).toBe("end");
  });
});

describe("DependenciesAreDrawnBetweenTheEndsTheyLink", () => {
  it("draws one arrow per dependency, unsatisfied ones marked, beneath every glyph and label", () => {
    renderBody();
    const arrows = within(timeline()).getAllByTestId("timeline-dependency");
    expect(arrows.map((arrow) => [arrow.getAttribute("data-from"), arrow.getAttribute("data-to"), arrow.getAttribute("data-satisfied")])).toEqual([
      ["etude-preliminaire", "srr", "true"],
      ["srr", "T2", "true"],
      ["dev", "cdr", "false"],
    ]);
    expect(arrows[2].getAttribute("stroke-dasharray")).not.toBeNull();
    // ArrowsDoNotHideLabels: every arrow precedes, in paint order, every item and annotation.
    const body = within(timeline()).getByTestId("timeline-body");
    const order = [...body.querySelectorAll('[data-testid="timeline-dependency"], [data-testid="timeline-annotation"]')];
    const lastArrow = order.map((node) => node.getAttribute("data-testid")).lastIndexOf("timeline-dependency");
    const firstLabel = order.map((node) => node.getAttribute("data-testid")).indexOf("timeline-annotation");
    expect(lastArrow).toBeLessThan(firstLabel);
  });
});

describe("TheReaderMayHideDependencies", () => {
  it("HidingDependenciesRemovesOnlyTheArrows", () => {
    renderBody();
    fireEvent.click(within(timeline()).getByTestId("timeline-dependencies-toggle"));
    expect(within(timeline()).queryAllByTestId("timeline-dependency")).toHaveLength(0);
    expect(within(timeline()).getByTestId("timeline-dependencies-hidden")).toHaveTextContent(
      "3 dependencies hidden, some not satisfied by the dates",
    );
    fireEvent.click(itemAt(1, 4));
    expect(within(timeline()).getByTestId("timeline-predecessors")).toHaveTextContent("not satisfied by the dates");
    fireEvent.click(screen.getByText("show text equivalent"));
    expect(screen.getByTestId("structured-text-equivalent").textContent).toContain("Dependencies");
  });

  it("ShowingThemAgainRestoresTheArrows", () => {
    renderBody();
    const toggle = within(timeline()).getByTestId("timeline-dependencies-toggle");
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(within(timeline()).getAllByTestId("timeline-dependency")).toHaveLength(3);
    expect(within(timeline()).queryByTestId("timeline-dependencies-hidden")).toBeNull();
  });

  it("NoControlWithoutDependencies", () => {
    const document = programme();
    delete document.data.dependencies;
    renderBody(document);
    expect(within(timeline()).queryByTestId("timeline-dependencies-toggle")).toBeNull();
  });
});

describe("TheReaderMayCompactSections", () => {
  it("draws one row per section, keeps tasks before the first separator, and comes back", () => {
    const document = programme();
    document.data.rows.unshift({ type: "task", id: "T0", label: "Kick-off", items: [{ type: "milestone", date: "2026-10-05", kind: "KO" }] });
    document.data.rows.splice(3, 0, { type: "task", id: "T1b", label: "Études bis", items: [{ type: "activity", start: "2026-12-01", end: "2027-01-31" }] });
    renderBody(document);
    const toggle = within(timeline()).getByTestId("timeline-compact-toggle");
    expect(toggle).toHaveTextContent("one row per section");
    fireEvent.click(toggle);
    // Kick-off has no section and keeps its row; Système A and the anonymous section fold.
    expect(within(timeline()).getAllByTestId("timeline-task-label").map((label) => label.textContent)).toEqual(["Kick-off"]);
    const sections = within(timeline()).getAllByTestId("timeline-section-label");
    expect(sections.map((section) => section.textContent)).toEqual(["Système A(3)", "(1)"]);
    // Every item is still drawn; the unlabelled activity takes its task's name.
    expect(items("activity")).toHaveLength(5);
    expect(items("milestone")).toHaveLength(4);
    const unlabelled = timeline().querySelector('[data-row="3"][data-item="0"] [data-testid="timeline-annotation"]');
    expect(unlabelled).toHaveTextContent("Études bis");

    fireEvent.click(within(timeline()).getByTestId("timeline-compact-toggle"));
    expect(within(timeline()).queryAllByTestId("timeline-section-label")).toHaveLength(0);
    expect(within(timeline()).getAllByTestId("timeline-task-label")).toHaveLength(5);
  });

  it("CompactingChangesOnlyTheDrawing", () => {
    renderBody();
    fireEvent.click(screen.getByText("show text equivalent"));
    const before = screen.getByTestId("structured-text-equivalent").textContent;
    const arrowsBefore = within(timeline())
      .getAllByTestId("timeline-dependency")
      .map((arrow) => `${arrow.getAttribute("data-from")}>${arrow.getAttribute("data-to")}:${arrow.getAttribute("data-satisfied")}`);
    fireEvent.click(within(timeline()).getByTestId("timeline-compact-toggle"));
    expect(screen.getByTestId("structured-text-equivalent").textContent).toBe(before);
    expect(
      within(timeline())
        .getAllByTestId("timeline-dependency")
        .map((arrow) => `${arrow.getAttribute("data-from")}>${arrow.getAttribute("data-to")}:${arrow.getAttribute("data-satisfied")}`),
    ).toEqual(arrowsBefore);
    fireEvent.click(itemAt(1, 1));
    const details = within(timeline()).getByTestId("timeline-details");
    expect(details).toHaveTextContent("Études système");
    expect(details).toHaveTextContent("(T1)");
  });

  it("NoCompactControlWithoutSections", () => {
    const document = programme();
    document.data.rows = document.data.rows.filter((row: { type: string }) => row.type !== "separator");
    renderBody(document);
    expect(within(timeline()).queryByTestId("timeline-compact-toggle")).toBeNull();
  });
});

describe("AnItemCanBeInspected", () => {
  it("SelectingAMilestoneShowsItsDetails", () => {
    renderBody();
    fireEvent.click(itemAt(1, 1));
    const details = within(timeline()).getByTestId("timeline-details");
    expect(details).toHaveTextContent("Études système");
    expect(details).toHaveTextContent("(T1)");
    expect(details).toHaveTextContent("milestone");
    expect(details).toHaveTextContent("2027-03-01");
    expect(details).toHaveTextContent("System Requirements Review");
    expect(details).toHaveTextContent("SRR");
    expect(itemAt(1, 1).getAttribute("aria-pressed")).toBe("true");
  });

  it("SelectingAnItemShowsItsDependencies", () => {
    renderBody();
    // CDR waits on dev (not satisfied) and on nothing else; SRR is between two arrows.
    fireEvent.click(itemAt(1, 1));
    const details = within(timeline()).getByTestId("timeline-details");
    expect(within(details).getByTestId("timeline-predecessors")).toHaveTextContent('"Étude préliminaire" (etude-preliminaire) — finish-to-start');
    expect(within(details).getByTestId("timeline-successors")).toHaveTextContent('"Développement" (T2) — finish-to-start');
    const emphasised = within(timeline())
      .getAllByTestId("timeline-dependency")
      .filter((arrow) => arrow.getAttribute("data-emphasised") === "true")
      .map((arrow) => `${arrow.getAttribute("data-from")}→${arrow.getAttribute("data-to")}`);
    expect(emphasised).toEqual(["etude-preliminaire→srr", "srr→T2"]);

    fireEvent.click(itemAt(1, 4));
    const cdr = within(timeline()).getByTestId("timeline-predecessors");
    expect(cdr).toHaveTextContent("not satisfied by the dates");
    expect(cdr.querySelector('[data-satisfied="false"]')).not.toBeNull();
  });

  it("ItemsAreReachableFromTheKeyboard", () => {
    renderBody();
    const star = itemAt(1, 1);
    expect(star.getAttribute("tabindex")).toBe("0");
    // Exposed as a group: an SVG left as an image would hide these buttons from assistive technology.
    expect(within(timeline()).getByTestId("timeline-body").getAttribute("role")).toBe("group");
    expect(screen.getAllByRole("button", { name: /^milestone 2027-03-01/ }).length).toBeGreaterThan(0);
    expect(star.getAttribute("aria-label")).toBe(
      'milestone 2027-03-01, System Requirements Review, kind SRR, task "Études système" (T1), 2 dependencies',
    );
    fireEvent.focus(star);
    // An SVG group draws no outline: focus is shown by a ring the view draws itself.
    expect(star.querySelector('[data-testid="timeline-focus-ring"]')).not.toBeNull();
    fireEvent.keyDown(star, { key: "Enter" });
    expect(within(timeline()).getByTestId("timeline-details")).toHaveTextContent("2027-03-01");
    fireEvent.keyDown(star, { key: "Escape" });
    expect(within(timeline()).queryByTestId("timeline-details")).toBeNull();
  });

  it("a task label shows the dependencies naming the task", () => {
    renderBody();
    fireEvent.click(within(timeline()).getAllByTestId("timeline-task-label")[1]);
    const details = within(timeline()).getByTestId("timeline-details");
    expect(details).toHaveTextContent("Développement");
    expect(within(details).getByTestId("timeline-predecessors")).toHaveTextContent('"System Requirements Review" (srr)');
    // Selecting again clears it.
    fireEvent.click(within(timeline()).getAllByTestId("timeline-task-label")[1]);
    expect(within(timeline()).queryByTestId("timeline-details")).toBeNull();
  });
});

describe("TheTextualEquivalentListsEveryItem", () => {
  it("lists every row in order, every item, and every dependency with its verdict", () => {
    renderBody();
    fireEvent.click(screen.getByText("show text equivalent"));
    const text = screen.getByTestId("structured-text-equivalent").textContent!;
    expect(text).toContain("Programme X");
    expect(text).toContain("From 2026-10-01 to 2028-03-31, by month");
    expect(text).toContain("— Système A —");
    expect(text).toContain("Études système [T1]");
    expect(text).toContain("activity 2026-11-01 to 2027-02-28: Étude préliminaire (etude-preliminaire)");
    expect(text).toContain("milestone 2027-03-01: System Requirements Review [SRR] (srr)");
    expect(text).toContain("milestone 2027-05-15 [PDR] (pdr)");
    expect(text).toContain("activity 2027-10-01 to 2027-12-31");
    expect(text).toContain('"Critical Design Review" (cdr) waits on "Développement" (dev) (finish-to-start) — not satisfied by the dates');
    expect(text.indexOf("Études système")).toBeLessThan(text.indexOf("Développement [T2]"));
  });

  it("keeps the envelope available", () => {
    renderBody();
    fireEvent.click(screen.getByText("show envelope"));
    expect(screen.getByTestId("structured-envelope").textContent).toContain('"kind": "timeline"');
  });
});
