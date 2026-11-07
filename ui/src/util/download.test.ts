import { describe, expect, it, vi } from "vitest";
import { dispositionName, downloadEntries, downloadUrl, DownloadRefusedError, type DownloadDeps } from "./download";

const connection = { serverUrl: "https://outpost.example:4322", token: "t&k", workspace: "proj 1" };

function deps(response?: Response): DownloadDeps & { clicks: { href: string; download: string }[]; saved: string[] } {
  const clicks: { href: string; download: string }[] = [];
  const saved: string[] = [];
  const realCreate = document.createElement.bind(document);
  const doc = {
    createElement: (tag: string) => {
      const element = realCreate(tag) as HTMLAnchorElement;
      element.click = () => clicks.push({ href: element.href, download: element.download });
      return element;
    },
  } as unknown as Document;
  return {
    clicks,
    saved,
    fetch: vi.fn(async () => response ?? new Response("")) as unknown as typeof fetch,
    document: doc,
    save: (_blob, name) => saved.push(name),
  };
}

describe("downloadUrl", () => {
  it("carries the origin, every path, the token and the project, all encoded", () => {
    expect(downloadUrl(connection, ["a b.txt", "docs/é"])).toBe(
      "https://outpost.example:4322/files/download?path=a%20b.txt&path=docs%2F%C3%A9&token=t%26k&workspace=proj%201",
    );
    expect(downloadUrl({ serverUrl: "", token: null }, ["x"])).toBe("/files/download?path=x");
  });
});

describe("dispositionName", () => {
  it("prefers the exact UTF-8 name over the ASCII fallback", () => {
    expect(dispositionName("attachment; filename=\"q3 r_sum_.pdf\"; filename*=UTF-8''q3%20r%C3%A9sum%C3%A9.pdf")).toBe("q3 résumé.pdf");
    expect(dispositionName('attachment; filename="plain.zip"')).toBe("plain.zip");
    expect(dispositionName(null)).toBeNull();
  });
});

describe("downloadEntries", () => {
  it("hands a single file straight to the browser, without fetching it", async () => {
    const d = deps();
    await expect(downloadEntries(connection, ["docs/report.pdf"], { singleFile: true }, d)).resolves.toEqual({ skipped: 0 });
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.clicks).toHaveLength(1);
    expect(d.clicks[0].href).toContain("/files/download?path=docs%2Freport.pdf");
  });

  it("fetches an archive, saves it once under the server's name, and reports what was left out", async () => {
    const response = new Response(new Blob(["zip"]), {
      headers: { "Content-Disposition": "attachment; filename=\"docs.zip\"; filename*=UTF-8''docs.zip", "X-Pi-Outpost-Skipped": "2" },
    });
    const d = deps(response);
    await expect(downloadEntries(connection, ["docs", "a.txt"], { singleFile: false }, d)).resolves.toEqual({ skipped: 2 });
    expect(d.saved).toEqual(["docs.zip"]);
    expect(d.fetch).toHaveBeenCalledWith(downloadUrl(connection, ["docs", "a.txt"]));
  });

  it("surfaces a refused archive's message instead of saving the error", async () => {
    const response = new Response(JSON.stringify({ error: "too-large", message: "More than 65535 entries: too many for one archive" }), { status: 413 });
    const d = deps(response);
    const attempt = downloadEntries(connection, ["node_modules"], { singleFile: false }, d);
    await expect(attempt).rejects.toBeInstanceOf(DownloadRefusedError);
    await expect(attempt).rejects.toThrow("More than 65535 entries: too many for one archive");
    expect(d.saved).toHaveLength(0);
    expect(d.clicks).toHaveLength(0);
  });
});
