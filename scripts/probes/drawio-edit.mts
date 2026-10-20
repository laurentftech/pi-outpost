/**
 * Can the vendored draw.io *viewer* do light editing — move a box, re-route or reconnect a
 * wire, rename a label — without shipping draw.io's full editor?
 *
 *   node --import tsx/esm scripts/probes/drawio-edit.mts [file.drawio]
 *
 * then open http://127.0.0.1:4334/. The frame is the app's own (`drawioFramePage`: same
 * CSP, same `allow-scripts` sandbox), with one script added after the viewer is built:
 * it turns the viewer's graph back on and answers "save" with the page's model as XML,
 * which the host page shows next to the original so ids and geometry can be compared.
 *
 * Findings (viewer v32.5.5, 2026-10-20), all driven with real mouse and keyboard:
 * - The viewer bundles mxGraph's whole editing core; only `setEnabled(false)` holds it
 *   back. Moving a box (snaps to the grid, wires follow), drawing a new wire from a box,
 *   reconnecting a wire's end to another box, and undo all work once it is re-enabled.
 * - It also replaces `graph.click` with a no-op, so clicking never selects: a vertex still
 *   selects on mousedown, an edge never does, and its handles never show. `delete g.click`.
 * - The in-place label editor needs mxGraph's common.css (`.mxCellEditor` absolute), which
 *   the frame does not load (`mxLoadStylesheets: false`); without it the editor opens at
 *   the foot of the page and the text is never committed.
 * - Saving with `mxCodec` keeps every id, attribute and geometry, but writes cells in tree
 *   order (children under their parent) and drops the `<mxGraphModel>` attributes (grid,
 *   page size): splice the new `<root>` into the original file rather than replace it.
 * - Clicking inside a container selects the container, as in draw.io.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drawioFramePage } from "../../ui/src/util/drawioPage.ts";

const PORT = Number(process.env.DRAWIO_EDIT_PORT ?? 4334);
const REPO = path.resolve(import.meta.dirname, "../..");
const VIEWER = path.join(REPO, "web/public/vendor/drawio/viewer-static.min.js");
const file = path.resolve(process.argv[2] ?? path.join(REPO, "architecture-voiture-electrique.drawio"));
const origin = `http://127.0.0.1:${PORT}`;

/** Runs in the frame, after the app's own bootstrap. */
const editing = String.raw`
<style>
/* mxGraph's common.css, the part the in-place editor and handles need; the viewer is told not to load stylesheets */
div.mxRubberband { position: absolute; overflow: hidden; border: 1px solid #29b6f2; background: #29b6f2; opacity: .2; }
.mxCellEditor { position: absolute; display: inline-block; overflow: visible; word-wrap: normal; border: 0; min-width: 1px; resize: none; padding: 0; margin: 0; outline: none; cursor: text; }
.mxPlainTextEditor * { padding: 0; margin: 0; }
</style>
<script>
(function () {
  var viewer = null;
  var undo = null;
  // The app's bootstrap keeps its viewer in a closure: catch it as it is built
  var Original = GraphViewer;
  window.GraphViewer = function (container, xml, config) {
    var built = new Original(container, xml, config);
    viewer = built;
    setTimeout(function () { enable(built); }, 0);
    return built;
  };
  window.GraphViewer.prototype = Original.prototype;
  for (var key in Original) window.GraphViewer[key] = Original[key];

  function enable(v) {
    var g = v.graph;
    window.__viewer = v;
    var before = {
      enabled: g.isEnabled(), locked: g.isCellsLocked(), movable: g.isCellsMovable(),
      editable: g.isCellsEditable(), connectable: g.isConnectable(), resizable: g.isCellsResizable(),
      disconnect: g.isCellsDisconnectable(), bends: g.isCellsBendable(), panning: !!g.panningHandler && g.panningHandler.isPanningEnabled(),
    };
    g.setEnabled(true);
    // The viewer replaces click with a no-op: clicking never selects, so an edge (selected
    // by click, not by mousedown like a vertex) can never show its handles
    delete g.click;
    g.setCellsLocked(false);
    g.setCellsMovable(true);
    g.setCellsEditable(true);
    g.setCellsResizable(true);
    g.setCellsBendable(true);
    g.setCellsDisconnectable(true);
    g.setConnectable(true);
    g.setDisconnectOnMove(false);
    undo = new mxUndoManager();
    var listener = function (sender, event) { undo.undoableEditHappened(event.getProperty("edit")); };
    g.getModel().addListener(mxEvent.UNDO, listener);
    g.getView().addListener(mxEvent.UNDO, listener);
    parent.postMessage({ type: "probe:enabled", before: before, after: { enabled: g.isEnabled(), locked: g.isCellsLocked() } }, "*");
  }

  function save() {
    var g = viewer.graph;
    var node = new mxCodec(mxUtils.createXmlDocument()).encode(g.getModel());
    return mxUtils.getXml(node);
  }

  window.addEventListener("message", function (event) {
    if (event.source !== parent || !event.data) return;
    if (event.data.type === "probe:save") parent.postMessage({ type: "probe:saved", xml: save() }, "*");
    if (event.data.type === "probe:undo" && undo) { undo.undo(); parent.postMessage({ type: "probe:undone" }, "*"); }
    if (event.data.type === "probe:hit") {
      // The cell under a frame point, and what is selected: to aim the driver's real clicks
      var gh = viewer.graph, pt = mxUtils.convertPoint(gh.container, event.data.x, event.data.y), hit = gh.getCellAt(pt.x, pt.y);
      parent.postMessage({ type: "probe:hit", key: event.data.key, id: hit ? hit.id : null, selected: gh.getSelectionCells().map(function (c) { return c.id; }) }, "*");
    }
    if (event.data.type === "probe:cell") {
      // Where a cell is drawn, in frame pixels, so the driver can point at it
      var g = viewer.graph, cell = g.getModel().getCell(event.data.id), state = cell && g.getView().getState(cell);
      parent.postMessage({ type: "probe:cell", id: event.data.id, box: state ? { x: state.x, y: state.y, w: state.width, h: state.height } : null,
        points: state && state.absolutePoints ? state.absolutePoints.map(function (p) { return p && { x: p.x, y: p.y }; }) : null,
        offset: (function () { var r = g.container.getBoundingClientRect(); return { x: r.left, y: r.top }; })() }, "*");
    }
  });
})();
</script>`;

function framePage(): string {
  const page = drawioFramePage(`${origin}/viewer-static.min.js`);
  // After the viewer script, before the app's bootstrap uses it
  const at = page.indexOf("</script>", page.indexOf("<script src=")) + "</script>".length;
  return page.slice(0, at) + editing + page.slice(at);
}

const host = (xml: string) => `<!doctype html><html><head><meta charset="utf-8"><title>draw.io edit probe</title>
<style>body{margin:0;font:13px system-ui} #f{width:100%;height:70vh;border:0;border-bottom:1px solid #ccc} pre{white-space:pre-wrap;max-height:25vh;overflow:auto;margin:0;padding:8px} button{margin:6px}</style></head>
<body><iframe id="f" sandbox="allow-scripts"></iframe>
<button id="save">save</button><button id="undo">undo</button><span id="status"></span><pre id="out"></pre>
<script>
var XML = ${JSON.stringify(xml).replace(/</g, "\\u003c")};
var f = document.getElementById("f");
window.probe = { enabled: null, saved: null, cells: {}, hits: {} };
f.srcdoc = ${JSON.stringify(framePage()).replace(/</g, "\\u003c")};
window.addEventListener("message", function (e) {
  if (e.source !== f.contentWindow) return;
  var d = e.data;
  if (d.type === "pi-outpost:drawio-ready") f.contentWindow.postMessage({ type: "pi-outpost:drawio-render", xml: XML, dark: false }, "*");
  if (d.type === "probe:enabled") { probe.enabled = d; document.getElementById("status").textContent = JSON.stringify(d); }
  if (d.type === "probe:saved") { probe.saved = d.xml; document.getElementById("out").textContent = d.xml; }
  if (d.type === "probe:cell") probe.cells[d.id] = d;
  if (d.type === "probe:hit") probe.hits[d.key] = d;
  if (d.type === "pi-outpost:drawio-failed") document.getElementById("status").textContent = "FAILED " + d.message;
});
document.getElementById("save").onclick = function () { f.contentWindow.postMessage({ type: "probe:save" }, "*"); };
document.getElementById("undo").onclick = function () { f.contentWindow.postMessage({ type: "probe:undo" }, "*"); };
probe.hit = function (key, x, y) { f.contentWindow.postMessage({ type: "probe:hit", key: key, x: x, y: y }, "*"); };
probe.ask = function (id) { f.contentWindow.postMessage({ type: "probe:cell", id: id }, "*"); };
</script></body></html>`;

const viewer = await readFile(VIEWER);
createServer(async (req, res) => {
  if (req.url === "/viewer-static.min.js") {
    res.writeHead(200, { "content-type": "text/javascript" }).end(viewer);
  } else if (req.url === "/real") {
    // The app's own frame page, untouched, driven through its touch-up messages
    const xml = await readFile(file, "utf8");
    const page = drawioFramePage(`${origin}/viewer-static.min.js`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><html><head><meta charset="utf-8"><title>draw.io real frame</title>
<style>body{margin:0} #f{width:100%;height:90vh;border:0}</style></head><body><iframe id="f" sandbox="allow-scripts"></iframe>
<script>
var XML = ${JSON.stringify(xml).replace(/</g, "\\u003c")};
var f = document.getElementById("f");
window.probe = { msgs: [], send: function (m) { f.contentWindow.postMessage(m, "*"); } };
f.srcdoc = ${JSON.stringify(page).replace(/</g, "\\u003c")};
window.addEventListener("message", function (e) {
  if (e.source !== f.contentWindow) return;
  probe.msgs.push(e.data);
  if (e.data.type === "pi-outpost:drawio-ready") probe.send({ type: "pi-outpost:drawio-render", xml: XML, dark: false });
});
</script></body></html>`);
  } else if (req.url === "/" || req.url?.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(host(await readFile(file, "utf8")));
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, "127.0.0.1", () => console.log(`open ${origin}/  (${file})`));
