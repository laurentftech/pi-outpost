/**
 * Turning a Mermaid diagram, which we do not lay out.
 *
 * Mermaid is mocked at the module boundary, as it is next door, and the mock is what
 * makes these assertions possible at all: the whole decision rests on the width of a
 * drawn diagram, and a stub that answers with a chosen `viewBox` is the only way to
 * put a specific width in front of the component.
 *
 * What is checked is our side of it — which source is handed over, how many times, and
 * what the reader is told and given afterwards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { Mermaid } from "./Mermaid";

const renderDiagram = vi.hoisted(() => vi.fn());
const initialize = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({ default: { initialize, render: renderDiagram } }));

/** A drawn diagram of a stated width, which is all the component reads. */
const drawing = (width: number) => ({ svg: `<svg viewBox="0 0 ${width} 200" width="100%"><g/></svg>` });

const WIDE = 2400;
const NARROW = 400;

const ACROSS = "flowchart LR\n  a[Start] --> b[End]";
const DOWN = "flowchart TD\n  a[Start] --> b[End]";
const SEQUENCE = "sequenceDiagram\n  A->>B: hello";

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

/** The sources handed to mermaid, in order. */
const rendered = () => renderDiagram.mock.calls.map((call) => call[1] as string);

const control = () => screen.queryByTestId("mermaid-orientation");

describe("a diagram too wide to read is turned, whatever its source asks for", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDiagram.mockReset();
    initialize.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws it the other way when the authored direction does not fit", async () => {
    // The decision the reader asked for: a source stating LR, unreadable across, is
    // drawn down anyway. The direction came from the model, not from them.
    renderDiagram.mockResolvedValueOnce(drawing(WIDE)).mockResolvedValueOnce(drawing(NARROW));
    render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(rendered().length).toBe(2));
    expect(rendered()[0]).toBe(ACROSS);
    expect(rendered()[1]).toBe("flowchart TB\n  a[Start] --> b[End]");
    // Drawn down the page, so the control offers the way back across.
    await waitFor(() => expect(control()!.textContent).toContain("landscape"));
  });

  it("keeps the authored direction when what it draws fits", async () => {
    renderDiagram.mockResolvedValue(drawing(NARROW));
    render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(control()).not.toBeNull());
    // One render: a diagram that fits is never laid out a second time to find out
    // whether it might have fitted better.
    expect(rendered()).toEqual([ACROSS]);
    expect(control()!.textContent).toContain("portrait");
    expect(control()!.getAttribute("aria-label")).toBe("Turn the diagram portrait");
  });

  it("keeps the authored direction when turning would not actually help", async () => {
    // A wide fan-out that is also deep. Turning trades one overflowing picture for
    // another, so the surprise is not worth it.
    renderDiagram.mockResolvedValueOnce(drawing(1200)).mockResolvedValueOnce(drawing(1150));
    render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(rendered().length).toBe(2));
    await waitFor(() => expect(control()!.textContent).toContain("portrait"));
  });

  it("turns a source authored down the page, when across is what fits", async () => {
    renderDiagram.mockResolvedValueOnce(drawing(WIDE)).mockResolvedValueOnce(drawing(NARROW));
    render(<Mermaid code={DOWN} />);
    await settle();
    await waitFor(() => expect(rendered().length).toBe(2));
    expect(rendered()[1]).toBe("flowchart LR\n  a[Start] --> b[End]");
    await waitFor(() => expect(control()!.textContent).toContain("portrait"));
  });

  it("says on the block that it is not drawn the way its source asks", async () => {
    renderDiagram.mockResolvedValueOnce(drawing(WIDE)).mockResolvedValueOnce(drawing(NARROW));
    render(<Mermaid code={ACROSS} />);
    await settle();
    const note = await screen.findByTestId("mermaid-turned");
    expect(note.textContent).toContain("the source asks for landscape");
  });

  it("says nothing when it is drawn as written", async () => {
    renderDiagram.mockResolvedValue(drawing(NARROW));
    render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(control()).not.toBeNull());
    expect(screen.queryByTestId("mermaid-turned")).toBeNull();
  });

  it("leaves a diagram it cannot measure exactly as written", async () => {
    // No viewBox is a failed measurement, not evidence that the diagram is too wide.
    renderDiagram.mockResolvedValue({ svg: "<svg><g/></svg>" });
    render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(control()).not.toBeNull());
    expect(rendered()).toEqual([ACROSS]);
  });
});

describe("the reader decides last, and keeps what the agent wrote", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDiagram.mockReset();
    initialize.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the direction the reader picks, without measuring anything", async () => {
    renderDiagram.mockResolvedValue(drawing(NARROW));
    render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(control()).not.toBeNull());

    fireEvent.click(control()!);
    await settle();
    await waitFor(() => expect(rendered().length).toBe(2));
    expect(rendered()[1]).toBe("flowchart TB\n  a[Start] --> b[End]");
    await waitFor(() => expect(control()!.textContent).toContain("landscape"));
  });

  it("overrides a diagram the system turned, and stays overridden", async () => {
    renderDiagram.mockResolvedValueOnce(drawing(WIDE)).mockResolvedValueOnce(drawing(NARROW));
    render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(control()!.textContent).toContain("landscape"));

    renderDiagram.mockResolvedValue(drawing(WIDE));
    fireEvent.click(control()!);
    await settle();
    // Back to the authored source, drawn as written — and it stays there rather than
    // being measured and turned again on the next pass.
    await waitFor(() => expect(control()!.textContent).toContain("portrait"));
    expect(rendered().at(-1)).toBe(ACROSS);
    expect(screen.queryByTestId("mermaid-turned")).toBeNull();
  });

  it("still shows and copies the source the agent wrote", async () => {
    renderDiagram.mockResolvedValueOnce(drawing(WIDE)).mockResolvedValueOnce(drawing(NARROW));
    render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(screen.queryByTestId("mermaid-turned")).not.toBeNull());

    fireEvent.click(screen.getByTitle("Show code"));
    // The rewritten source went to mermaid and nowhere else: what the reader reads is
    // what the agent wrote, direction included. Read off the element rather than
    // queried by text, because the default query collapses the newlines that are part
    // of what is being asserted.
    const shown = document.querySelector("pre")!.textContent;
    expect(shown).toBe(ACROSS);
    expect(shown).not.toContain("flowchart TB");

    const copied: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => expect(copied).toEqual([ACROSS]));
  });
});

describe("a notation with no direction offers no control", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDiagram.mockReset().mockResolvedValue(drawing(WIDE));
    initialize.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws a sequence exactly as written, however wide it is", async () => {
    render(<Mermaid code={SEQUENCE} />);
    await settle();
    await waitFor(() => expect(rendered().length).toBe(1));
    expect(rendered()).toEqual([SEQUENCE]);
    expect(control()).toBeNull();
    expect(screen.queryByTestId("mermaid-turned")).toBeNull();
  });
});
