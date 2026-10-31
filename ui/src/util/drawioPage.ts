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
 *
 * Touch-up (`EDIT`) turns the viewer's own graph back on: it bundles mxGraph's editing
 * core and only holds it back (scripts/probes/drawio-edit.mts has what was found). The
 * frame keeps the history and answers `SAVE` with the shown page's model, its original
 * attributes put back; the parent splices it into the file (`drawioSplice`). Isolation is
 * unchanged: the policy, the sandbox and the source check on messages are the same.
 */

export const DRAWIO_MESSAGE = {
  /** Parent → frame: `{ type, xml, dark, page? }` — `page`, from 0, is shown first when nothing is drawn yet. */
  RENDER: "pi-outpost:drawio-render",
  /** Frame → parent: the viewer is loaded and listening. */
  READY: "pi-outpost:drawio-ready",
  /** Frame → parent: `{ type, pages }` — the text was drawn. */
  RENDERED: "pi-outpost:drawio-rendered",
  /** Frame → parent: `{ type, message }` — the text could not be drawn, and why. */
  FAILED: "pi-outpost:drawio-failed",
  /** Parent → frame: `{ type, on, xml?, dark? }` — touch-up on or off. Off redraws `xml` (else the last text), edits dropped. */
  EDIT: "pi-outpost:drawio-edit",
  /** Parent → frame: answer with `SAVED`. */
  SAVE: "pi-outpost:drawio-save",
  /** Parent → frame: the last `SAVED` model is on disk; what is drawn is no longer dirty. */
  CLEAN: "pi-outpost:drawio-clean",
  /** Parent → frame. */
  UNDO: "pi-outpost:drawio-undo",
  /** Parent → frame. */
  REDO: "pi-outpost:drawio-redo",
  /** Parent → frame: answer with `SVG`. */
  EXPORT_SVG: "pi-outpost:drawio-export-svg",
  /** Parent → frame: `{ type, style }` — draw the selected wires, or all of the page's when none is selected, and new ones, `straight`, `orthogonal` or `curved`. */
  WIRE_STYLE: "pi-outpost:drawio-wire-style",
  /** Parent → frame: remove the waypoints of the selected wires, else of every wire of the page. */
  REMOVE_BENDS: "pi-outpost:drawio-remove-bends",
  /** Frame → parent: `{ type, dirty, canUndo, canRedo, wireStyle }` — after each touch-up, undo, redo, save or selection; `wireStyle` is the style of the wires a choice would change, or `mixed`. */
  CHANGED: "pi-outpost:drawio-changed",
  /** Frame → parent: `{ type, page, xml }` — the shown page's `<mxGraphModel>`, to splice into the file. */
  SAVED: "pi-outpost:drawio-saved",
  /** Frame → parent: `{ type, page, name, svg }` — the shown page as a standalone SVG document. */
  SVG: "pi-outpost:drawio-svg",
  /** Frame → parent: Escape pressed in the frame, with no label being typed — the parent's Escape, which the frame's focus keeps from it. */
  ESCAPE: "pi-outpost:drawio-escape",
  /** Frame → parent: touch-up wants the keyboard — focus the frame, which cannot always take it itself. */
  FOCUS: "pi-outpost:drawio-focus",
  /** Frame → parent: a page change was refused because the shown page has unsaved touch-ups. */
  PAGE_LOCKED: "pi-outpost:drawio-page-locked",
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
body { font-family: system-ui, sans-serif; background: #ffffff; color: #18181b; box-sizing: border-box; padding: 8px; }
body.dark { background: #09090b; color: #e4e4e7; }
/* No padding on the graph's own container: mxGraph places the pointer against the
   container's border box, so a padded one shifts every hit by the padding — wires missed
   by a few pixels, connection points that never answer. The margin is the body's. */
#diagram { box-sizing: border-box; width: 100%; }
/* mxGraph's common.css, the part touch-up needs (the viewer is told not to load stylesheets).
   Without it the label editor opens at the foot of the page and never commits. */
div.mxRubberband { position: absolute; overflow: hidden; border: 1px solid #29b6f2; background: #29b6f2; opacity: .2; }
.mxCellEditor { position: absolute; display: inline-block; overflow: visible; word-wrap: normal; border: 0; min-width: 1px; resize: none; padding: 0; margin: 0; outline: none; cursor: text; }
.mxPlainTextEditor * { padding: 0; margin: 0; }
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
  // The last text and theme posted: leaving touch-up redraws them, dropping the edits
  var last = null;
  var editing = false;
  // Touch-up state for the viewer drawn now: its history, keys and saved point
  var touch = null;

  // What draw.io would open: an <mxfile> of pages, or a bare <mxGraphModel>
  function pagesOf(root) {
    if (root.nodeName === "mxGraphModel") return 1;
    if (root.nodeName !== "mxfile") return 0;
    return root.getElementsByTagName("diagram").length;
  }

  // \`start\`: the page to show first, when nothing is drawn yet; later texts keep the page shown
  function render(xml, dark, start) {
    last = { xml: xml, dark: dark };
    stopTouchUp();
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
    var page = Math.min(viewer !== null ? viewer.currentPage || 0 : typeof start === "number" && start > 0 ? start : 0, pages - 1);
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
      fitWidth(viewer);
      tell({ type: M.RENDERED, pages: pages });
      if (editing) startTouchUp();
    } catch (error) {
      viewer = null;
      tell({ type: M.FAILED, message: "draw.io could not draw this diagram: " + (error && error.message ? error.message : String(error)) });
    }
  }

  // With its zoom toolbar on, the viewer draws at full size and widens its container to
  // match: a diagram wider than the frame runs off its edge, behind a scrollbar a Mac
  // hides — and a box out there cannot be touched up. Scaled down to the frame's width.
  function fitWidth(shown) {
    var graph = shown.graph;
    var available = window.innerWidth - 16 - 2 * graph.border;
    var width = graph.getGraphBounds().width / graph.view.scale;
    if (!(width > available) || available <= 0) return;
    graph.zoomTo(available / width);
    var bounds = graph.getGraphBounds();
    shown.updateContainerWidth(graph.container, bounds.width + 2 * graph.border);
    shown.updateContainerHeight(graph.container, Math.max(shown.minHeight || 0, bounds.height + 2 * graph.border + 1));
  }

  function changed() {
    if (touch === null) return;
    var undo = touch.undo;
    // A label being typed is an edit too: leaving now would drop it
    var typing = viewer !== null && viewer.graph.isEditing();
    tell({ type: M.CHANGED, dirty: typing || undo.indexOfNextAdd !== touch.clean, canUndo: undo.canUndo(), canRedo: undo.canRedo(), wireStyle: viewer === null ? null : targetWireStyle(viewer.graph), bends: viewer === null ? 0 : targetBends(viewer.graph) });
  }

  // Wire styles as draw.io's Waypoints menu sets them (Menus.js, edgeStyleChange): the keys
  // each one writes, null removing a key
  var WIRE_STYLES = {
    straight: { edgeStyle: null, curved: null, noEdgeStyle: null, elbow: null },
    orthogonal: { edgeStyle: "orthogonalEdgeStyle", curved: null, noEdgeStyle: null, elbow: null },
    curved: { edgeStyle: "orthogonalEdgeStyle", curved: "1", noEdgeStyle: null, elbow: null }
  };

  function wireStyleOf(graph, cell) {
    var style = graph.getCurrentCellStyle(cell);
    if (style.noEdgeStyle == 1 || style.edgeStyle == null || style.edgeStyle === "none") return "straight";
    return style.curved == 1 ? "curved" : "orthogonal";
  }

  function pageWires(graph) {
    var model = graph.getModel();
    return Object.keys(model.cells).map(function (id) { return model.cells[id]; }).filter(function (cell) { return model.isEdge(cell); });
  }

  // The wires a choice changes: the selected ones, else all of the page's
  function targetWires(graph) {
    var selected = graph.getSelectionCells().filter(function (cell) { return graph.getModel().isEdge(cell); });
    return selected.length > 0 ? selected : pageWires(graph);
  }

  // How many waypoints the wires a choice changes hold: what "remove bends" would take away
  function targetBends(graph) {
    return targetWires(graph).reduce(function (count, cell) {
      var geometry = graph.getModel().getGeometry(cell);
      return count + (geometry !== null && geometry.points ? geometry.points.length : 0);
    }, 0);
  }

  // The waypoints of the wires a choice changes, gone in one undoable change. Choosing the
  // style a wire already has changes nothing, so this is the way to straighten one out —
  // a single bend goes with a double click on it (draw.io's dblClickRemoveEnabled)
  function removeBends() {
    if (touch === null || viewer === null) return;
    var graph = viewer.graph;
    if (graph.isEditing()) graph.stopEditing(false);
    var wires = targetWires(graph);
    var model = graph.getModel();
    model.beginUpdate();
    try {
      for (var i = 0; i < wires.length; i++) graph.resetEdge(wires[i]);
    } finally {
      model.endUpdate();
    }
    changed();
  }

  // The waypoints a handle stands for, in the view's coordinates: the one under it, or the
  // corners of the segment it sits in the middle of. Gone in one undoable change.
  function removeHandle(graph, cell, index) {
    var handler = graph.selectionCellsHandler.getHandler(cell);
    var geometry = graph.getModel().getGeometry(cell);
    if (!handler || !handler.bends || geometry === null || !geometry.points || geometry.points.length === 0) return;
    var view = graph.view;
    var scale = view.scale;
    // A wire inside a group or a lane has its waypoints relative to that parent
    var parentState = view.getState(graph.getModel().getParent(cell));
    var origin = parentState && parentState.origin ? parentState.origin : { x: 0, y: 0 };
    var shown = function (point) { return { x: (point.x + origin.x + view.translate.x) * scale, y: (point.y + origin.y + view.translate.y) * scale }; };
    var near = function (a, b) { return Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2; };
    var bounds = handler.bends[index].bounds;
    var handle = { x: bounds.getCenterX(), y: bounds.getCenterY() };
    var points = geometry.points;
    var gone = points.filter(function (point) { return near(shown(point), handle); });
    var corners = handler.state.absolutePoints || [];
    if (gone.length === 0 && index > 0 && index < corners.length) {
      var from = corners[index - 1];
      var to = corners[index];
      gone = points.filter(function (point) { var at = shown(point); return (from && near(at, from)) || (to && near(at, to)); });
    }
    if (gone.length === 0) return;
    var next = geometry.clone();
    next.points = points.filter(function (point) { return gone.indexOf(point) === -1; });
    graph.getModel().setGeometry(cell, next);
  }

  function targetWireStyle(graph) {
    var wires = targetWires(graph);
    if (wires.length === 0) return newWireStyle(graph);
    var first = wireStyleOf(graph, wires[0]);
    for (var i = 1; i < wires.length; i++) if (wireStyleOf(graph, wires[i]) !== first) return "mixed";
    return first;
  }

  function newWireStyle(graph) {
    var current = graph.currentEdgeStyle || {};
    if (current.edgeStyle == null || current.edgeStyle === "none") return "straight";
    return current.curved == "1" ? "curved" : "orthogonal";
  }

  // New wires take this style (Graph.createCurrentEdgeStyle reads currentEdgeStyle)
  function setNewWireStyle(graph, name) {
    var current = mxUtils.clone(graph.currentEdgeStyle || {});
    var keys = WIRE_STYLES[name];
    for (var key in keys) {
      if (keys[key] === null) delete current[key];
      else current[key] = keys[key];
    }
    graph.currentEdgeStyle = current;
  }

  // One model update: one undo takes it back. Waypoints go, as draw.io resets them: laid out
  // for one style, they make no sense in another
  function applyWireStyle(name) {
    if (touch === null || viewer === null || !WIRE_STYLES[name]) return;
    var graph = viewer.graph;
    if (graph.isEditing()) graph.stopEditing(false);
    var wires = targetWires(graph);
    var model = graph.getModel();
    model.beginUpdate();
    try {
      for (var i = 0; i < wires.length; i++) {
        graph.resetEdge(wires[i]);
        var keys = WIRE_STYLES[name];
        for (var key in keys) graph.setCellStyles(key, keys[key], [wires[i]]);
      }
    } finally {
      model.endUpdate();
    }
    setNewWireStyle(graph, name);
    changed();
  }

  // The viewer holds back the editing core it bundles; this lets it go, for the page shown
  function startTouchUp() {
    if (viewer === null || touch !== null) return;
    var graph = viewer.graph;
    graph.setEnabled(true);
    // The viewer replaces click with a no-op: nothing would select on click, and an edge —
    // selected by click, not by mousedown like a shape — would never show its handles
    delete graph.click;
    graph.setCellsLocked(false);
    graph.setDisconnectOnMove(false);
    // A wire must end on a shape: one left hanging is what drawio_check reports as an
    // error, and a touch-up should not hand the agent a file it would refuse
    graph.setAllowDanglingEdges(false);
    // The file's own grid, as draw.io would snap to it: a box dropped at x=1089 is one
    // the next reader nudges by hand, and the drawio skill asks for multiples of 10
    var page = originalModel();
    graph.setGridEnabled(page === null || page.getAttribute("grid") !== "0");
    graph.gridSize = Number(page !== null && page.getAttribute("gridSize")) || 10;
    var undo = new mxUndoManager();
    var record = function (sender, event) { undo.undoableEditHappened(event.getProperty("edit")); changed(); };
    graph.getModel().addListener(mxEvent.UNDO, record);
    graph.getView().addListener(mxEvent.UNDO, record);
    // The viewer sizes its drawing area once, to the diagram as it came: a box dragged past
    // its right or bottom edge would vanish there, moved but out of reach. The area grows
    // with the diagram instead, as draw.io's page does, and the frame scrolls to it; past
    // the left or top edge there is nothing to scroll to, so a box stops at the origin.
    graph.setAllowNegativeCoordinates(false);
    var shown = viewer;
    var grow = function () {
      var bounds = graph.getGraphBounds();
      var width = bounds.x + bounds.width + 2 * graph.border;
      var height = bounds.y + bounds.height + 2 * graph.border;
      if (width > container.offsetWidth) shown.updateContainerWidth(container, width);
      if (height > container.offsetHeight) shown.updateContainerHeight(container, height);
    };
    graph.getModel().addListener(mxEvent.CHANGE, grow);
    // New wires start in the style most of the page's wires have: an agent's diagonal wires
    // get diagonal neighbours, not draw.io's orthogonal default
    var counts = { straight: 0, orthogonal: 0, curved: 0 };
    pageWires(graph).forEach(function (cell) { counts[wireStyleOf(graph, cell)] += 1; });
    var most = counts.orthogonal >= counts.straight && counts.orthogonal >= counts.curved ? "orthogonal" : counts.straight >= counts.curved ? "straight" : "curved";
    setNewWireStyle(graph, most);
    graph.getSelectionModel().addListener(mxEvent.CHANGE, changed);
    graph.addListener(mxEvent.EDITING_STARTED, changed);
    graph.addListener(mxEvent.EDITING_STOPPED, changed);
    // The keys are the graph's own, not the document's: mxKeyHandler only takes an event
    // whose target is its element, and a frame's keys otherwise land on <body>
    var container = graph.container;
    container.setAttribute("tabindex", "-1");
    container.style.outline = "none";
    var keys = new mxKeyHandler(graph, container);
    // A bend is taken out by a click on its handle, then Delete — as a shape is. draw.io's own
    // gestures stay as they are beside it. The handle clicked is remembered, drawn apart, until
    // the next click or selection. A straight wire has a handle on each waypoint; an orthogonal
    // one has a handle in the middle of each segment instead, whose corners are the waypoints:
    // Delete takes out the waypoint under the handle, or the waypoints at the segment's corners.
    var chosen = null;
    // After a bend goes, Delete waits for the next click: a second press, or a held key, would
    // otherwise delete the wire still selected under it
    var bendJustRemoved = false;
    var showChosen = function (on) {
      if (chosen === null) return;
      var handler = graph.selectionCellsHandler.getHandler(chosen.cell);
      var shape = handler && handler.bends ? handler.bends[chosen.index] : null;
      if (!shape) return;
      shape.fill = on ? "#f97316" : mxConstants.HANDLE_FILLCOLOR;
      shape.redraw();
    };
    var forget = function () { showChosen(false); chosen = null; };
    var pickBend = {
      mouseDown: function (sender, me) {
        forget();
        bendJustRemoved = false;
        var cells = graph.getSelectionCells();
        for (var i = 0; i < cells.length; i++) {
          if (!graph.getModel().isEdge(cells[i])) continue;
          var handler = graph.selectionCellsHandler.getHandler(cells[i]);
          if (!handler || !handler.bends) continue;
          var index = handler.getHandleForEvent(me);
          // 0 and the last handle are the wire's ends; virtual bends are negative
          if (index !== null && index > 0 && index < handler.bends.length - 1) {
            chosen = { cell: cells[i], index: index };
            return;
          }
        }
      },
      mouseMove: function () {},
      mouseUp: function () { showChosen(true); },
    };
    // First in line: the edge handler, once it has the press, has started dragging that bend
    graph.addMouseListener(pickBend);
    graph.mouseListeners.unshift(graph.mouseListeners.pop());
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
      if (chosen !== null && !graph.isCellSelected(chosen.cell)) forget();
    });
    var remove = function () {
      if (!graph.isEnabled()) return;
      if (chosen !== null && graph.isCellSelected(chosen.cell)) {
        var bend = chosen;
        chosen = null;
        removeHandle(graph, bend.cell, bend.index);
        bendJustRemoved = true;
        return;
      }
      if (bendJustRemoved) return;
      if (!graph.isSelectionEmpty()) graph.deleteCells(graph.getDeletableCells(graph.getSelectionCells()));
    };
    keys.bindKey(46, remove);
    keys.bindKey(8, remove);
    // Undo and redo by hand: mxKeyHandler's control bindings never see ⌘ on a Mac
    var history = function (event) {
      if (graph.isEditing() || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      var key = (event.key || "").toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      undoOrRedo(key === "y" || event.shiftKey);
    };
    container.addEventListener("keydown", history);
    // mxGraph prevents the default of a pointerdown, which is what would have given the
    // graph the keyboard — and with it the mousedown that would follow, so this listens
    // for the pointer: without it Delete and ⌘Z go nowhere. Not while a label is being
    // typed, which has the keyboard already
    // A frame cannot always take the keyboard from its parent by itself (a headless
    // browser, a window not in front): the parent is asked to focus it too
    var focus = function () {
      if (graph.isEditing()) return;
      container.focus({ preventScroll: true });
      tell({ type: M.FOCUS });
    };
    document.addEventListener("pointerdown", focus, true);
    // Another page would carry this one's history and edits with it: refused while dirty,
    // and a clean start on the page arrived at
    var showPage = viewer.updateGraphXml;
    viewer.updateGraphXml = function () {
      if (touch !== null && touch.undo.indexOfNextAdd !== touch.clean) {
        tell({ type: M.PAGE_LOCKED });
        return;
      }
      var result = showPage.apply(this, arguments);
      if (touch !== null) {
        touch.undo.clear();
        touch.clean = 0;
        changed();
      }
      return result;
    };
    touch = { undo: undo, keys: keys, clean: 0, record: record, showPage: showPage, focus: focus, history: history, container: container, grow: grow, pickBend: pickBend };
    changed();
  }

  function stopTouchUp() {
    if (touch === null) return;
    var current = touch;
    touch = null;
    current.keys.destroy();
    if (viewer !== null) viewer.graph.removeMouseListener(current.pickBend);
    document.removeEventListener("pointerdown", current.focus, true);
    current.container.removeEventListener("keydown", current.history);
    if (viewer !== null) {
      viewer.updateGraphXml = current.showPage;
      viewer.graph.getModel().removeListener(current.record);
      viewer.graph.getModel().removeListener(current.grow);
      viewer.graph.removeListener(changed);
      viewer.graph.getSelectionModel().removeListener(changed);
      viewer.graph.getView().removeListener(current.record);
    }
  }

  function undoOrRedo(redo) {
    if (touch === null) return;
    if (viewer.graph.isEditing()) viewer.graph.stopEditing(false);
    if (redo) { if (touch.undo.canRedo()) touch.undo.redo(); }
    else if (touch.undo.canUndo()) touch.undo.undo();
    changed();
  }

  // The page shown as draw.io's file had it: its <mxGraphModel>, inflated if it was compressed
  function originalModel() {
    var node = viewer.diagrams && viewer.diagrams.length > 0 ? viewer.diagrams[viewer.currentPage || 0] : viewer.xmlNode;
    if (node.nodeName === "mxGraphModel") return node;
    var models = node.getElementsByTagName("mxGraphModel");
    if (models.length > 0) return models[0];
    var text = mxUtils.getTextContent(node);
    return text ? mxUtils.parseXml(Graph.decompress(text)).documentElement : null;
  }

  function save() {
    var graph = viewer.graph;
    // A label still being typed is part of what the reader means to save
    if (graph.isEditing()) graph.stopEditing(false);
    var model = new mxCodec(mxUtils.createXmlDocument()).encode(graph.getModel());
    // The codec writes only the cells: grid, page size and the rest are the file's own
    var original = originalModel();
    if (original !== null) {
      for (var i = 0; i < original.attributes.length; i++) {
        var attribute = original.attributes[i];
        if (!model.hasAttribute(attribute.name)) model.setAttribute(attribute.name, attribute.value);
      }
    }
    if (touch !== null) touch.saving = touch.undo.indexOfNextAdd;
    tell({ type: M.SAVED, page: viewer.currentPage || 0, xml: mxUtils.getPrettyXml(model) });
  }

  function exportSvg() {
    var graph = viewer.graph;
    // Plain text beside each HTML label (draw.io's <switch> fallback), for readers that
    // ignore foreignObject — Word among them
    var svg = graph.getSvg(null, 1, 10, false, null, true);
    var names = viewer.diagrams && viewer.diagrams.length > 0 ? viewer.diagrams[viewer.currentPage || 0].getAttribute("name") : null;
    tell({ type: M.SVG, page: viewer.currentPage || 0, name: names, svg: '<?xml version="1.0" encoding="UTF-8"?>\\n' + mxUtils.getXml(svg) });
  }

  // The keyboard is in this frame once it has been clicked, so the application never sees
  // an Escape typed here: passed on, except while a label is typed, where Escape cancels
  // the label first, as in draw.io
  // On the window, capturing: before mxGraph's own handlers, which take Escape to cancel
  // a gesture in progress and can keep it from bubbling — right after a drag, it was lost
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (viewer !== null && viewer.graph.isEditing()) return;
    tell({ type: M.ESCAPE });
  }, true);

  window.addEventListener("message", function (event) {
    // Only the application that holds this frame
    if (event.source !== parent) return;
    var data = event.data;
    if (!data) return;
    if (data.type === M.RENDER && typeof data.xml === "string") render(data.xml, data.dark === true, data.page);
    else if (data.type === M.EDIT) {
      editing = data.on === true;
      if (editing) startTouchUp();
      // The text to come back to, when the parent has a newer one (a save landed); else the last
      else if (typeof data.xml === "string") render(data.xml, data.dark === true);
      else if (touch !== null && last !== null) render(last.xml, last.dark);
    }
    else if (viewer === null) return;
    else if (data.type === M.SAVE && touch !== null) save();
    else if (data.type === M.CLEAN && touch !== null && touch.saving !== undefined) { touch.clean = touch.saving; changed(); }
    else if (data.type === M.UNDO) undoOrRedo(false);
    else if (data.type === M.REDO) undoOrRedo(true);
    else if (data.type === M.EXPORT_SVG) exportSvg();
    else if (data.type === M.WIRE_STYLE && typeof data.style === "string") applyWireStyle(data.style);
    else if (data.type === M.REMOVE_BENDS) removeBends();
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
