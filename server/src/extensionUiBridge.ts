/**
 * Extension "Custom UI" bridge for the embedded runtime.
 *
 * See https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui
 * Mirrors pi's own RPC-mode ExtensionUIContext (dialogs forwarded as JSON, client
 * answers by id) but over the WebSocket instead of stdin/stdout — every connected
 * tab sees the request and whichever answers first resolves it.
 *
 * Lifted out of index.ts when the runtime boundary went in: the RPC runtime gets
 * the *same* requests straight off Pi's stdout, so the server's handling of them
 * must not live in a function that only the embedded path can reach.
 */
import { randomUUID } from "node:crypto";
import { getThemeByName } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import type { ExtensionUIRequest, ExtensionUIResponse } from "@pi-outpost/shared";

type PendingExtensionRequest = { resolve: (response: ExtensionUIResponse) => void };

/** Sends dialog requests through `emit` and resolves them from client answers. */
export class ExtensionUiBridge {
  private readonly pending = new Map<string, PendingExtensionRequest>();

  constructor(private readonly emit: (request: ExtensionUIRequest) => void) {}

  /** Resolve a pending dialog/editor request the client just answered. */
  answer(response: ExtensionUIResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  /** Unblock every extension still awaiting an answer from a session about to be replaced. */
  cancelAll(): void {
    for (const pending of this.pending.values()) {
      pending.resolve({ type: "extension_ui_response", id: "", cancelled: true });
    }
    this.pending.clear();
  }

  /** Dialog helper: sends a request, resolves on the matching response, timeout, or abort. */
  private dialog<T>(
    opts: { signal?: AbortSignal; timeout?: number } | undefined,
    defaultValue: T,
    request: ExtensionUIRequest,
    parseResponse: (response: ExtensionUIResponse) => T,
  ): Promise<T> {
    if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
    const id = request.id;
    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        opts?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
      };
      const onAbort = () => {
        cleanup();
        resolve(defaultValue);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts?.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          resolve(defaultValue);
        }, opts.timeout);
      }
      this.pending.set(id, {
        resolve: (response) => {
          cleanup();
          resolve(parseResponse(response));
        },
      });
      this.emit(request);
    });
  }

  /**
   * Build the ExtensionUIContext bound to the current AgentSession. TUI-only
   * concerns (custom components, footers/headers, editor replacement, terminal
   * input) have no web equivalent and are no-ops, same as pi's own RPC
   * mode — extensions relying on those still work in the pi CLI, just not here.
   */
  createContext() {
    const bridge = this;
    return {
      select(title: string, options: string[], opts?: { signal?: AbortSignal; timeout?: number }) {
        const id = randomUUID();
        return bridge.dialog(
          opts,
          undefined,
          { type: "extension_ui_request", id, method: "select", title, options, timeout: opts?.timeout },
          (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
        );
      },
      confirm(title: string, message: string, opts?: { signal?: AbortSignal; timeout?: number }) {
        const id = randomUUID();
        return bridge.dialog(
          opts,
          false,
          { type: "extension_ui_request", id, method: "confirm", title, message, timeout: opts?.timeout },
          (r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
        );
      },
      input(title: string, placeholder?: string, opts?: { signal?: AbortSignal; timeout?: number }) {
        const id = randomUUID();
        return bridge.dialog(
          opts,
          undefined,
          { type: "extension_ui_request", id, method: "input", title, placeholder, timeout: opts?.timeout },
          (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
        );
      },
      notify(message: string, notifyType?: "info" | "warning" | "error") {
        bridge.emit({ type: "extension_ui_request", id: randomUUID(), method: "notify", message, notifyType });
      },
      onTerminalInput() {
        // Raw terminal input has no web equivalent
        return () => {};
      },
      setStatus(statusKey: string, statusText: string | undefined) {
        bridge.emit({ type: "extension_ui_request", id: randomUUID(), method: "setStatus", statusKey, statusText });
      },
      setWorkingMessage() {},
      setWorkingVisible() {},
      setWorkingIndicator() {},
      setHiddenThinkingLabel() {},
      setWidget(
        widgetKey: string,
        content: string[] | undefined | ((...args: never[]) => unknown),
        options?: { placement?: "aboveEditor" | "belowEditor" },
      ) {
        // Component factories need a TUI to render into — only string arrays are supported here
        if (content === undefined || Array.isArray(content)) {
          bridge.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "setWidget",
            widgetKey,
            widgetLines: content,
            widgetPlacement: options?.placement,
          });
        }
      },
      setFooter() {},
      setHeader() {},
      setTitle(title: string) {
        bridge.emit({ type: "extension_ui_request", id: randomUUID(), method: "setTitle", title });
      },
      async custom() {
        // Custom TUI components can't run in the browser
        return undefined;
      },
      pasteToEditor(text: string) {
        this.setEditorText(text);
      },
      setEditorText(text: string) {
        bridge.emit({ type: "extension_ui_request", id: randomUUID(), method: "set_editor_text", text });
      },
      getEditorText() {
        // Synchronous — can't wait on the client's current composer text
        return "";
      },
      editor(title: string, prefill?: string): Promise<string | undefined> {
        const id = randomUUID();
        return new Promise((resolve) => {
          bridge.pending.set(id, {
            resolve: (response) => {
              if ("cancelled" in response && response.cancelled) resolve(undefined);
              else if ("value" in response) resolve(response.value);
              else resolve(undefined);
            },
          });
          bridge.emit({ type: "extension_ui_request", id, method: "editor", title, prefill });
        });
      },
      addAutocompleteProvider() {},
      setEditorComponent() {},
      getEditorComponent() {
        return undefined;
      },
      // Extensions such as pi-blackhole style statuses through ctx.ui.theme, not
      // by writing escapes themselves. Keep the SDK's semantic colours; the web
      // renderer interprets their ANSI sequences. Like ExtensionRenderer, use a
      // standalone theme rather than the process-global interactive TUI theme.
      get theme() {
        const theme = getThemeByName("dark");
        if (!theme) throw new Error("The built-in Pi dark theme is unavailable");
        return theme;
      },
      getAllThemes() {
        return [];
      },
      getTheme() {
        return undefined;
      },
      setTheme() {
        return { success: false, error: "Theme switching not supported in pi-outpost" };
      },
      getToolsExpanded() {
        return false;
      },
      setToolsExpanded() {},
    };
  }
}

