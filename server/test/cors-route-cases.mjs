/** HTTP routes whose CORS behaviour is exercised by cors.test.mjs. */
export const HTTP_ROUTE_CASES = [
  { registration: "/branding", path: "/branding", label: "branding" },
  { registration: "/health", path: "/health", label: "health" },
  { registration: "/files/raw", path: "/files/raw?path=readme.md", label: "files/raw" },
  { registration: "/files/download", path: "/files/download?path=readme.md", label: "files/download" },
  { registration: "/*", path: "/", label: "the static app" },
];

/** The upgrade route is exercised as a WebSocket, not as an HTTP response. */
export const WEBSOCKET_ROUTE = "/ws";
