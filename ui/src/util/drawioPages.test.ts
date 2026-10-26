import { describe, expect, it } from "vitest";
import { drawioPage, drawioPages, relativeReference } from "./drawioPages";

const TWO_PAGES =
  '<mxfile host="test"><diagram id="p1" name="Context"><mxGraphModel><root><mxCell id="0"/><mxCell id="a" value="Client" vertex="1" parent="0"/></root></mxGraphModel></diagram>' +
  '<diagram id="p2"><mxGraphModel><root><mxCell id="0"/><mxCell id="b" value="Second" vertex="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
const BARE = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';

describe("drawioPages", () => {
  it("names each page, an unnamed one as draw.io shows it", () => {
    expect(drawioPages(TWO_PAGES)).toEqual(["Context", "Page 2"]);
    expect(drawioPages(BARE)).toEqual(["Page 1"]);
  });

  it("says what a file that is no diagram is", () => {
    expect(() => drawioPages("<html><body>no</body></html>")).toThrow(/not a draw.io diagram \(its root is <html>\)/);
    expect(() => drawioPages("not xml at all <")).toThrow(/not a draw.io diagram/);
    expect(() => drawioPages("<mxfile></mxfile>")).toThrow(/holds no page/);
  });
});

describe("drawioPage", () => {
  const pageOf = (xml: string) => new DOMParser().parseFromString(xml, "application/xml").documentElement;

  it("keeps the first page alone when none is named", () => {
    const one = pageOf(drawioPage(TWO_PAGES));
    expect(one.nodeName).toBe("mxfile");
    expect(one.getAttribute("host")).toBe("test");
    expect([...one.children].map((page) => page.getAttribute("id"))).toEqual(["p1"]);
  });

  it("finds a page by its name or by its number from 1", () => {
    expect(drawioPage(TWO_PAGES, "Context")).toContain('value="Client"');
    expect(drawioPage(TWO_PAGES, "2")).toContain('value="Second"');
    expect(drawioPage(TWO_PAGES, "Page 2")).toContain('value="Second"');
    expect(drawioPage(TWO_PAGES, "2")).not.toContain('value="Client"');
  });

  it("names the pages there are for one it does not have", () => {
    expect(() => drawioPage(TWO_PAGES, "Deployment")).toThrow('it has no page "Deployment"; its pages are "Context", "Page 2"');
    expect(() => drawioPage(TWO_PAGES, "3")).toThrow(/no page "3"/);
  });

  it("hands a bare model back as it is, its one page", () => {
    expect(drawioPage(BARE)).toBe(BARE);
    expect(drawioPage(BARE, "1")).toBe(BARE);
  });
});

describe("relativeReference", () => {
  it("is the path from the poster's directory, as a frame names it", () => {
    expect(relativeReference("posters/menu.poster.html", "diagrams/flow.drawio")).toBe("../diagrams/flow.drawio");
    expect(relativeReference("posters/menu.poster.html", "posters/flow.drawio")).toBe("flow.drawio");
    expect(relativeReference("menu.poster.html", "a/b/flow.drawio")).toBe("a/b/flow.drawio");
    expect(relativeReference("a/b/c.poster.html", "a/flow.drawio")).toBe("../flow.drawio");
  });
});
