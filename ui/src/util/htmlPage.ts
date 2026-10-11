/**
 * A workspace HTML file made ready to draw in a sandboxed frame.
 *
 * The frame has an opaque origin, so the page reaches nothing of the application — but
 * that also means its relative references (`style.css`, `img/logo.png`) resolve to
 * nothing. The viewer fetches each one itself and writes it into the page: a stylesheet
 * as a `<style>`, a script as an inline script, a picture as a `data:` URI. The page
 * then holds every resource it needs and no address of the server: a `/files/raw` URL
 * carries the access token, and a script that could read one could read any file of the
 * workspace.
 *
 * Links leave the frame through a message (`LINK_SCRIPT`): a relative one asks the
 * viewer to open that file, as a link in rendered Markdown does.
 */
import { isExternalRef, resolveRelativeHref } from "./workspacePath";

/** Loads a workspace file's bytes, or `undefined` when it cannot be read. */
export type LoadFile = (path: string) => Promise<Blob | undefined>;

/** The message a rendered page sends to open a relative link in the viewer. */
export const OPEN_MESSAGE = "pi-outpost:open";

/** What `@import` may nest: enough for a theme split in a few files, never a loop. */
const MAX_IMPORT_DEPTH = 4;

const MEDIA_TYPES: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

/** The page's clicks on links, sent to the viewer instead of navigating a frame with no address. */
export const LINK_SCRIPT = `(function () {
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link || event.defaultPrevented) return;
    var href = link.getAttribute("href") || "";
    if (href === "") return;
    if (href.charAt(0) === "#") {
      // A srcdoc page's base URL is the application's: left alone, the fragment would
      // navigate the frame away from the page. Scroll to the target here instead.
      event.preventDefault();
      var name = href.slice(1);
      try { name = decodeURIComponent(name); } catch (error) {}
      // As a browser does: the element first; "#" and "#top" without one mean the top.
      var target = name === "" ? null : document.getElementById(name) || document.getElementsByName(name)[0];
      if (target) target.scrollIntoView();
      else if (name === "" || name.toLowerCase() === "top") window.scrollTo(0, 0);
      return;
    }
    if (/^(https?:|mailto:|\\/\\/)/i.test(href)) {
      event.preventDefault();
      window.open(link.href, "_blank", "noopener");
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    event.preventDefault();
    parent.postMessage({ type: "${OPEN_MESSAGE}", href: href }, "*");
  }, true);
})();`;

/** A reference to a sibling workspace file: no scheme, not protocol-relative, not an anchor. */
export function isRelativeReference(reference: string | null | undefined): reference is string {
  if (reference === null || reference === undefined) return false;
  const trimmed = reference.trim();
  return trimmed !== "" && !trimmed.startsWith("#") && !isExternalRef(trimmed);
}

function mediaTypeOf(path: string, fallback: string): string {
  return MEDIA_TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? fallback;
}

function dataUri(blob: Blob, mediaType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*/, `data:${mediaType}`));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * The page's text with every relative resource written in, and the link script added.
 * A resource that cannot be read is left as written: it shows broken, as in a browser.
 */
export async function preparePage(html: string, pagePath: string, load: LoadFile): Promise<string> {
  const document = new DOMParser().parseFromString(html, "text/html");
  const loaded = new Map<string, Promise<Blob | undefined>>();
  const fetchOnce = (path: string) => {
    let pending = loaded.get(path);
    if (pending === undefined) {
      pending = load(path).catch(() => undefined);
      loaded.set(path, pending);
    }
    return pending;
  };
  const text = async (path: string) => (await fetchOnce(path))?.text();
  const asDataUri = async (path: string) => {
    const blob = await fetchOnce(path);
    return blob === undefined ? undefined : dataUri(blob, mediaTypeOf(path, blob.type || "application/octet-stream"));
  };

  /** A stylesheet's `url()` and `@import` resolved against `basePath`, and written in. */
  const inlineCss = async (css: string, basePath: string, depth = 0): Promise<string> => {
    const imports = [...css.matchAll(/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;/gi)];
    for (const match of imports) {
      const reference = match[2] ?? match[4];
      if (!isRelativeReference(reference) || depth >= MAX_IMPORT_DEPTH) continue;
      const path = resolveRelativeHref(basePath, reference);
      const imported = await text(path);
      if (imported !== undefined) css = css.replace(match[0], await inlineCss(imported, path, depth + 1));
    }
    const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    const written = new Map<string, string>();
    for (const reference of new Set([...css.matchAll(pattern)].map((match) => match[2]!))) {
      if (!isRelativeReference(reference)) continue;
      const uri = await asDataUri(resolveRelativeHref(basePath, reference));
      if (uri !== undefined) written.set(reference, uri);
    }
    // Only inside the url() that named it: the same text elsewhere in the sheet stays.
    return css.replace(pattern, (whole, _quote, reference: string) => (written.has(reference) ? `url("${written.get(reference)}")` : whole));
  };

  for (const link of Array.from(document.querySelectorAll("link[href]"))) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    const href = link.getAttribute("href");
    if (!isRelativeReference(href)) continue;
    const path = resolveRelativeHref(pagePath, href);
    if (rel.includes("stylesheet")) {
      const css = await text(path);
      if (css === undefined) continue;
      const style = document.createElement("style");
      const media = link.getAttribute("media");
      if (media !== null) style.setAttribute("media", media);
      style.textContent = await inlineCss(css, path);
      link.replaceWith(style);
    } else if (rel.includes("icon")) {
      const uri = await asDataUri(path);
      if (uri !== undefined) link.setAttribute("href", uri);
    }
  }

  for (const style of Array.from(document.querySelectorAll("style"))) {
    style.textContent = await inlineCss(style.textContent ?? "", pagePath);
  }
  for (const element of Array.from(document.querySelectorAll("[style]"))) {
    element.setAttribute("style", await inlineCss(element.getAttribute("style") ?? "", pagePath));
  }

  for (const script of Array.from(document.querySelectorAll("script[src]"))) {
    const src = script.getAttribute("src");
    if (!isRelativeReference(src)) continue;
    const code = await text(resolveRelativeHref(pagePath, src));
    if (code === undefined) continue;
    script.removeAttribute("src");
    // A literal "</script>" in the code would end the element when the page is parsed again.
    script.textContent = code.replace(/<\/script/gi, "<\\/script");
  }

  const pictures: [string, string][] = [
    ["img", "src"],
    ["source", "src"],
    ["video", "src"],
    ["video", "poster"],
    ["audio", "src"],
    ["track", "src"],
    ["input", "src"],
    ["image", "href"],
    ["image", "xlink:href"],
    ["use", "href"],
  ];
  for (const [tag, attribute] of pictures) {
    for (const element of Array.from(document.getElementsByTagName(tag))) {
      const reference = element.getAttribute(attribute);
      if (!isRelativeReference(reference)) continue;
      const uri = await asDataUri(resolveRelativeHref(pagePath, reference));
      if (uri !== undefined) element.setAttribute(attribute, uri);
    }
  }
  for (const element of Array.from(document.querySelectorAll("img[srcset], source[srcset]"))) {
    const candidates = (element.getAttribute("srcset") ?? "").split(",").map((candidate) => candidate.trim()).filter(Boolean);
    const written: string[] = [];
    for (const candidate of candidates) {
      const [reference, ...descriptor] = candidate.split(/\s+/);
      const uri = isRelativeReference(reference) ? await asDataUri(resolveRelativeHref(pagePath, reference)) : undefined;
      written.push([uri ?? reference, ...descriptor].join(" "));
    }
    element.setAttribute("srcset", written.join(", "));
  }

  const links = document.createElement("script");
  links.textContent = LINK_SCRIPT;
  document.head.prepend(links);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
