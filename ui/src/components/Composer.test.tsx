import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { CommandInfo, FileSearchEntry } from "@pi-outpost/shared";
import { Composer } from "./Composer";
import type { Attachment } from "../attachments";

const COMMANDS: CommandInfo[] = [
  { name: "commit", description: "write a commit message", source: "prompt", argumentHint: "[scope]" },
  { name: "compact", description: "compact the session", source: "extension" },
  { name: "review", description: "review the diff", source: "skill" },
];

const entry = (path: string, type: FileSearchEntry["type"] = "file"): FileSearchEntry => ({ path, type });

type Props = React.ComponentProps<typeof Composer>;

function setup(overrides: Partial<Props> = {}) {
  const handlers = {
    onAttach: vi.fn(),
    onMentionPaths: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onSend: vi.fn(),
    onAbort: vi.fn(),
    onSearchFiles: vi.fn(),
    onClearFileSearch: vi.fn(),
  };
  const props: Props = {
    isStreaming: false,
    connected: true,
    commands: COMMANDS,
    fileSearch: null,
    attachments: [],
    ...handlers,
    ...overrides,
  };
  const view = render(<Composer {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<Composer {...props} {...next} />);
  return { ...handlers, ...view, rerenderWith };
}

const box = () => screen.getByRole("textbox");

/** Type into the textarea, keeping the caret at the end as a real typist would. */
function type(value: string) {
  fireEvent.change(box(), { target: { value, selectionStart: value.length } });
}

describe("Composer", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  describe("sending", () => {
    it("sends on Enter", () => {
      const { onSend } = setup();
      type("hello");
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).toHaveBeenCalledWith("hello", undefined);
    });

    it("clears the box after sending", () => {
      setup();
      type("hello");
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(box()).toHaveValue("");
    });

    it("keeps Shift+Enter for a newline", () => {
      const { onSend } = setup();
      type("hello");
      fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
      expect(onSend).not.toHaveBeenCalled();
    });

    it("does not send mid-composition, so an IME candidate is not a prompt", () => {
      const { onSend } = setup();
      type("こんにち");
      // React reads isComposing off the native event
      fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
      expect(onSend).not.toHaveBeenCalled();
    });

    it("refuses to send whitespace", () => {
      const { onSend } = setup();
      type("   \n  ");
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).not.toHaveBeenCalled();
    });

    it("disables the send button until there is something to send", () => {
      setup();
      expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
      type("hi");
      expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    });

    it("sends from the button too", () => {
      const { onSend } = setup();
      type("hello");
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      expect(onSend).toHaveBeenCalled();
    });
  });

  describe("attachments", () => {
    const image: Attachment = { kind: "image", name: "plot.png", mimeType: "image/png", data: "AAAA" };
    // A path attachment carries the path in `data` — that is what composePrompt appends as @mention
    const reference: Attachment = { kind: "path", name: "src/main.ts", data: "src/main.ts", mimeType: "text/plain" };

    it("sends image data alongside the text", () => {
      const { onSend } = setup({ attachments: [image] });
      type("look");
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).toHaveBeenCalledWith(expect.stringContaining("look"), [{ data: "AAAA", mimeType: "image/png" }]);
    });

    it("treats a bare path reference as context, not a question", () => {
      // Opening a preview attaches a reference; a stray Enter must not fire a prompt
      const { onSend } = setup({ attachments: [reference] });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).not.toHaveBeenCalled();
    });

    it("sends a reference once there is a question with it", () => {
      const { onSend } = setup({ attachments: [reference] });
      type("what does this do?");
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).toHaveBeenCalled();
    });

    it("sends an image on its own, since the user supplied it", () => {
      const { onSend } = setup({ attachments: [image] });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).toHaveBeenCalled();
    });

    it("lists attachments with a way to drop each", () => {
      const { onRemoveAttachment } = setup({ attachments: [image, reference] });
      expect(screen.getByText("plot.png")).toBeInTheDocument();
      expect(screen.getByText("src/main.ts")).toBeInTheDocument();
      fireEvent.click(screen.getAllByTitle("remove attachment")[1]);
      expect(onRemoveAttachment).toHaveBeenCalledWith(1);
    });

    it("attaches files pasted into the box", () => {
      const { onAttach } = setup();
      const pasted = new File(["x"], "shot.png", { type: "image/png" });
      fireEvent.paste(box(), { clipboardData: { files: [pasted] } });
      expect(onAttach).toHaveBeenCalledWith([pasted]);
    });

    it("leaves an ordinary text paste alone", () => {
      const { onAttach } = setup();
      fireEvent.paste(box(), { clipboardData: { files: [] } });
      expect(onAttach).not.toHaveBeenCalled();
    });
  });

  describe("uploads in flight", () => {
    const uploaded: Attachment = {
      kind: "path",
      name: "uploads/report.pdf",
      data: "uploads/report.pdf",
      mimeType: "text/plain",
      source: "manual",
    };
    const send = () => screen.getByLabelText("Send message");

    it("shows a chip for a file still being copied into the workspace", () => {
      setup({ pendingUploads: [{ id: "1", name: "report.pdf" }] });
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
      expect(screen.getByText("uploading")).toBeInTheDocument();
    });

    it("refuses to send while an upload is outstanding", () => {
      const { onSend } = setup({ pendingUploads: [{ id: "1", name: "report.pdf" }] });
      type("what is in this?");

      expect(send()).toBeDisabled();
      // Enter is the other way in, and it must not slip past the same guard
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).not.toHaveBeenCalled();
    });

    it("says why Enter did nothing, rather than swallowing it", () => {
      // The button explains itself by being disabled; Enter has no such affordance
      const { rerenderWith } = setup({ pendingUploads: [{ id: "1", name: "report.pdf" }] });
      type("what is in this?");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      fireEvent.keyDown(box(), { key: "Enter" });
      expect(screen.getByRole("status")).toHaveTextContent(/finish uploading/i);

      // …and the hint goes away on its own once the upload lands
      rerenderWith({ pendingUploads: [] });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("sends the written path exactly once when the upload settles", () => {
      const { onSend, rerenderWith } = setup({ pendingUploads: [{ id: "1", name: "report.pdf" }] });
      type("what is in this?");

      rerenderWith({ pendingUploads: [], attachments: [uploaded] });
      expect(send()).toBeEnabled();
      fireEvent.keyDown(box(), { key: "Enter" });

      expect(onSend).toHaveBeenCalledTimes(1);
      const [prompt] = onSend.mock.calls[0];
      expect(prompt.match(/@uploads\/report\.pdf/g)).toHaveLength(1);
    });

    it("does not mention the path twice when the draft already names it", () => {
      const { onSend, rerenderWith } = setup({ pendingUploads: [{ id: "1", name: "report.pdf" }] });
      rerenderWith({ pendingUploads: [], attachments: [uploaded] });
      type("summarise @uploads/report.pdf please");
      fireEvent.keyDown(box(), { key: "Enter" });

      const [prompt] = onSend.mock.calls[0];
      expect(prompt.match(/@uploads\/report\.pdf/g)).toHaveLength(1);
    });
  });

  describe("slash commands", () => {
    it("suggests commands as the name is typed", () => {
      setup();
      type("/co");
      expect(screen.getByText("/commit")).toBeInTheDocument();
      expect(screen.getByText("/compact")).toBeInTheDocument();
      expect(screen.queryByText("/review")).not.toBeInTheDocument();
    });

    it("says where each command comes from", () => {
      setup();
      type("/");
      expect(screen.getByText("prompt")).toBeInTheDocument();
      expect(screen.getByText("ext")).toBeInTheDocument();
      expect(screen.getByText("skill")).toBeInTheDocument();
    });

    it("stops suggesting once the name is followed by an argument", () => {
      setup();
      type("/commit scope");
      expect(screen.queryByText("/commit")).not.toBeInTheDocument();
    });

    /**
     * Escape used to last exactly one keystroke: the list re-opened on the next
     * character, so the only way to write a message that begins with "/" was to
     * delete it and start over.
     */
    it("keeps the list dismissed while the same name is still being typed", () => {
      setup();
      type("/co");
      expect(screen.getByText("/commit")).toBeInTheDocument();
      fireEvent.keyDown(box(), { key: "Escape" });
      expect(screen.queryByText("/commit")).not.toBeInTheDocument();
      type("/com");
      expect(screen.queryByText("/commit")).not.toBeInTheDocument();
      expect(box()).toHaveValue("/com");
    });

    it("offers the list again once the slash itself is gone", () => {
      setup();
      type("/co");
      fireEvent.keyDown(box(), { key: "Escape" });
      type("hello");
      type("/co");
      expect(screen.getByText("/commit")).toBeInTheDocument();
    });

    it("dismisses the list when the click lands outside the composer", () => {
      setup();
      type("/co");
      expect(screen.getByText("/commit")).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByText("/commit")).not.toBeInTheDocument();
    });

    it("does not dismiss on a click inside the composer, which would eat the pick", () => {
      setup();
      type("/co");
      fireEvent.mouseDown(screen.getByText("/commit"));
      expect(screen.getByText("/commit")).toBeInTheDocument();
    });

    it("completes the selected command with a trailing space", () => {
      setup();
      type("/co");
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(box()).toHaveValue("/commit ");
    });

    it("moves the selection with the arrow keys", () => {
      setup();
      type("/co");
      fireEvent.keyDown(box(), { key: "ArrowDown" });
      fireEvent.keyDown(box(), { key: "Tab" });
      expect(box()).toHaveValue("/compact ");
    });

    it("wraps around at the ends of the list", () => {
      setup();
      type("/co");
      fireEvent.keyDown(box(), { key: "ArrowUp" });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(box()).toHaveValue("/compact ");
    });

    it("completes on click", () => {
      setup();
      type("/co");
      fireEvent.click(screen.getByText("/compact"));
      expect(box()).toHaveValue("/compact ");
    });

    it("dismisses the menu on Escape without clearing the text", () => {
      setup();
      type("/co");
      fireEvent.keyDown(box(), { key: "Escape" });
      expect(screen.queryByText("/commit")).not.toBeInTheDocument();
      expect(box()).toHaveValue("/co");
    });

    it("does not send while the menu is taking Enter", () => {
      const { onSend } = setup();
      type("/co");
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).not.toHaveBeenCalled();
    });

    it("sends once the menu has been dismissed", () => {
      const { onSend } = setup();
      type("/co");
      fireEvent.keyDown(box(), { key: "Escape" });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).toHaveBeenCalled();
    });
  });

  describe("@ mentions", () => {
    it("searches for the mention after a pause, not on every keystroke", () => {
      const { onSearchFiles } = setup();
      type("see @mai");
      expect(onSearchFiles).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(200));
      expect(onSearchFiles).toHaveBeenCalledWith("mai");
    });

    it("clears the search when the mention is emptied", () => {
      const { onClearFileSearch } = setup();
      type("see @");
      expect(onClearFileSearch).toHaveBeenCalled();
    });

    it("does not treat an address as a mention", () => {
      const { onSearchFiles } = setup();
      type("mail me at ada@example.com");
      act(() => void vi.advanceTimersByTime(200));
      expect(onSearchFiles).not.toHaveBeenCalled();
    });

    it("shows results for the query actually typed", () => {
      const { rerenderWith } = setup();
      type("see @mai");
      rerenderWith({ fileSearch: { status: "loaded", query: "mai", requestId: "s1", results: [entry("src/main.ts")] } });
      expect(screen.getByText("src/main.ts")).toBeInTheDocument();
    });

    it("ignores results belonging to a superseded query", () => {
      const { rerenderWith } = setup();
      type("see @mai");
      rerenderWith({ fileSearch: { status: "loaded", query: "old", requestId: "s0", results: [entry("stale.ts")] } });
      expect(screen.queryByText("stale.ts")).not.toBeInTheDocument();
    });

    it("completes a file with a trailing space", () => {
      const { rerenderWith } = setup();
      type("see @mai");
      rerenderWith({ fileSearch: { status: "loaded", query: "mai", requestId: "s1", results: [entry("src/main.ts")] } });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(box()).toHaveValue("see @src/main.ts ");
    });

    it("completes a directory with a trailing slash, ready to keep typing", () => {
      const { rerenderWith } = setup();
      type("see @sr");
      rerenderWith({ fileSearch: { status: "loaded", query: "sr", requestId: "s1", results: [entry("src", "directory")] } });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(box()).toHaveValue("see @src/");
    });

    it("reports the mentioned paths so the app can attach them", () => {
      const { onMentionPaths } = setup();
      type("look at @src/main.ts please");
      expect(onMentionPaths).toHaveBeenLastCalledWith(["src/main.ts"]);
    });

    it("prefers the command menu over a mention when both could apply", () => {
      const { rerenderWith } = setup();
      type("/co");
      rerenderWith({ fileSearch: { status: "loaded", query: "co", requestId: "s1", results: [entry("config.ts")] } });
      expect(screen.getByText("/commit")).toBeInTheDocument();
      expect(screen.queryByText("config.ts")).not.toBeInTheDocument();
    });
  });

  describe("connection and streaming", () => {
    it("disables the box until connected", () => {
      setup({ connected: false });
      expect(box()).toBeDisabled();
      expect(box()).toHaveAttribute("placeholder", "connecting…");
    });

    it("offers to stop the agent while it is running", () => {
      const { onAbort } = setup({ isStreaming: true });
      fireEvent.click(screen.getByRole("button", { name: "Stop the agent" }));
      expect(onAbort).toHaveBeenCalled();
    });

    it("offers no stop button when the agent is idle", () => {
      setup({ isStreaming: false });
      expect(screen.queryByRole("button", { name: "Stop the agent" })).not.toBeInTheDocument();
    });

    it("calls sending steering while the agent runs", () => {
      setup({ isStreaming: true });
      expect(screen.getByRole("button", { name: "Steer the agent" })).toBeInTheDocument();
      expect(box()).toHaveAttribute("placeholder", expect.stringContaining("steer"));
    });
  });

  describe("prefill", () => {
    it("takes the prefilled text", () => {
      setup({ prefill: { text: "edited prompt", nonce: 1 } });
      expect(box()).toHaveValue("edited prompt");
    });

    it("takes it again when a new prefill arrives with the same text", () => {
      const { rerenderWith } = setup({ prefill: { text: "same", nonce: 1 } });
      type("typed over it");
      rerenderWith({ prefill: { text: "same", nonce: 2 } });
      expect(box()).toHaveValue("same");
    });
  });
});

describe("finding a command among many", () => {
  /**
   * The list is capped at what fits in the DOM, not at what fits on screen: it
   * scrolls, and the selection scrolls into view. Capped at a dozen it showed the
   * first dozen alphabetically, and a skill named later was simply absent — which
   * reads as "that skill did not load" rather than "there are more below". That is
   * exactly the conclusion it produced.
   */
  const many: CommandInfo[] = Array.from({ length: 50 }, (_, index) => ({
    name: `cmd-${String(index).padStart(2, "0")}`,
    description: `command ${index}`,
    source: "extension",
  }));
  const withSkill: CommandInfo[] = [
    ...many,
    { name: "skill:structured-exchange", description: "author a structured document", source: "skill" },
  ];

  const shown = () => [...document.querySelectorAll("[data-selected]")];

  /**
   * Each row renders its name, description and source into one text node, so the
   * order is read off the leading "/name" rather than an exact text match.
   */
  const startsOf = (names: string[]) => {
    const rows = shown();
    return rows.length === names.length && names.every((name, index) => rows[index].textContent?.startsWith(`/${name}`));
  };

  it("offers every command when only the slash is typed", () => {
    setup({ commands: withSkill });
    type("/");
    expect(shown()).toHaveLength(withSkill.length);
  });

  it("keeps a late-alphabet skill reachable rather than cutting it off", () => {
    setup({ commands: withSkill });
    type("/");
    expect(shown().some((item) => item.textContent?.includes("skill:structured-exchange"))).toBe(true);
  });

  it("still narrows as the name is typed", () => {
    setup({ commands: withSkill });
    type("/skill:str");
    expect(shown()).toHaveLength(1);
    expect(shown()[0].textContent).toContain("skill:structured-exchange");
  });

  it("matches commands containing the typed substring, not just prefix", () => {
    setup({ commands: withSkill });
    type("/exchange");
    expect(shown()).toHaveLength(1);
    expect(shown()[0].textContent).toContain("skill:structured-exchange");
  });

  it("prioritises prefix matches over substring matches", () => {
    const cmds: CommandInfo[] = [
      { name: "skill:exchange", description: "exchange", source: "skill" },
      { name: "structured-exchange", description: "structured", source: "extension" },
    ];
    setup({ commands: cmds });
    type("/exchange");
    expect(shown()).toHaveLength(2);
    expect(shown()[0].textContent).toContain("skill:exchange");
    expect(shown()[1].textContent).toContain("structured-exchange");
  });

  /**
   * Load order is the agent's business, not the reader's. Under a real RPC agent the
   * bundled structured-exchange skill was appended last of forty-one, so someone
   * looking for a name they already knew scrolled past forty unrelated ones and
   * concluded it had not loaded.
   */
  it("orders the list alphabetically rather than by load order", () => {
    const unsorted: CommandInfo[] = [
      { name: "zoom-out", description: "zoom out", source: "skill" },
      { name: "commit", description: "commit", source: "prompt" },
      { name: "skill:structured-exchange", description: "author a structured document", source: "skill" },
      { name: "apply", description: "apply", source: "extension" },
    ];
    setup({ commands: unsorted });
    type("/");
    expect(startsOf(["apply", "commit", "skill:structured-exchange", "zoom-out"])).toBe(true);
  });

  it("orders case- and accent-insensitively, so nothing lands after the last skill", () => {
    // Default sort() compares UTF-16 code units: "Étape" would file after "zoom-out".
    const mixed: CommandInfo[] = [
      { name: "zoom-out", description: "zoom out", source: "skill" },
      { name: "Étape", description: "step", source: "prompt" },
      { name: "Apply", description: "apply", source: "extension" },
    ];
    setup({ commands: mixed });
    type("/");
    expect(startsOf(["Apply", "Étape", "zoom-out"])).toBe(true);
  });

  it("puts the list in something that scrolls, since it no longer truncates", () => {
    setup({ commands: withSkill });
    type("/");
    const list = shown()[0].parentElement!;
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toMatch(/max-h-/);
  });
});
