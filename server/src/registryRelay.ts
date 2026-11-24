/**
 * The registries a user's configuration authenticates to, reached by confined commands without the
 * credentials ever entering the sandbox.
 *
 * A command can read whatever its tools read: a token handed to the sandbox is a token the agent can
 * print, and send anywhere. So the user's credentials stay here, in the server, which runs unconfined.
 * The copies of the user's configuration a command sees (`carryUserConfigs`) name this relay instead of
 * the registry; the relay forwards each request to the registry with the user's credentials added.
 * The agent can use the user's mirror; it can never read the secret, nor take it elsewhere.
 *
 * Read only: GET and HEAD. Installing needs nothing else, and a relay that took PUT would let the
 * agent publish under the user's name. Only the registries the user's files name, under a path
 * holding a token this server drew at start. What the registry answers is passed back with every
 * absolute link to it pointing at the relay (an index's file links, a packument's tarballs, NuGet's
 * service index), and without its cookies: a session cookie is a credential too.
 *
 * Reached two ways (`relayBase`): on the host's loopback, where a command reaches the host's own
 * services (MXC on Windows without `sandbox.allowedHosts`); or under `allowedHosts`, through the
 * command's proxy, as the host `RELAY_HOST`, which every egress proxy hands here (`egressProxy.ts`).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import * as tls from "node:tls";
import { gunzipSync, brotliDecompressSync, inflateSync } from "node:zlib";

/** The host a command names to reach the relay through its proxy. `.invalid` resolves nowhere. */
export const RELAY_HOST = "registry-relay.pi-outpost.invalid";

/** How a command reaches the relay: the host's loopback, or its proxy. */
export type RelayRoute = "loopback" | "proxy";

interface Registry {
  /** `https://host[:port]`, the credentials' scope. */
  origin: string;
  /** The `authorization` header the registry wants. */
  authorization: string;
}

/** A text answer larger than this is passed as it is, its links unchanged. */
const REWRITE_LIMIT = 64 * 1024 * 1024;

export interface RegistryRelay {
  /** Registers a registry and its credentials; the base URL a command uses for it, ending in `/`. */
  register(origin: string, authorization: string, route: RelayRoute): string;
  /** Serves one request whose path starts after the host: `/<token>/<id>/…`. */
  handle(request: IncomingMessage, response: ServerResponse, path: string, route: RelayRoute): void;
  /** `http://127.0.0.1:<port>`. */
  url: string;
  close(): Promise<void>;
}

export interface RegistryRelayOptions {
  /** The server's environment: its proxy variables, to reach a registry behind a company's proxy. */
  serverEnv?: NodeJS.ProcessEnv;
  /** For tests: the request to the registry, instead of node's http(s). */
  upstream?: typeof httpsRequest;
}

/** A registry's origin, normalised: scheme and host lower case, the default port dropped. */
export function registryOrigin(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  return `${parsed.protocol}//${parsed.host}`;
}

export async function startRegistryRelay(options: RegistryRelayOptions = {}): Promise<RegistryRelay> {
  const token = randomBytes(24).toString("hex");
  const registries = new Map<string, Registry>();
  let port = 0;
  const baseFor = (id: string, route: RelayRoute) => (route === "proxy" ? `http://${RELAY_HOST}` : `http://127.0.0.1:${port}`) + `/${token}/${id}/`;

  const handle = (request: IncomingMessage, response: ServerResponse, path: string, route: RelayRoute) => {
    const match = /^\/([0-9a-f]+)\/([0-9a-f]{16})\/(.*)$/s.exec(path);
    const given = Buffer.from(match?.[1] ?? "");
    const expected = Buffer.from(token);
    const registry = match && given.length === expected.length && timingSafeEqual(given, expected) ? registries.get(match[2]!) : undefined;
    if (!registry) return answer(response, 404, "no such registry on this relay");
    if (request.method !== "GET" && request.method !== "HEAD") {
      return answer(response, 405, "the registry relay is read only: install, never publish, with the user's credentials");
    }
    const relayBase = baseFor(match![2]!, route);
    forward(request, response, registry, match![3]!, relayBase, options);
  };

  const server: Server = createServer((request, response) => handle(request, response, request.url ?? "/", "loopback"));
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as { port: number }).port;
  server.unref();

  return {
    register(origin, authorization, route) {
      // The same registry and credentials, the same id: a copy rewritten at each launch keeps its URL.
      const id = createHash("sha256").update(`${origin}\n${authorization}`).digest("hex").slice(0, 16);
      registries.set(id, { origin, authorization });
      return baseFor(id, route);
    },
    handle,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function answer(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, message, { "content-type": "text/plain", connection: "close" }).end(`[pi-outpost] ${message}\n`);
}

/** Request headers never forwarded: the relay's own, the command's credentials, hop by hop. */
const DROPPED_REQUEST = /^(?:host|authorization|cookie|proxy-.*|connection|keep-alive|transfer-encoding|upgrade|te|accept-encoding)$/i;
/** Answer headers never passed back: a cookie is a session, and lengths change with the links. */
const DROPPED_ANSWER = /^(?:set-cookie|set-cookie2|content-length|content-encoding|transfer-encoding|connection|keep-alive)$/i;
/** Answers whose links to the registry are rewritten to the relay: indexes, packuments, service indexes. */
const TEXT = /^(?:text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|xhtml\+xml)|application\/vnd\.(?:pypi\.simple|npm)[\w.+-]*)/i;

function forward(request: IncomingMessage, response: ServerResponse, registry: Registry, rest: string, relayBase: string, options: RegistryRelayOptions): void {
  const target = new URL(rest.replace(/^\/+/, ""), `${registry.origin}/`);
  // A path cannot leave the registry: URL resolution keeps its origin, and anything else is refused.
  if (`${target.protocol}//${target.host}` !== registry.origin) return answer(response, 400, "a path outside the registry");
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) if (value !== undefined && !DROPPED_REQUEST.test(name)) headers[name] = value;
  headers.authorization = registry.authorization;
  headers["accept-encoding"] = "identity";
  const secure = target.protocol === "https:";
  const send = options.upstream ?? (secure ? httpsRequest : (httpRequest as unknown as typeof httpsRequest));
  const proxy = secure ? companyProxy(target.hostname, options.serverEnv ?? process.env) : undefined;
  const upstream = send(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: Number(target.port) || (secure ? 443 : 80),
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers,
      ...(secure ? { ca: trustedAuthorities() } : {}),
      ...(proxy ? { agent: false, createConnection: tunnelThrough(proxy, target) } : {}),
    },
    (reply) => pass(reply, response, registry, relayBase, request.method === "HEAD"),
  );
  upstream.on("error", (error) => {
    if (!response.headersSent) answer(response, 502, `the registry ${registry.origin} could not be reached: ${error.message.replace(/[\r\n]+/g, " ")}`);
    else response.destroy();
  });
  upstream.end();
}

function pass(reply: IncomingMessage, response: ServerResponse, registry: Registry, relayBase: string, head: boolean): void {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(reply.headers)) if (value !== undefined && !DROPPED_ANSWER.test(name)) headers[name] = value;
  const location = reply.headers.location;
  if (typeof location === "string") headers.location = toRelay(location, registry.origin, relayBase);
  const type = String(reply.headers["content-type"] ?? "");
  const encoding = String(reply.headers["content-encoding"] ?? "identity").toLowerCase();
  if (head) {
    response.writeHead(reply.statusCode ?? 502, reply.statusMessage, headers).end();
    reply.resume();
    return;
  }
  if (!TEXT.test(type)) {
    // A package itself: as it comes, never held in memory. Its encoding goes with it.
    if (reply.headers["content-length"] && encoding === "identity") headers["content-length"] = reply.headers["content-length"];
    if (encoding !== "identity") headers["content-encoding"] = encoding;
    response.writeHead(reply.statusCode ?? 502, reply.statusMessage, headers);
    reply.pipe(response);
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  reply.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size <= REWRITE_LIMIT) chunks.push(chunk);
  });
  reply.on("end", () => {
    let body = Buffer.concat(chunks);
    try {
      body = encoding === "gzip" ? gunzipSync(body) : encoding === "br" ? brotliDecompressSync(body) : encoding === "deflate" ? inflateSync(body) : body;
    } catch {
      return answer(response, 502, `the registry ${registry.origin} sent an answer that could not be read`);
    }
    if (size > REWRITE_LIMIT) return answer(response, 502, `the registry ${registry.origin} sent an index too large to relay`);
    const text = toRelay(body.toString("utf8"), registry.origin, relayBase);
    const out = Buffer.from(text, "utf8");
    response.writeHead(reply.statusCode ?? 502, reply.statusMessage, { ...headers, "content-length": String(out.length) }).end(out);
  });
  reply.on("error", () => response.destroy());
}

/** Every absolute link to the registry, plain or JSON-escaped, pointed at the relay. */
export function toRelay(text: string, origin: string, relayBase: string): string {
  const base = relayBase.replace(/\/$/, "");
  const escaped = (s: string) => s.replaceAll("/", "\\/");
  const variants = [origin, origin.replace(/^https?:/, (scheme) => (scheme === "https:" ? "http:" : "https:"))].flatMap((o) => [o, escaped(o)]);
  let out = text;
  for (const variant of new Set(variants)) {
    const target = variant.includes("\\/") ? escaped(base) : base;
    // Only the origin itself: not a longer host that starts with it (`nexus.corp.example.evil`), nor
    // another port of it — but its default port, written out.
    const pattern = `${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?::443|:80)?(?![\\w.-]|:\\d)`;
    out = out.replace(new RegExp(pattern, "gi"), target);
  }
  return out;
}

/** The proxy a request to `host` goes through, from the server's own variables; undefined to go direct. */
function companyProxy(host: string, env: NodeJS.ProcessEnv): URL | undefined {
  const raw = env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy;
  if (!raw) return undefined;
  const bypass = (env.NO_PROXY || env.no_proxy || "").split(/[,\s]+/).filter(Boolean);
  const name = host.toLowerCase();
  if (bypass.some((entry) => entry === "*" || name === entry.replace(/^\./, "") || name.endsWith(entry.startsWith(".") ? entry : `.${entry}`))) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  return URL.canParse(withScheme) ? new URL(withScheme) : undefined;
}

/** A TLS connection to `target` through `proxy`'s CONNECT, its account (if any) sent to the proxy alone. */
function tunnelThrough(proxy: URL, target: URL) {
  return (_options: unknown, ready: (error: Error | null, socket: Duplex) => void): undefined => {
    const port = target.port || "443";
    const auth = proxy.username ? { "proxy-authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}` } : {};
    const connect = httpRequest({ host: proxy.hostname, port: proxy.port || 80, method: "CONNECT", path: `${target.hostname}:${port}`, headers: { host: `${target.hostname}:${port}`, ...auth } });
    connect.on("connect", (reply, socket) => {
      if (reply.statusCode !== 200) {
        socket.destroy();
        ready(new Error(`the company proxy ${proxy.host} answered ${reply.statusCode} to CONNECT ${target.hostname}:${port}`), socket);
        return;
      }
      ready(null, tls.connect({ socket, servername: target.hostname, ca: trustedAuthorities() }));
    });
    connect.on("error", (error) => ready(error, undefined as unknown as Duplex));
    connect.end();
    return undefined;
  };
}

let authorities: string[] | undefined;
/**
 * Node's bundled authorities and the machine's own: a company's mirror is usually signed by the
 * company's authority, which Windows trusts and Node, by default, does not.
 */
function trustedAuthorities(): string[] {
  if (authorities) return authorities;
  const get = (tls as unknown as { getCACertificates?: (kind: string) => string[] }).getCACertificates;
  try {
    authorities = get ? [...new Set([...get("default"), ...get("system")])] : [...tls.rootCertificates];
  } catch {
    authorities = [...tls.rootCertificates];
  }
  return authorities;
}

let shared: Promise<RegistryRelay> | undefined;
/** The relay for the server's life, started when a configuration first needs it. */
export function registryRelay(): Promise<RegistryRelay> {
  shared ??= startRegistryRelay();
  shared.catch(() => (shared = undefined));
  return shared;
}

/** The relay if it has started: an egress proxy hands it a request for `RELAY_HOST`. */
export function startedRegistryRelay(): Promise<RegistryRelay> | undefined {
  return shared;
}
