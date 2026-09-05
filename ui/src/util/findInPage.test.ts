import { describe, expect, it } from "vitest";
import { findMatchesInText, highlightMatches, MAX_HIGHLIGHTED_MATCHES } from "./findInPage";

describe("findMatchesInText", () => {
  it("matches case-insensitively", () => {
    expect(findMatchesInText("The Outpost is here", "outpost")).toEqual([{ start: 4, end: 11 }]);
  });

  it("finds every occurrence", () => {
    expect(findMatchesInText("foo bar foo", "foo")).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(findMatchesInText("anything", "")).toEqual([]);
  });

  it("returns nothing when there is no match", () => {
    expect(findMatchesInText("anything", "nope")).toEqual([]);
  });

  it("treats the query as a literal substring, not a regular expression", () => {
    expect(findMatchesInText("a.b.c", "a.b")).toEqual([{ start: 0, end: 3 }]);
    expect(findMatchesInText("axb", "a.b")).toEqual([]);
  });
});

describe("highlightMatches", () => {
  function container(html: string): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  it("marks a match that lives entirely in one text node", () => {
    const el = container("<p>hello world</p>");
    const { matches, truncated } = highlightMatches(el, "world");

    expect(truncated).toBe(false);
    expect(matches).toHaveLength(1);
    expect(matches[0].marks).toHaveLength(1);
    expect(matches[0].marks[0].tagName).toBe("MARK");
    expect(matches[0].marks[0].textContent).toBe("world");
    expect(el.textContent).toBe("hello world");
  });

  it("marks a match spanning two adjacent text nodes across an element boundary", () => {
    // "outpost" split as "out" | "post" by a <span>, the way a syntax highlighter
    // or a PDF text layer might break a run into separate nodes.
    const el = container("<p>say <b>out</b>post now</p>");
    const { matches } = highlightMatches(el, "outpost");

    expect(matches).toHaveLength(1);
    // One <mark> per underlying text node the match touches — never a single
    // <mark> spanning the <b>, which Range.surroundContents cannot do safely.
    expect(matches[0].marks).toHaveLength(2);
    expect(matches[0].marks.map((mark) => mark.textContent)).toEqual(["out", "post"]);
    expect(el.textContent).toBe("say outpost now");
  });

  it("marks several matches within the same text node", () => {
    const el = container("<p>foo bar foo baz foo</p>");
    const { matches } = highlightMatches(el, "foo");

    expect(matches).toHaveLength(3);
    for (const match of matches) {
      expect(match.marks).toHaveLength(1);
      expect(match.marks[0].textContent).toBe("foo");
    }
    expect(el.textContent).toBe("foo bar foo baz foo");
  });

  it("returns no matches and no marks for an empty query", () => {
    const el = container("<p>hello world</p>");
    const { matches, clear } = highlightMatches(el, "");
    expect(matches).toEqual([]);
    expect(() => clear()).not.toThrow();
    expect(el.innerHTML).toBe("<p>hello world</p>");
  });

  it("returns no matches for a query the text does not contain", () => {
    const el = container("<p>hello world</p>");
    const { matches } = highlightMatches(el, "nope");
    expect(matches).toEqual([]);
  });

  it("caps the number of marked matches and reports truncation", () => {
    const el = container(`<p>${"a".repeat(MAX_HIGHLIGHTED_MATCHES + 50)}</p>`);
    const { matches, truncated } = highlightMatches(el, "a");

    expect(truncated).toBe(true);
    expect(matches).toHaveLength(MAX_HIGHLIGHTED_MATCHES);
  });

  it("clear() fully reverts the DOM to its original text", () => {
    const el = container("<p>say <b>out</b>post now, foo bar foo</p>");
    const original = el.innerHTML;
    const { clear } = highlightMatches(el, "foo");

    expect(el.innerHTML).not.toBe(original);
    clear();
    expect(el.querySelectorAll("mark")).toHaveLength(0);
    expect(el.textContent).toBe("say outpost now, foo bar foo");
  });
});
