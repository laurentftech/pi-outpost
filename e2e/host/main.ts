/**
 * The host application, reduced to what a host application actually does: import
 * the published entry point, call mount(), keep the handle.
 *
 * The import is `@pi-outpost/embed` rather than a relative path into src, so it
 * resolves through package.json's `exports` map — the same resolution a consumer
 * gets, against the same built bundle. Importing the source would test code we
 * do not ship.
 *
 * React is left to the bundler here, exactly as in a host app: the widget
 * declares it as a peer dependency, so this page is where the single copy comes
 * from. (That there is only one copy is asserted against the artifact, in
 * scripts/check-embed-package.mjs — a bundled second React runs fine in its own
 * tree and would not fail here.)
 */
import { mount, type MountHandle, type Theme } from "@pi-outpost/embed";

declare global {
  interface Window {
    /** Handed to the test so it drives the public API rather than internals. */
    __embed: {
      setTheme(theme: Theme): void;
      unmount(): void;
    };
  }
}

const container = document.querySelector<HTMLElement>("#widget")!;
// The server the widget talks to; the test's global setup puts a real one here.
const serverUrl = new URLSearchParams(location.search).get("server") ?? undefined;

const handle: MountHandle = mount(container, {
  ...(serverUrl === undefined ? {} : { serverUrl }),
  theme: "light",
});

window.__embed = {
  setTheme: (theme) => handle.setTheme(theme),
  unmount: () => handle.unmount(),
};
