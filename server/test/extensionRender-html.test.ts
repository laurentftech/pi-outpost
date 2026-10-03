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
import { ExtensionRenderer, normalizeToolContent } from "../src/extensionRender.ts";

/**
 * One renderer per test, the way one belongs to one workspace. It used to be a
 * process-wide singleton, which is exactly the bug this shape removes: with two
 * projects open, the last one to configure it rendered the other's cards.
 */
let renderer = new ExtensionRenderer();

/** A pi-tui component: renderers return one, and it yields lines of ANSI text. */
function component(lines: string[]) {
  return { render: () => lines };
}

/** Configure with a message renderer for `plan`, and nothing else. */
function configureWith(render: (message: unknown, options: { expanded: boolean }) => unknown) {
  renderer.configure({
    getToolRenderers: () => undefined,
    getMessageRenderer: (customType: string) => (customType === "plan" ? (render as never) : undefined),
    cwd: process.cwd(),
  });
}

afterEach(() => {
  renderer = new ExtensionRenderer();
});

describe("when nothing is configured", () => {
  test("renders no tool call", () => {
    renderer.configure(undefined);
    assert.equal(renderer.renderToolCallHtml("c1", "bash", { command: "ls" }), undefined);
  });

  test("renders no tool result", () => {
    renderer.configure(undefined);
    assert.equal(renderer.renderToolResultHtml("c1", "bash", "output", undefined, false), undefined);
  });

  test("renders no custom message", () => {
    renderer.configure(undefined);
    assert.equal(renderer.renderCustomMessageHtml("plan", "step 1", undefined, true), undefined);
  });
});

describe("renderCustomMessageHtml", () => {
  test("renders what the extension's renderer produced", () => {
    configureWith(() => component(["step one", "step two"]));
    const rendered = renderer.renderCustomMessageHtml("plan", "content", undefined, true);
    assert.ok(rendered, "expected HTML");
    assert.match(rendered!.expanded, /step one/);
  });

  test("keeps a collapsed preview only when it differs from the expanded one", () => {
    configureWith((_message, options) => component(options.expanded ? ["long", "form"] : ["short"]));
    const differing = renderer.renderCustomMessageHtml("plan", "content", undefined, true);
    assert.ok(differing?.collapsed, "a different preview must be kept");

    configureWith(() => component(["same"]));
    const identical = renderer.renderCustomMessageHtml("plan", "content", undefined, true);
    assert.equal(identical?.collapsed, undefined, "an identical preview is not worth sending");
  });

  test("renders nothing for a type no extension claims", () => {
    configureWith(() => component(["step one"]));
    assert.equal(renderer.renderCustomMessageHtml("unclaimed", "content", undefined, true), undefined);
  });

  test("renders nothing when the renderer produced no lines at all", () => {
    // An empty card is worse than no card. Note the boundary: a renderer that
    // returns blank *lines* still produces markup for them, so only a renderer
    // that emits nothing at all is treated as having nothing to say.
    configureWith(() => component([]));
    assert.equal(renderer.renderCustomMessageHtml("plan", "content", undefined, true), undefined);
  });

  test("still renders a line that is only whitespace, since the extension asked for it", () => {
    configureWith(() => component(["   "]));
    assert.ok(renderer.renderCustomMessageHtml("plan", "content", undefined, true));
  });

  test("survives a renderer that throws", () => {
    configureWith(() => {
      throw new Error("extension bug");
    });
    assert.equal(renderer.renderCustomMessageHtml("plan", "content", undefined, true), undefined);
  });

  test("survives a component whose render throws", () => {
    configureWith(() => ({
      render: () => {
        throw new Error("render bug");
      },
    }));
    assert.equal(renderer.renderCustomMessageHtml("plan", "content", undefined, true), undefined);
  });

  test("passes the details and the display flag through to the renderer", () => {
    let seen: { display?: boolean; details?: unknown } = {};
    configureWith((message) => {
      seen = message as { display?: boolean; details?: unknown };
      return component(["ok"]);
    });
    renderer.renderCustomMessageHtml("plan", "content", { step: 2 }, false);
    assert.equal(seen.display, false);
    assert.deepEqual(seen.details, { step: 2 });
  });

  test("accepts structured content as well as a string", () => {
    configureWith(() => component(["ok"]));
    const rendered = renderer.renderCustomMessageHtml("plan", [{ type: "text", text: "hello" }], undefined, true);
    assert.ok(rendered);
  });
});

describe("tool rendering once configured", () => {
  test("renders nothing for a tool no extension defines", () => {
    // getToolRenderers returns undefined for everything here: there is no renderer
    // to ask, and the answer must be "show the plain card", not a crash
    configureWith(() => component(["ok"]));
    assert.equal(renderer.renderToolCallHtml("c1", "unknown-tool", {}), undefined);
    assert.equal(renderer.renderToolResultHtml("c1", "unknown-tool", "output", undefined, false), undefined);
  });

  test("normalises the content shapes the SDK may hand over", () => {
    configureWith(() => component(["ok"]));
    assert.equal(renderer.renderToolResultHtml("c1", "unknown-tool", undefined, undefined, false), undefined);
    assert.equal(renderer.renderToolResultHtml("c1", "unknown-tool", [], undefined, true), undefined);
  });

  test("falls back to the dark theme for a name it does not know", () => {
    // An unknown theme name must not leave the renderer unconfigured
    renderer.configure({
      getToolRenderers: () => undefined,
      getMessageRenderer: () => (() => component(["themed"])) as never,
      cwd: process.cwd(),
      themeName: "no-such-theme",
    });
    assert.ok(renderer.renderCustomMessageHtml("anything", "content", undefined, true));
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

describe("two projects, two sets of renderers", () => {
  test("each renders with its own extensions and its own cwd", () => {
    const alpha = new ExtensionRenderer();
    const beta = new ExtensionRenderer();
    alpha.configure({
      getToolRenderers: () => undefined,
      getMessageRenderer: (customType: string) => (customType === "plan" ? ((() => component(["plan drawn by alpha"])) as never) : undefined),
      cwd: "/srv/alpha",
    });
    beta.configure({
      getToolRenderers: () => undefined,
      getMessageRenderer: (customType: string) => (customType === "plan" ? ((() => component(["plan drawn by beta"])) as never) : undefined),
      cwd: "/srv/beta",
    });

    // Configured second, and it does not overwrite the first. A module-level
    // renderer made the last project to start render every project's cards.
    assert.match(alpha.renderCustomMessageHtml("plan", "content", undefined, true)!.expanded, /plan drawn by alpha/);
    assert.match(beta.renderCustomMessageHtml("plan", "content", undefined, true)!.expanded, /plan drawn by beta/);
  });

  test("a project with no renderer for a type stays silent about it", () => {
    const alpha = new ExtensionRenderer();
    const beta = new ExtensionRenderer();
    alpha.configure({
      getToolRenderers: () => undefined,
      getMessageRenderer: (customType: string) => (customType === "plan" ? ((() => component(["plan drawn by alpha"])) as never) : undefined),
      cwd: "/srv/alpha",
    });
    beta.configure({ getToolRenderers: () => undefined, getMessageRenderer: () => undefined, cwd: "/srv/beta" });

    // Not the other project's rendering as a fallback: a card dressed by an
    // extension the project does not have is attributed to the wrong place.
    assert.equal(beta.renderCustomMessageHtml("plan", "content", undefined, true), undefined);
  });
});
