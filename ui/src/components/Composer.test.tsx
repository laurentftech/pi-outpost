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
