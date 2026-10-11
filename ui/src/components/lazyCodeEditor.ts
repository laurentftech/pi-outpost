/**
 * The file editor, fetched when it may be needed rather than with the application.
 *
 * CodeMirror is most of a hundred kilobytes the reader of a file never uses. The viewer
 * starts loading it as soon as it shows a file the reader may edit (`preloadCodeEditor`),
 * so it is normally there before the edit button is pressed. Once loaded, the lazy
 * component resolves synchronously — no fallback flash on the next file, and tests that
 * preload it render the editor in the same pass as the click.
 */
import { lazy, type ComponentType } from "react";
import type { CodeEditor as CodeEditorComponent } from "./CodeEditor";

type Module = typeof import("./CodeEditor");

let loaded: Module | null = null;
let loading: Promise<Module> | null = null;

export function preloadCodeEditor(): Promise<Module> {
  loading ??= import("./CodeEditor").then(
    (module) => (loaded = module),
    (error: unknown) => {
      // A failed fetch (offline, a redeploy) is tried again next time, not remembered.
      loading = null;
      throw error;
    },
  );
  return loading;
}

export const LazyCodeEditor = lazy(() => {
  type Default = { default: ComponentType<Parameters<typeof CodeEditorComponent>[0]> };
  if (loaded !== null) {
    const module = loaded;
    // A thenable that answers at once: React then renders without suspending.
    return { then: (resolve: (value: Default) => void) => resolve({ default: module.CodeEditor }) } as unknown as Promise<Default>;
  }
  return preloadCodeEditor().then((module) => ({ default: module.CodeEditor }));
});
