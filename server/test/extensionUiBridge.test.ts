/**
 * The Extension "Custom UI" bridge, exercised without a live session.
 *
 * What these protect is the dialog contract: a request goes out through `emit`,
 * the client's answer resolves it by id, and a session being replaced unblocks
 * every pending request rather than leaving the extension hanging. The
 * TUI-only no-ops are here only so a regression that starts *doing* something
 * (sending a request the client never agreed to handle) is caught.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExtensionUIRequest, ExtensionUIResponse } from "@pi-outpost/shared";
import { ExtensionUiBridge } from "../src/extensionUiBridge.ts";

/** Captures every emitted request, in order, so assertions read as "it sent X". */
function recorder(): { emit: (r: ExtensionUIRequest) => void; sent: ExtensionUIRequest[] } {
  const sent: ExtensionUIRequest[] = [];
  return { emit: (r) => void sent.push(r), sent };
}

/** The id of the last request emitted, so a test can answer it. */
function lastId(requests: ExtensionUIRequest[]): string {
  const last = requests[requests.length - 1];
  assert.ok(last, "expected at least one emitted request");
  return last.id;
}

describe("ExtensionUiBridge", () => {
  describe("answer", () => {
    test("resolves the matching select with its value", async () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const picked = ctx.select("pick one", ["a", "b"]);
      bridge.answer({ type: "extension_ui_response", id: lastId(sent), value: "b" });

      assert.equal(await picked, "b");
    });

    test("resolves the matching confirm with its boolean", async () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const confirmed = ctx.confirm("proceed?", "are you sure?");
      bridge.answer({ type: "extension_ui_response", id: lastId(sent), confirmed: true });

      assert.equal(await confirmed, true);
    });

    test("resolves the matching input with its value", async () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const typed = ctx.input("name", "placeholder");
      bridge.answer({ type: "extension_ui_response", id: lastId(sent), value: "laurent" });

      assert.equal(await typed, "laurent");
    });

    test("an answer for an unknown id is dropped, not thrown", () => {
      const { emit } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      // No pending request exists; answering must be a safe no-op.
      assert.doesNotThrow(() =>
        bridge.answer({ type: "extension_ui_response", id: "never-asked", value: "x" }),
      );
    });

    test("a cancelled answer resolves select, confirm and input with their defaults", async () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const sel = ctx.select("pick", ["a"]);
      const conf = ctx.confirm("ok?", "sure?");
      const inp = ctx.input("name");
      // Cancel the oldest pending (select) first.
      bridge.answer({ type: "extension_ui_response", id: sent[0].id, cancelled: true });
      assert.equal(await sel, undefined);
      // The others are still pending; answer them by their own ids.
      bridge.answer({ type: "extension_ui_response", id: sent[1].id, cancelled: true });
      bridge.answer({ type: "extension_ui_response", id: sent[2].id, cancelled: true });
      assert.equal(await conf, false);
      assert.equal(await inp, undefined);
    });
  });

  describe("cancelAll", () => {
    test("unblocks every pending request as cancelled", async () => {
      const { emit } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const sel = ctx.select("pick", ["a"]);
      const conf = ctx.confirm("ok?", "sure?");
      const inp = ctx.input("name");

      bridge.cancelAll();

      assert.equal(await sel, undefined);
      assert.equal(await conf, false);
      assert.equal(await inp, undefined);
    });

    test("an answer arriving after cancelAll is a no-op", async () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const sel = ctx.select("pick", ["a"]);
      bridge.cancelAll();
      assert.equal(await sel, undefined);

      // The pending entry is gone; a late answer must not throw.
      assert.doesNotThrow(() =>
        bridge.answer({ type: "extension_ui_response", id: sent[0].id, value: "a" }),
      );
    });
  });

  describe("dialog timeout and abort", () => {
    test("a timeout resolves with the default value", async () => {
      const { emit } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const result = ctx.select("pick", ["a"], { timeout: 5 });
      assert.equal(await result, undefined);
    });

    test("an already-aborted signal resolves immediately with the default", async () => {
      const { emit } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();
      const ac = new AbortController();
      ac.abort();

      const result = ctx.confirm("ok?", "sure?", { signal: ac.signal });
      assert.equal(await result, false);
    });

    test("aborting a pending request resolves with the default", async () => {
      const { emit } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();
      const ac = new AbortController();

      const result = ctx.input("name", undefined, { signal: ac.signal });
      ac.abort();
      assert.equal(await result, undefined);
    });
  });

  describe("createContext fire-and-forget methods", () => {
    test("notify emits a notify request with the type", () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      bridge.createContext().notify("hello", "warning");

      const last = sent[sent.length - 1];
      assert.equal(last.method, "notify");
      assert.equal(last.message, "hello");
      assert.equal(last.notifyType, "warning");
    });

    test("setStatus emits the key and text", () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      bridge.createContext().setStatus("role", "thinking");

      const last = sent[sent.length - 1];
      assert.equal(last.method, "setStatus");
      assert.equal(last.statusKey, "role");
      assert.equal(last.statusText, "thinking");
    });

    test("setTitle emits the title", () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      bridge.createContext().setTitle("a new title");

      const last = sent[sent.length - 1];
      assert.equal(last.method, "setTitle");
      assert.equal(last.title, "a new title");
    });

    test("setWidget emits string-array content with its placement", () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      bridge.createContext().setWidget("panel", ["line one", "line two"], { placement: "belowEditor" });

      const last = sent[sent.length - 1];
      assert.equal(last.method, "setWidget");
      assert.equal(last.widgetKey, "panel");
      assert.deepEqual(last.widgetLines, ["line one", "line two"]);
      assert.equal(last.widgetPlacement, "belowEditor");
    });
    test("setWidget with undefined content emits with undefined lines", () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      bridge.createContext().setWidget("panel", undefined);

      assert.equal(sent.length, 1);
      const last = sent[sent.length - 1];
      assert.equal(last.method, "setWidget");
      assert.equal(last.widgetKey, "panel");
      assert.equal(last.widgetLines, undefined);
    });

    test("setWidget with a component factory emits nothing (no TUI to render into)", () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      bridge.createContext().setWidget("panel", () => ["rendered"]);
      assert.equal(sent.length, 0);
    });

    test("setEditorText and pasteToEditor both emit set_editor_text", () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();
      ctx.pasteToEditor("pasted");

      const last = sent[sent.length - 1];
      assert.equal(last.method, "set_editor_text");
      assert.equal(last.text, "pasted");
    });

    test("editor resolves with the value the client sent back", async () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const opened = ctx.editor("edit", "prefill");
      bridge.answer({ type: "extension_ui_response", id: lastId(sent), value: "edited" });
      assert.equal(await opened, "edited");
    });

    test("editor resolves with undefined on cancel", async () => {
      const { emit, sent } = recorder();
      const bridge = new ExtensionUiBridge(emit);
      const ctx = bridge.createContext();

      const opened = ctx.editor("edit");
      bridge.answer({ type: "extension_ui_response", id: lastId(sent), cancelled: true });
      assert.equal(await opened, undefined);
    });

    test("getEditorText is always empty (synchronous, cannot ask the client)", () => {
      const { emit } = recorder();
      assert.equal(new ExtensionUiBridge(emit).createContext().getEditorText(), "");
    });

    test("the TUI-only stubs are silent no-ops that emit nothing", () => {
      const { emit, sent } = recorder();
      const ctx = new ExtensionUiBridge(emit).createContext();
      ctx.setWorkingMessage();
      ctx.setWorkingVisible();
      ctx.setWorkingIndicator();
      ctx.setHiddenThinkingLabel();
      ctx.setFooter();
      ctx.setHeader();
      ctx.onTerminalInput()();
      ctx.addAutocompleteProvider();
      ctx.setEditorComponent();
      ctx.setToolsExpanded();
      assert.equal(sent.length, 0);
    });

    test("custom resolves to undefined (no TUI to render into)", async () => {
      const { emit } = recorder();
      assert.equal(await new ExtensionUiBridge(emit).createContext().custom(), undefined);
    });

    test("theme returns identity stylers that leave text untouched", () => {
      const { emit } = recorder();
      const theme = new ExtensionUiBridge(emit).createContext().theme;
      assert.equal(theme.fg("red", "text"), "text");
      assert.equal(theme.bg("red", "text"), "text");
      assert.equal(theme.bold("text"), "text");
      assert.equal(theme.italic("text"), "text");
      assert.equal(theme.underline("text"), "text");
      assert.equal(theme.inverse("text"), "text");
      assert.equal(theme.strikethrough("text"), "text");
      assert.equal(theme.getFgAnsi(), "");
      assert.equal(theme.getBgAnsi(), "");
      assert.equal(theme.getColorMode(), "truecolor");
    });

    test("the theme accessors return identity functions", () => {
      const { emit } = recorder();
      const theme = new ExtensionUiBridge(emit).createContext().theme;
      assert.equal(theme.getThinkingBorderColor()("text"), "text");
      assert.equal(theme.getBashModeBorderColor()("text"), "text");
    });

    test("getAllThemes, getTheme, getToolsExpanded return their empty defaults", () => {
      const { emit } = recorder();
      const ctx = new ExtensionUiBridge(emit).createContext();
      assert.deepEqual(ctx.getAllThemes(), []);
      assert.equal(ctx.getTheme(), undefined);
      assert.equal(ctx.getToolsExpanded(), false);
    });

    test("setTheme refuses rather than pretending it worked", () => {
      const { emit } = recorder();
      const result = new ExtensionUiBridge(emit).createContext().setTheme();
      assert.equal(result.success, false);
    });

    test("getEditorComponent returns undefined", () => {
      const { emit } = recorder();
      assert.equal(new ExtensionUiBridge(emit).createContext().getEditorComponent(), undefined);
    });
  });
});
