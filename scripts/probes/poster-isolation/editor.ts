// The editor side of the isolation probe: GrapesJS as the pi-outpost frame would run it,
// loading the poster the parent posts and answering with what it shows.
import grapesjs from "grapesjs";
import parserPostCSS from "grapesjs-parser-postcss";
import "grapesjs/dist/css/grapes.min.css";

window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.type !== "load") return;
  const editor = grapesjs.init({
    container: "#gjs",
    height: "100%",
    fromElement: false,
    storageManager: false,
    // Found by this probe: GrapesJS posts telemetry to app.grapesjs.com and loads Font
    // Awesome from a CDN unless told not to.
    telemetry: false,
    cssIcons: "",
    panels: { defaults: [] },
    deviceManager: { devices: [{ id: "page", name: "Page", width: "794px", height: "1123px", widthMedia: "" }] },
    plugins: [parserPostCSS],
    canvas: { styles: [], scripts: [] },
    components: event.data.html,
    style: event.data.css,
  });
  (window as unknown as { editor: unknown }).editor = editor;
  editor.on("load", () => parent.postMessage({ type: "loaded", html: editor.getWrapper()!.getInnerHTML() }, "*"));
});
document.addEventListener("securitypolicyviolation", (event) => parent.postMessage({ type: "violation", directive: event.violatedDirective, blocked: event.blockedURI }, "*"));
parent.postMessage({ type: "ready" }, "*");
