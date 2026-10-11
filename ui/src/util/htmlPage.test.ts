import { describe, expect, it } from "vitest";
import { isRelativeReference, LINK_SCRIPT, OPEN_MESSAGE, preparePage, type LoadFile } from "./htmlPage";

/** A workspace of files, and the paths the page asked for. */
function workspace(files: Record<string, string | Uint8Array>) {
  const asked: string[] = [];
  const load: LoadFile = async (path) => {
    asked.push(path);
    const content = files[path];
    return content === undefined ? undefined : new Blob([content as BlobPart]);
  };
  return { load, asked };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("preparePage", () => {
  it("writes a relative stylesheet in, with its own url() and @import resolved against it", async () => {
    const { load } = workspace({
      "reports/css/site.css": '@import "base.css"; .hero { background: url(../img/bg.png); } .x { content: "bg.png"; }',
      "reports/css/base.css": "body { color: rgb(1, 2, 3); }",
      "reports/img/bg.png": PNG,
    });
    const page = parse(await preparePage('<html><head><link rel="stylesheet" href="css/site.css" media="screen"></head><body></body></html>', "reports/index.html", load));
    expect(page.querySelector("link[rel=stylesheet]")).toBeNull();
    const style = page.querySelector("style")!;
    expect(style.getAttribute("media")).toBe("screen");
    expect(style.textContent).toContain("color: rgb(1, 2, 3)");
    expect(style.textContent).toMatch(/background: url\("data:image\/png;base64,[A-Za-z0-9+/=]+"\)/);
    // Only inside url(): the same text elsewhere in the sheet stays as written.
    expect(style.textContent).toContain('content: "bg.png"');
  });

  it("writes relative pictures in as data: URIs, srcset included, and leaves the rest alone", async () => {
    const { load } = workspace({ "a/logo.png": PNG, "a/logo@2x.png": PNG });
    const page = parse(
      await preparePage(
        `<img id="rel" src="logo.png"><img id="set" srcset="logo.png 1x, logo@2x.png 2x"><img id="abs" src="https://example.com/x.png"><img id="data" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><img id="gone" src="missing.png"><a id="anchor" href="#top">top</a>`,
        "a/page.html",
        load,
      ),
    );
    expect(page.getElementById("rel")!.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(page.getElementById("set")!.getAttribute("srcset")).toMatch(/^data:image\/png;base64,\S+ 1x, data:image\/png;base64,\S+ 2x$/);
    expect(page.getElementById("abs")!.getAttribute("src")).toBe("https://example.com/x.png");
    expect(page.getElementById("data")!.getAttribute("src")).toBe("data:image/gif;base64,R0lGODlhAQABAAAAACw=");
    // Missing: left as written, it shows broken, as in a browser.
    expect(page.getElementById("gone")!.getAttribute("src")).toBe("missing.png");
    expect(page.getElementById("anchor")!.getAttribute("href")).toBe("#top");
  });

  it("writes a relative script in, safe from a literal closing tag in its code", async () => {
    const { load } = workspace({ "js/app.js": 'document.body.dataset.ran = "yes"; var s = "</script>";' });
    const prepared = await preparePage('<html><body><script src="js/app.js"></script><script src="https://cdn.example/lib.js"></script></body></html>', "index.html", load);
    const page = parse(prepared);
    const scripts = Array.from(page.querySelectorAll("body script"));
    expect(scripts[0]!.hasAttribute("src")).toBe(false);
    expect(scripts[0]!.textContent).toContain('document.body.dataset.ran = "yes"');
    expect(scripts[0]!.textContent).toContain("<\\/script>");
    expect(scripts[1]!.getAttribute("src")).toBe("https://cdn.example/lib.js");
  });

  it("puts no address of the server and no token in the page, and loads each file once", async () => {
    const { load, asked } = workspace({ "logo.png": PNG, "s.css": ".a{background:url(logo.png)}" });
    const prepared = await preparePage('<link rel="stylesheet" href="s.css"><img src="logo.png"><img src="logo.png">', "index.html", load);
    expect(prepared).not.toMatch(/files\/raw|token=/);
    expect(asked.filter((path) => path === "logo.png")).toHaveLength(1);
  });

  it("writes in an icon, the page's own <style> and style attributes, and leaves a missing script as written", async () => {
    const { load } = workspace({ "favicon.png": PNG, "bg.png": PNG });
    const page = parse(
      await preparePage(
        '<html><head><link rel="icon" href="favicon.png"><link rel="icon" href="gone.ico"><link rel="preload" href="bg.png"><style>body { background: url(bg.png); }</style></head><body><div id="box" style="background: url(\'bg.png\')"></div><script id="missing" src="nowhere.js"></script></body></html>',
        "index.html",
        load,
      ),
    );
    const icons = page.querySelectorAll("link[rel=icon]");
    expect(icons[0]!.getAttribute("href")).toMatch(/^data:image\/png;base64,/);
    expect(icons[1]!.getAttribute("href")).toBe("gone.ico");
    // Neither a stylesheet nor an icon: left alone.
    expect(page.querySelector("link[rel=preload]")!.getAttribute("href")).toBe("bg.png");
    expect(page.querySelector("head style")!.textContent).toMatch(/url\("data:image\/png;base64,/);
    expect(page.getElementById("box")!.getAttribute("style")).toMatch(/url\("data:image\/png;base64,/);
    expect(page.getElementById("missing")!.getAttribute("src")).toBe("nowhere.js");
  });

  it("keeps a page whose resources fail to load, and nests @import no deeper than the limit", async () => {
    const sheets: Record<string, string> = {};
    for (let depth = 0; depth < 8; depth++) sheets[`s${depth}.css`] = `@import "s${depth + 1}.css"; .d${depth} { color: red; }`;
    const failing: LoadFile = async (path) => {
      if (path === "boom.png") throw new Error("network");
      const css = sheets[path];
      return css === undefined ? undefined : new Blob([css]);
    };
    const page = parse(await preparePage('<link rel="stylesheet" href="s0.css"><img id="boom" src="boom.png">', "index.html", failing));
    expect(page.getElementById("boom")!.getAttribute("src")).toBe("boom.png");
    const css = page.querySelector("style")!.textContent!;
    expect(css).toContain(".d4");
    expect(css).not.toContain(".d5");
    expect(css).toContain('@import "s5.css"');
  });

  it("adds the link script first, so it sees every click", async () => {
    const page = parse(await preparePage("<html><head><script>/* page */</script></head><body></body></html>", "index.html", workspace({}).load));
    expect(page.head.querySelector("script")!.textContent).toBe(LINK_SCRIPT);
    expect(LINK_SCRIPT).toContain(OPEN_MESSAGE);
  });
});

describe("isRelativeReference", () => {
  it("is a sibling file, never a URL, an anchor or an empty value", () => {
    for (const reference of ["a.png", "./a.png", "../a.png", "/a.png", "img/a b.png"]) expect(isRelativeReference(reference)).toBe(true);
    for (const reference of ["https://x/a.png", "//x/a.png", "data:image/png;base64,AA", "#top", "", "   ", "javascript:alert(1)", null, undefined]) {
      expect(isRelativeReference(reference)).toBe(false);
    }
  });
});
