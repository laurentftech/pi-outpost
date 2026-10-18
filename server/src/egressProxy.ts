/**
 * The only way out of a confined shell under `sandbox.allowedHosts`.
 *
 * MXC's process container runs each command with outbound traffic denied and this proxy as
 * its `runtimeConfig.networkProxy`: MXC sets `HTTPS_PROXY` and `HTTP_PROXY` in the command's
 * environment, curl, git and npm follow them, and a direct connection is refused by the
 * sandbox. The proxy relays a `CONNECT`, or a plain HTTP request, to a listed host and answers
 * anything else `403`, with the host and the key in the status line, so the model can tell the
 * user what to add rather than retry.
 *
 * The host is the boundary, not the port: a listed host is reachable on any port.
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { connect, type Socket } from "node:net";

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

/** A host name (`registry.npmjs.org`), an IPv4 address, or `*.` and a name for the names under it. */
export function isAllowedHostPattern(pattern: string): boolean {
  const name = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
  return name.length > 0 && name.length <= 253 && name.split(".").every((label) => HOST_LABEL.test(label));
}

/** Whether `host` is one `allowedHosts` names: exactly, or under a `*.` suffix (the suffix itself excluded). */
export function hostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((pattern) => (pattern.startsWith("*.") ? name.endsWith(pattern.slice(1)) : name === pattern));
}

/** `host:port` of a `CONNECT` target, IPv6 brackets removed; undefined when it is not one. */
function connectTarget(url: string | undefined): { host: string; port: number } | undefined {
  const match = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(url ?? "");
  const port = Number(match?.[2]);
  return match && port > 0 && port < 65536 ? { host: match[1], port } : undefined;
}

export interface EgressProxy {
  /** `http://127.0.0.1:<port>`, for `runtimeConfig.networkProxy`. */
  url: string;
  /** Tells `listener` the host of every refusal from now on; the returned function stops it. */
  watchRefusals(listener: (host: string) => void): () => void;
  close(): Promise<void>;
}

export interface EgressProxyOptions {
  allowedHosts: readonly string[];
  /** Told of every refusal, with the line to log. Default: the server's console. */
  onRefused?: (line: string) => void;
  /** Told of every relayed `host:port`. */
  onRelayed?: (target: string) => void;
}

export async function startEgressProxy(options: EgressProxyOptions): Promise<EgressProxy> {
  const refused = options.onRefused ?? ((line) => console.log(line));
  const sockets = new Set<Socket>();
  const watchers = new Set<(host: string) => void>();
  const refuse = (host: string, what: string, why: string) => {
    refused(`[sandbox] network: refused ${what} — ${why}`);
    for (const watcher of watchers) watcher(host);
    return why.replace(/[\r\n]/g, " ");
  };

  const server: Server = createServer((request: IncomingMessage, response) => {
    // Absolute-form requests: plain HTTP through the proxy, relayed to a listed host as a
    // tunnel is. Windows' TLS needs it: Schannel fetches a certificate's revocation list from
    // its authority over plain HTTP (`http://c.pki.goog/…`), and curl fails without it.
    const url = URL.canParse(request.url ?? "") ? new URL(request.url!) : undefined;
    if (!url || url.protocol !== "http:" || !hostAllowed(url.hostname, options.allowedHosts)) {
      const host = url?.hostname || String(request.url);
      const reason = refuse(host, `${request.method} ${request.url}`, `${host} is not in sandbox.allowedHosts`);
      response.writeHead(403, reason, { "content-type": "text/plain", connection: "close" }).end(`${reason}\n`);
      return;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(url.port) || 80;
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !/^proxy-/i.test(name)));
    const upstream = httpRequest({ host, port, method: request.method, path: `${url.pathname}${url.search}`, headers }, (answer) => {
      options.onRelayed?.(`${host}:${port}`);
      response.writeHead(answer.statusCode ?? 502, answer.statusMessage, answer.headers);
      answer.pipe(response);
    });
    upstream.on("error", (error) => {
      if (!response.headersSent) response.writeHead(502, `${host} could not be reached`, { "content-type": "text/plain" });
      response.end(`${host} could not be reached: ${error.message}\n`);
    });
    request.pipe(upstream);
  });
  server.on("connect", (request: IncomingMessage, client: Socket, head: Buffer) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());
    const target = connectTarget(request.url);
    if (!target || !hostAllowed(target.host, options.allowedHosts)) {
      const host = target?.host ?? String(request.url);
      const reason = refuse(host, `CONNECT ${request.url}`, `${host} is not in sandbox.allowedHosts`);
      client.end(`HTTP/1.1 403 ${reason}\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n${reason}\n`);
      return;
    }
    const upstream = connect(target.port, target.host, () => {
      options.onRelayed?.(`${target.host}:${target.port}`);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", (error) => {
      if (client.writable && !client.destroyed && upstream.bytesRead === 0 && upstream.bytesWritten === 0) {
        client.end(`HTTP/1.1 502 ${target.host} could not be reached: ${error.message.replace(/[\r\n]/g, " ")}\r\nconnection: close\r\n\r\n`);
      } else {
        client.destroy();
      }
    });
    client.on("close", () => upstream.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  // A server that only serves its own confined commands: it never keeps the process alive.
  server.unref();
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    watchRefusals: (listener) => {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const shared = new Map<string, Promise<EgressProxy>>();

/**
 * One proxy per list for the server's life: sessions rebuilt by a Settings apply, and
 * workspaces with the same list, share it.
 */
export function sharedEgressProxy(allowedHosts: readonly string[]): Promise<EgressProxy> {
  const key = [...new Set(allowedHosts)].sort().join("\n");
  let proxy = shared.get(key);
  if (!proxy) {
    proxy = startEgressProxy({ allowedHosts: [...allowedHosts] });
    proxy.catch(() => shared.delete(key));
    shared.set(key, proxy);
  }
  return proxy;
}
