/**
 * A minimal MCP Apps host for the planning view, on the SDK's own `AppBridge`, as the
 * SDK's `basic-host` example wires it: the view in a sandboxed frame, the bridge on
 * postMessage, the view's `tools/call` relayed to the real server (through a function
 * the test exposes), and everything the view asks of the host recorded in `hostLog`.
 *
 * Bundled by the spec with esbuild and loaded into a blank page.
 */
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/server";

interface HostLogEntry {
  method: string;
  params: unknown;
}

declare global {
  interface Window {
    hostLog: HostLogEntry[];
    relayToolCall: (params: unknown) => Promise<CallToolResult>;
    startHost: (options: { html: string; toolInput: Record<string, unknown>; toolResult: CallToolResult; theme: "light" | "dark"; downloadFile?: boolean }) => Promise<void>;
  }
}

window.hostLog = [];
const record = (method: string, params: unknown) => window.hostLog.push({ method, params });

window.startHost = async ({ html, toolInput, toolResult, theme, downloadFile }) => {
  const iframe = document.createElement("iframe");
  iframe.id = "view";
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.cssText = "width:900px;height:150px;border:0;display:block";
  document.body.append(iframe);

  const bridge = new AppBridge(
    null,
    { name: "e2e-host", version: "1" },
    { serverTools: {}, updateModelContext: { text: {} }, ...(downloadFile ? { downloadFile: {} } : {}) },
    { hostContext: { theme, platform: "web", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"], containerDimensions: { maxHeight: 6000 } } },
  );
  bridge.oncalltool = async (params) => {
    record("tools/call", params);
    return window.relayToolCall(params);
  };
  bridge.ondownloadfile = async (params) => {
    record("ui/download-file", params);
    return {};
  };
  bridge.onmessage = async (params) => {
    record("ui/message", params);
    return {};
  };
  bridge.onupdatemodelcontext = async (params) => {
    record("ui/update-model-context", params);
    return {};
  };
  bridge.onsizechange = ({ width, height }) => {
    record("ui/notifications/size-changed", { width, height });
    if (height !== undefined) iframe.style.height = `${height}px`;
  };
  bridge.onrequestdisplaymode = async (params) => {
    record("ui/request-display-mode", params);
    const mode = params.mode === "fullscreen" ? "fullscreen" : "inline";
    await bridge.sendHostContextChange({ displayMode: mode });
    return { mode };
  };
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });

  // Listening before the view loads: it starts the handshake as soon as it runs. The
  // frame's window proxy outlives the navigation to srcdoc, so it can be bound now.
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  iframe.srcdoc = html;
  await initialized;
  await bridge.sendToolInput({ arguments: toolInput });
  await bridge.sendToolResult(toolResult);
};
