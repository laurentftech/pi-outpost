/**
 * Rendering extension output to HTML.
 *
 * Every entry point here is reached with untrusted-ish input — an extension's own
 * renderer, invoked server-side — so the branches that matter are the ones that
 * decide to show nothing: not configured, no renderer for this type, a renderer
 * that threw, or one that produced only whitespace. A card that renders as an
 * empty box is worse than no card, and a renderer that throws must not take the
 * response down with it.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  configureExtensionRender,
  normalizeToolContent,
  renderCustomMessageHtml,
  renderToolCallHtml,
  renderToolResultHtml,
} from "../src/extensionRender.ts";

/** A pi-tui component: renderers return one, and it yields lines of ANSI text. */
function component(lines: string[]) {
  return { render: () => lines };
}

/** Configure with a message renderer for `plan`, and nothing else. */
function configureWith(render: (message: unknown, options: { expanded: boolean }) => unknown) {
  configureExtensionRender({
    getToolDefinition: () => undefined,
    getMessageRenderer: (customType: string) => (customType === "plan" ? (render as never) : undefined),
    cwd: process.cwd(),
  });
}

afterEach(() => {
  configureExtensionRender(undefined);
});

describe("when nothing is configured", () => {
  test("renders no tool call", () => {
    configureExtensionRender(undefined);
    assert.equal(renderToolCallHtml("c1", "bash", { command: "ls" }), undefined);
  });

  test("renders no tool result", () => {
    configureExtensionRender(undefined);
    assert.equal(renderToolResultHtml("c1", "bash", "output", undefined, false), undefined);
  });

  test("renders no custom message", () => {
    configureExtensionRender(undefined);
    assert.equal(renderCustomMessageHtml("plan", "step 1", undefined, true), undefined);
  });
});

describe("renderCustomMessageHtml", () => {
  test("renders what the extension's renderer produced", () => {
    configureWith(() => component(["step one", "step two"]));
    const rendered = renderCustomMessageHtml("plan", "content", undefined, true);
    assert.ok(rendered, "expected HTML");
    assert.match(rendered!.expanded, /step one/);
  });

  test("keeps a collapsed preview only when it differs from the expanded one", () => {
    configureWith((_message, options) => component(options.expanded ? ["long", "form"] : ["short"]));
    const differing = renderCustomMessageHtml("plan", "content", undefined, true);
    assert.ok(differing?.collapsed, "a different preview must be kept");

    configureWith(() => component(["same"]));
    const identical = renderCustomMessageHtml("plan", "content", undefined, true);
    assert.equal(identical?.collapsed, undefined, "an identical preview is not worth sending");
  });

  test("renders nothing for a type no extension claims", () => {
    configureWith(() => component(["step one"]));
    assert.equal(renderCustomMessageHtml("unclaimed", "content", undefined, true), undefined);
  });

  test("renders nothing when the renderer produced no lines at all", () => {
    // An empty card is worse than no card. Note the boundary: a renderer that
    // returns blank *lines* still produces markup for them, so only a renderer
    // that emits nothing at all is treated as having nothing to say.
    configureWith(() => component([]));
    assert.equal(renderCustomMessageHtml("plan", "content", undefined, true), undefined);
  });

  test("still renders a line that is only whitespace, since the extension asked for it", () => {
    configureWith(() => component(["   "]));
    assert.ok(renderCustomMessageHtml("plan", "content", undefined, true));
  });

  test("survives a renderer that throws", () => {
    configureWith(() => {
      throw new Error("extension bug");
    });
    assert.equal(renderCustomMessageHtml("plan", "content", undefined, true), undefined);
  });

  test("survives a component whose render throws", () => {
    configureWith(() => ({
      render: () => {
        throw new Error("render bug");
      },
    }));
    assert.equal(renderCustomMessageHtml("plan", "content", undefined, true), undefined);
  });

  test("passes the details and the display flag through to the renderer", () => {
    let seen: { display?: boolean; details?: unknown } = {};
    configureWith((message) => {
      seen = message as { display?: boolean; details?: unknown };
      return component(["ok"]);
    });
    renderCustomMessageHtml("plan", "content", { step: 2 }, false);
    assert.equal(seen.display, false);
    assert.deepEqual(seen.details, { step: 2 });
  });

  test("accepts structured content as well as a string", () => {
    configureWith(() => component(["ok"]));
    const rendered = renderCustomMessageHtml("plan", [{ type: "text", text: "hello" }], undefined, true);
    assert.ok(rendered);
  });
});

describe("tool rendering once configured", () => {
  test("renders nothing for a tool no extension defines", () => {
    // getToolDefinition returns undefined for everything here: there is no renderer
    // to ask, and the answer must be "show the plain card", not a crash
    configureWith(() => component(["ok"]));
    assert.equal(renderToolCallHtml("c1", "unknown-tool", {}), undefined);
    assert.equal(renderToolResultHtml("c1", "unknown-tool", "output", undefined, false), undefined);
  });

  test("normalises the content shapes the SDK may hand over", () => {
    configureWith(() => component(["ok"]));
    assert.equal(renderToolResultHtml("c1", "unknown-tool", undefined, undefined, false), undefined);
    assert.equal(renderToolResultHtml("c1", "unknown-tool", [], undefined, true), undefined);
  });

  test("falls back to the dark theme for a name it does not know", () => {
    // An unknown theme name must not leave the renderer unconfigured
    configureExtensionRender({
      getToolDefinition: () => undefined,
      getMessageRenderer: () => (() => component(["themed"])) as never,
      cwd: process.cwd(),
      themeName: "no-such-theme",
    });
    assert.ok(renderCustomMessageHtml("anything", "content", undefined, true));
  });
});

describe("normalizeToolContent", () => {
  test("wraps a string, drops an empty one, and passes blocks through", () => {
    assert.deepEqual(normalizeToolContent("hello"), [{ type: "text", text: "hello" }]);
    assert.deepEqual(normalizeToolContent(""), []);
    assert.deepEqual(normalizeToolContent(undefined), []);
    const blocks = [{ type: "image", data: "AAAA", mimeType: "image/png" }];
    assert.deepEqual(normalizeToolContent(blocks), blocks);
  });
});
