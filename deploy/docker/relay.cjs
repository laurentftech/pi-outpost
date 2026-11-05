// Optional TCP relay. It shares only the app's network namespace, no project,
// agent-state volume or secret. Explicit operator opt-in and ports are required.
const net = require("node:net");
const os = require("node:os");
if (process.env.ALLOW_APP_LISTENERS !== "1") throw new Error("App relay requires ALLOW_APP_LISTENERS=1.");
const entries = (process.env.APP_PORTS ?? "").split(",").map(x => x.trim());
if (!entries.length || entries.some(x => !/^\d+$/.test(x) || +x < 1024 || +x > 65535 || +x === 3141)) {
  throw new Error("APP_PORTS must list TCP ports 1024–65535, excluding pi-outpost's port 3141.");
}
const ports = [...new Set(entries.map(Number))];
const addresses = [...new Set(Object.values(os.networkInterfaces()).flat()
  .filter(x => x && x.family === "IPv4" && !x.internal).map(x => x.address))];
if (!addresses.length) throw new Error("The app relay needs a Docker bridge IPv4 address.");
const servers = [];
const sockets = new Set();
for (const host of addresses) for (const port of ports) {
  const server = net.createServer(client => {
    const upstream = net.connect({ host: "127.0.0.1", port });
    sockets.add(client);
    sockets.add(upstream);
    const close = () => { client.destroy(); upstream.destroy(); };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", () => { sockets.delete(client); upstream.destroy(); });
    upstream.on("close", () => { sockets.delete(upstream); client.destroy(); });
    client.pipe(upstream);
    upstream.pipe(client);
  });
  server.on("error", error => { console.error("App relay failed:", error.code); process.exit(1); });
  // Bind the bridge address, never 0.0.0.0: Python owns 127.0.0.1 on this port.
  server.listen({ host, port });
  servers.push(server);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  for (const server of servers) server.close();
  for (const socket of sockets) socket.destroy();
});
