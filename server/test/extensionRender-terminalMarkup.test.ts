/**
 * What a terminal needs and the widget does not, taken out of the rendered tool cards.
 *
 * Seen at the bench: an `edit` card's header drawn as full-width black bands — the dark
 * theme's panel background painted behind it — and every path wrapped in raw
 * `]8;;file:///…\` text, the OSC 8 hyperlink pi adds when the terminal that started the
 * server supports one. The rendering is pi's own; these tests drive it for real.
 */
// Before anything renders: pi reads the terminal's capabilities once, from the environment.
process.env.PI_HYPERLINKS = "1";

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createEditToolDefinition, createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { ExtensionRenderer, withoutBlankEdges, withoutTerminalMarkup } from "../src/extensionRender.ts";

const cwd = process.cwd();
const definitions = new Map([
  ["edit", createEditToolDefinition(cwd)],
  ["read", createReadToolDefinition(cwd)],
]);

function renderer(): ExtensionRenderer {
  const configured = new ExtensionRenderer();
  configured.configure({
    getToolDefinition: (name: string) => definitions.get(name) as never,
    getMessageRenderer: () => undefined,
    cwd,
  });
  return configured;
}

/** The dark theme's panel backgrounds, as the HTML conversion writes them. */
const DARK_PANELS = ["rgb(40,40,50)", "rgb(40,50,40)", "rgb(60,40,40)"];

describe("a built-in tool's card, rendered in a server started from a terminal with hyperlinks", () => {
  test("names its path without the terminal's hyperlink markup", () => {
    const read = renderer().renderToolCallHtml("c1", "read", { path: "docs/notes.md" });
    assert.ok(read, "the read tool renders a header");
    assert.match(read, /docs\/notes\.md/);
    assert.doesNotMatch(read, /\x1b/, "no escape character reaches the page");
    assert.doesNotMatch(read, /\]8;;/, "no OSC 8 text is left around the path");
  });

  test("an edit card's header carries no panel background, and keeps its text colours", () => {
    const edit = renderer().renderToolCallHtml("c2", "edit", { path: "docs/notes.md", edits: [{ oldText: "a", newText: "b" }] });
    assert.ok(edit, "the edit tool renders a header");
    for (const background of DARK_PANELS) assert.ok(!edit.includes(background), `the panel background ${background} is gone`);
    assert.doesNotMatch(edit, /\]8;;/);
    assert.match(edit, /color:/, "the text colours are kept");
    // The panel's padding rows go with its background: the header is its text line alone.
    assert.equal((edit.match(/class="ansi-line"/g) ?? []).length, 1, edit);
    assert.match(edit, /docs\/notes\.md/);
  });
});

describe("withoutBlankEdges", () => {
  test("drops blank rows before and after, and keeps those between", () => {
    const line = (inner: string) => `<div class="ansi-line">${inner}</div>`;
    const html = [line("&nbsp;"), line("<span>   </span>"), line("edit a.md"), line("&nbsp;"), line("second"), line("   ")].join("");
    assert.equal(withoutBlankEdges(html), [line("edit a.md"), line("&nbsp;"), line("second")].join(""));
  });

  test("leaves anything that is not a list of rendered lines alone", () => {
    assert.equal(withoutBlankEdges("<p>free</p>"), "<p>free</p>");
  });
});

describe("withoutTerminalMarkup", () => {
  const panels = new Set(["rgb(40,40,50)"]);

  test("drops OSC sequences and keeps the text they wrapped", () => {
    const html = '<span style="color:rgb(1,2,3)">\x1b]8;;file:///tmp/a.md\x1b\\a.md\x1b]8;;\x1b\\</span>';
    assert.equal(withoutTerminalMarkup(html, panels), '<span style="color:rgb(1,2,3)">a.md</span>');
    assert.equal(withoutTerminalMarkup("x\x1b]0;title\x07y", panels), "xy", "a BEL-terminated OSC too");
  });

  test("drops only the theme's panel backgrounds, leaving other colours and backgrounds", () => {
    const html =
      '<span style="background-color:rgb(40,40,50)">edit</span>' +
      '<span style="color:rgb(1,2,3);background-color:rgb(40,40,50)">path</span>' +
      '<span style="background-color:rgb(0,90,0)">added</span>';
    assert.equal(
      withoutTerminalMarkup(html, panels),
      '<span>edit</span><span style="color:rgb(1,2,3)">path</span><span style="background-color:rgb(0,90,0)">added</span>',
    );
  });
});
