/**
 * The page a draw.io diagram is drawn in: jgraph's viewer, inside a frame that can reach
 * nothing.
 *
 * The viewer defines globals by the dozen and uses `eval`, so it never runs in the
 * application's window — in a widget, that window is the host's. The frame is sandboxed
 * with `allow-scripts` only (an opaque origin: no access to the app, its storage or its
 * token) and carries its own Content-Security-Policy, `default-src 'none'`, which lets in
 * the viewer script and this page's bootstrap and nothing else. The viewer's defaults point
 * at viewer.diagrams.net for stencils, images, a proxy and math; under this policy any such
 * request fails rather than leaves, whatever a diagram asks for.
 *
 * The page is loaded once. Each text is posted to it (`RENDER`) and drawn in place, so a
 * draft typed beside the rendering does not reparse 4.5 MB of script per keystroke. It
 * answers `READY` once the viewer is loaded, then `RENDERED` or `FAILED` for each text.
 */

export const DRAWIO_MESSAGE = {
  /** Parent → frame: `{ type, xml, dark }`. */
  RENDER: "pi-outpost:drawio-render",
  /** Frame → parent: the viewer is loaded and listening. */
  READY: "pi-outpost:drawio-ready",
  /** Frame → parent: `{ type, pages }` — the text was drawn. */
  RENDERED: "pi-outpost:drawio-rendered",
  /** Frame → parent: `{ type, message }` — the text could not be drawn, and why. */
  FAILED: "pi-outpost:drawio-failed",
} as const;

/** Where the vendored viewer is served from: `web/public/vendor/drawio/`. */
export function drawioViewerUrl(serverUrl: string, base: string = window.location.href): string {
  return new URL(`${serverUrl}/vendor/drawio/viewer-static.min.js`, base).href;
}

/** A value inside a `<script>`: JSON, with `<` escaped so no text can close the element. */
function scriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** A value inside a double-quoted attribute. */
function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The frame's whole document, for `srcdoc`. */
export function drawioFramePage(viewerUrl: string): string {
  const csp = [
    "default-src 'none'",
    // The viewer, by its exact URL, and this page's own two inline scripts; `eval` is
    // the viewer's, for its stencils and styles
    `script-src ${viewerUrl} 'unsafe-inline' 'unsafe-eval'`,
    "style-src 'unsafe-inline'",
    // Shapes and icons the viewer draws itself; never a URL
    "img-src data: blob:",
    "font-src data:",
  ].join("; ");
  // Every location the viewer would fetch from, pointed at its own folder: under the
  // policy above nothing there can be fetched either, so these only keep its defaults
  // from naming another host in the requests the browser refuses.
  const local = viewerUrl.slice(0, viewerUrl.lastIndexOf("/"));
  const globals = {
    DRAWIO_BASE_URL: local,
    DRAWIO_LIGHTBOX_URL: local,
    DRAWIO_VIEWER_URL: viewerUrl,
    PROXY_URL: local,
    STENCIL_PATH: local,
    SHAPES_PATH: local,
    STYLE_PATH: local,
    GRAPH_IMAGE_PATH: local,
    DRAW_MATH_URL: local,
    mxImageBasePath: local,
    mxBasePath: local,
    mxLoadResources: false,
    mxLoadStylesheets: false,
  };
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attribute(csp)}">
<style>
html, body { margin: 0; height: 100%; }
body { font-family: system-ui, sans-serif; background: #ffffff; color: #18181b; }
body.dark { background: #09090b; color: #e4e4e7; }
#diagram { box-sizing: border-box; width: 100%; padding: 8px; }
</style>
</head><body>
<script>
(function () {
  var globals = ${scriptLiteral(globals)};
  for (var name in globals) window[name] = globals[name];
})();
</script>
<script src="${attribute(viewerUrl)}"></script>
<script>
(function () {
  var M = ${scriptLiteral(DRAWIO_MESSAGE)};
  function tell(message) { parent.postMessage(message, "*"); }
  // The page the reader is on: a saved or retyped diagram keeps it, rather than
  // jumping back to the first page under someone reading the third
  var viewer = null;

  // What draw.io would open: an <mxfile> of pages, or a bare <mxGraphModel>
  function pagesOf(root) {
    if (root.nodeName === "mxGraphModel") return 1;
    if (root.nodeName !== "mxfile") return 0;
    return root.getElementsByTagName("diagram").length;
  }

  function render(xml, dark) {
    document.body.className = dark ? "dark" : "";
    // The viewer's own colours are light-dark() pairs: they follow the color-scheme
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    var old = document.getElementById("diagram");
    if (old) old.remove();
    var doc = new DOMParser().parseFromString(xml, "text/xml");
    var broken = doc.getElementsByTagName("parsererror")[0];
    if (broken) {
      // The browser's own preamble says nothing the reader needs
      var detail = (broken.textContent || "").replace(/^This page contains the following errors:\\s*/, "").split("\\n")[0];
      tell({ type: M.FAILED, message: "This is not well-formed XML: " + detail });
      return;
    }
    var pages = pagesOf(doc.documentElement);
    if (pages === 0) {
      tell({ type: M.FAILED, message: "This is not a draw.io diagram: its root is <" + doc.documentElement.nodeName + ">, not <mxfile> or <mxGraphModel>." });
      return;
    }
    var page = viewer !== null ? Math.min(viewer.currentPage || 0, pages - 1) : 0;
    var container = document.createElement("div");
    container.id = "diagram";
    document.body.appendChild(container);
    try {
      viewer = new GraphViewer(container, doc.documentElement, {
        page: page,
        toolbar: "pages zoom layers",
        // Always shown, at its default place: the viewer reserves the container's top
        // margin for it. "inline" draws it above the container, outside this frame.
        "toolbar-nohide": true,
        nav: true,
        lightbox: false,
        resize: false,
        "auto-fit": true,
        center: true,
        "check-visible-state": false,
        // A string, not a boolean: GraphViewer.isDarkMode compares with "dark" and "auto"
        "dark-mode": dark ? "dark" : "light",
      });
      tell({ type: M.RENDERED, pages: pages });
    } catch (error) {
      tell({ type: M.FAILED, message: "draw.io could not draw this diagram: " + (error && error.message ? error.message : String(error)) });
    }
  }

  window.addEventListener("message", function (event) {
    // Only the application that holds this frame
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.type !== M.RENDER || typeof data.xml !== "string") return;
    render(data.xml, data.dark === true);
  });

  if (typeof GraphViewer === "undefined") {
    tell({ type: M.FAILED, message: "The draw.io viewer could not be loaded." });
  } else {
    tell({ type: M.READY });
  }
})();
</script>
</body></html>`;
}
