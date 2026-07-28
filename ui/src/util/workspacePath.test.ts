import { describe, it, expect } from "vitest";
import { isExternalRef, resolveRelativeHref, isImageFile, rawFileUrl } from "./workspacePath";

describe("isExternalRef", () => {
  it("returns true for http/https URLs", () => {
    expect(isExternalRef("http://example.com")).toBe(true);
    expect(isExternalRef("https://example.com")).toBe(true);
  });

  it("returns true for protocol-relative URLs", () => {
    expect(isExternalRef("//example.com/file")).toBe(true);
  });

  it("returns true for other schemes", () => {
    expect(isExternalRef("mailto:user@example.com")).toBe(true);
    expect(isExternalRef("data:image/png;base64,abc")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isExternalRef("src/index.ts")).toBe(false);
    expect(isExternalRef("./foo/bar")).toBe(false);
    expect(isExternalRef("../parent")).toBe(false);
  });

  it("returns false for absolute paths without scheme", () => {
    expect(isExternalRef("/absolute/path")).toBe(false);
  });
});

describe("resolveRelativeHref", () => {
  it("resolves relative hrefs against current path", () => {
    expect(resolveRelativeHref("src/components/App.tsx", "./Header.tsx")).toBe("src/components/Header.tsx");
  });

  it("resolves relative hrefs with ../", () => {
    expect(resolveRelativeHref("src/components/App.tsx", "../util/helpers.ts")).toBe("src/util/helpers.ts");
  });

  it("handles absolute hrefs (root-relative)", () => {
    expect(resolveRelativeHref("src/App.tsx", "/other/file.ts")).toBe("other/file.ts");
  });

  it("strips query strings and fragments", () => {
    expect(resolveRelativeHref("src/App.tsx", "./util?foo=bar")).toBe("src/util");
    expect(resolveRelativeHref("src/App.tsx", "./util#section")).toBe("src/util");
  });

  it("resolves against empty currentPath (chat messages)", () => {
    expect(resolveRelativeHref("", "src/index.ts")).toBe("src/index.ts");
  });

  it("handles .. clamping at root", () => {
    expect(resolveRelativeHref("file.ts", "../../escape")).toBe("escape");
  });
});

describe("isImageFile", () => {
  it("returns true for image extensions", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.jpeg")).toBe(true);
    expect(isImageFile("photo.gif")).toBe(true);
    expect(isImageFile("photo.webp")).toBe(true);
    expect(isImageFile("photo.svg")).toBe(true);
    expect(isImageFile("photo.avif")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isImageFile("photo.PNG")).toBe(true);
    expect(isImageFile("photo.JPG")).toBe(true);
  });

  it("returns false for non-image extensions", () => {
    expect(isImageFile("file.ts")).toBe(false);
    expect(isImageFile("file.md")).toBe(false);
    expect(isImageFile("file.pdf")).toBe(false);
  });
});

describe("rawFileUrl", () => {
  it("builds a URL with path and optional token", () => {
    const url = rawFileUrl("https://api.example.com", "src/index.ts", "my-token");
    expect(url).toContain("/files/raw?path=");
    expect(url).toContain("src%2Findex.ts");
    expect(url).toContain("token=my-token");
  });

  it("omits token when null", () => {
    const url = rawFileUrl("https://api.example.com", "src/index.ts", null);
    expect(url).not.toContain("token=");
  });

  it("works with empty serverUrl (same-origin)", () => {
    const url = rawFileUrl("", "file.ts", null);
    expect(url).toContain("/files/raw?path=");
  });
});
