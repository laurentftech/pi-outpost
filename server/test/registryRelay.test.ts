/**
 * The registry relay: a confined command uses the user's authenticated registry, the credentials
 * staying in the server (`registryRelay.ts`).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { startEgressProxy } from "../src/egressProxy.ts";
import { RELAY_HOST, registryRelay, startRegistryRelay, toRelay, type RegistryRelay } from "../src/registryRelay.ts";
import { withoutCredentials } from "../src/terminalSandbox.ts";

/** One GET through `url` (and a proxy when given): status, headers, body. */
function get(url: string, options: { method?: string; proxy?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  const target = new URL(url);
  const via = options.proxy ? new URL(options.proxy) : target;
  return new Promise((resolve, reject) => {
    const sent = request(
      { host: via.hostname, port: via.port, method: options.method ?? "GET", path: options.proxy ? url : `${target.pathname}${target.search}`, headers: { host: target.host, ...options.headers } },
      (reply) => {
        const chunks: Buffer[] = [];
        reply.on("data", (chunk: Buffer) => chunks.push(chunk));
        reply.on("end", () => resolve({ status: reply.statusCode ?? 0, headers: reply.headers, body: Buffer.concat(chunks) }));
      },
    );
    sent.on("error", reject);
    sent.end();
  });
}

describe("the registry relay", () => {
  let registry: Server;
  let origin: string;
  let relay: RegistryRelay;
  const seen: IncomingHttpHeaders[] = [];
  const AUTH = `Basic ${Buffer.from("alice:s3cret").toString("base64")}`;

  before(async () => {
    // A company's registry: an index linking to its own files, a package, a redirect, a cookie.
    registry = createServer((req, res) => {
      seen.push(req.headers);
      if (req.headers.authorization !== AUTH) return void res.writeHead(401).end("who are you");
      if (req.url === "/simple/six/") {
        res.writeHead(200, { "content-type": "text/html", "set-cookie": "session=abc" });
        return void res.end(`<a href="${origin}/packages/six-1.0.whl">six</a> <a href="${origin}:9999/other">other port</a> <a href="${origin}.evil/x">not it</a>`);
      }
      if (req.url === "/packages/six-1.0.whl") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.from([0, 1, 2, 255]));
      if (req.url === "/moved") return void res.writeHead(302, { location: `${origin}/simple/six/` }).end();
      if (req.url === "/pkg") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tarball: `${origin}/pkg/-/pkg-1.0.tgz` }).replaceAll("/", "\\/"));
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => registry.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
    relay = await startRegistryRelay();
  });

  after(async () => {
    await relay?.close();
    await new Promise((resolve) => registry.close(resolve));
  });

  // openlore: scenario=TheCredentialsStayInTheServer spec=sandbox-runner-bash
  test("TheCredentialsStayInTheServer: a request through the relay is authenticated by the server; the command sends none and gets none back", async () => {
    const base = relay.register(origin, AUTH, "loopback");
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}\/[0-9a-f]{16}\/$/);
    const index = await get(`${base}simple/six/`, { headers: { authorization: "Bearer forged", cookie: "x=y" } });
    assert.equal(index.status, 200);
    assert.equal(seen.at(-1)!.authorization, AUTH, "the server's credentials, not the command's");
    assert.equal(seen.at(-1)!.cookie, undefined, "the command's cookies are not forwarded");
    assert.equal(index.headers["set-cookie"], undefined, "a session cookie is a credential: not passed back");
    const html = index.body.toString();
    assert.match(html, new RegExp(`href="${base.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}packages/six-1\\.0\\.whl"`), "a link to the registry points at the relay");
    assert.match(html, /:9999\/other/, "another port of the host is not the registry");
    assert.match(html, /\.evil\/x/, "a longer host is not the registry");
    assert.ok(!html.includes("s3cret") && !html.includes(AUTH));
    // A package passes as it is.
    const wheel = await get(`${base}packages/six-1.0.whl`);
    assert.deepEqual([...wheel.body], [0, 1, 2, 255]);
    // A redirect to the registry stays at the relay; JSON's escaped links are rewritten too.
    assert.equal((await get(`${base}moved`)).headers.location, `${base}simple/six/`);
    assert.match((await get(`${base}pkg`)).body.toString(), new RegExp(`${base.replaceAll("/", "\\\\/").replace(/[.*+?^${}()|[\]]/g, "\\$&")}pkg`));
  });

  test("read only, its token required, its registries only", async () => {
    const base = relay.register(origin, AUTH, "loopback");
    assert.equal((await get(`${base}simple/six/`, { method: "PUT" })).status, 405, "never publish with the user's credentials");
    assert.equal((await get(`${base}simple/six/`, { method: "HEAD" })).status, 200);
    const forged = base.replace(/\/[0-9a-f]{48}\//, `/${"0".repeat(48)}/`);
    assert.equal((await get(`${forged}simple/six/`)).status, 404, "a token not the server's");
    assert.equal((await get(base.replace(/[0-9a-f]{16}\/$/, "0123456789abcdef/"))).status, 404, "a registry never registered");
    const before = seen.length;
    assert.equal((await get(`${base}..%2f..%2fetc`)).status === 404 || seen.length > before, true);
    assert.ok(seen.slice(before).every((headers) => headers.host === new URL(origin).host), "never another host");
  });

  test("under sandbox.allowedHosts, a command's proxy hands the relay's host to it, asking nobody", async () => {
    const shared = await registryRelay();
    const base = shared.register(origin, AUTH, "proxy");
    assert.ok(base.startsWith(`http://${RELAY_HOST}/`));
    let asked = 0;
    const proxy = await startEgressProxy({ allowedHosts: [], ask: async () => (asked++, { allowed: false, why: "no" }) });
    try {
      const through = await get(`${base}simple/six/`, { proxy: proxy.url });
      assert.equal(through.status, 200, through.body.toString());
      assert.equal(asked, 0);
      assert.match(through.body.toString(), new RegExp(`${RELAY_HOST.replaceAll(".", "\\.")}/[0-9a-f]{48}/[0-9a-f]{16}/packages/six`));
    } finally {
      await proxy.close();
    }
  });

  test("toRelay rewrites the origin, its default port written out, and its escaped form", () => {
    assert.equal(toRelay("https://nexus.corp.example:443/a https://nexus.corp.example/b", "https://nexus.corp.example", "http://r/t/i/"), "http://r/t/i/a http://r/t/i/b");
    assert.equal(toRelay(`{"u":"https:\\/\\/nexus.corp.example\\/c"}`, "https://nexus.corp.example", "http://r/t/i/"), `{"u":"http:\\/\\/r\\/t\\/i\\/c"}`);
  });
});

describe("the user's configuration through the relay", () => {
  const relay = (origin: string, authorization: string) => `http://relay/${createHash("sha256").update(`${origin}|${authorization}`).digest("hex").slice(0, 12)}/`;
  const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  // openlore: scenario=TheCredentialsStayInTheServer spec=sandbox-runner-bash
  test("each format's authenticated registry is named at the relay, and the copy keeps no credential", () => {
    const uv = withoutCredentials(`[[index]]\nurl = "https://alice:s%40cret@nexus.corp.example:8446/repository/pypi/simple"\n`, "uv.toml", relay);
    assert.equal(uv.relayed, true);
    assert.equal(uv.text, `[[index]]\nurl = "${relay("https://nexus.corp.example:8446", basic("alice", "s@cret"))}repository/pypi/simple"\n`);

    const npm = withoutCredentials(["registry=https://npm.corp.example/repository/npm/", "@corp:registry=https://npm.corp.example/repository/npm/", "//npm.corp.example/repository/npm/:_authToken=npm_t0k", "strict-ssl=true"].join("\n"), ".npmrc", relay);
    const npmBase = relay("https://npm.corp.example", "Bearer npm_t0k");
    assert.equal(npm.text, [`registry=${npmBase}repository/npm/`, `@corp:registry=${npmBase}repository/npm/`, "strict-ssl=true"].join("\n"));

    const maven = withoutCredentials(
      `<settings><mirrors><mirror><id>corp</id><mirrorOf>*</mirrorOf><url>https://nexus.corp.example/repository/maven-public/</url></mirror></mirrors><servers><server><id>corp</id><username>alice</username><password>pw</password></server><server><id>enc</id><username>bob</username><password>{COQLCE6DU6GtcS5P=}</password></server></servers></settings>`,
      "settings.xml",
      relay,
    );
    assert.match(maven.text, new RegExp(`<url>${relay("https://nexus.corp.example", basic("alice", "pw")).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}repository/maven-public/</url>`));
    assert.doesNotMatch(maven.text, /alice|pw<|COQLCE|<servers/);

    const nuget = withoutCredentials(
      `<configuration><packageSources><add key="Corp Feed" value="https://nuget.corp.example/v3/index.json" /><add key="nuget.org" value="https://api.nuget.org/v3/index.json" /></packageSources><packageSourceCredentials><Corp_x0020_Feed><add key="Username" value="alice" /><add key="ClearTextPassword" value="s3cret" /></Corp_x0020_Feed></packageSourceCredentials></configuration>`,
      "NuGet.Config",
      relay,
    );
    assert.match(nuget.text, new RegExp(`<add key="Corp Feed" value="${relay("https://nuget.corp.example", basic("alice", "s3cret")).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}v3/index\\.json" allowInsecureConnections="true" />`));
    assert.match(nuget.text, /<add key="nuget\.org" value="https:\/\/api\.nuget\.org\/v3\/index\.json" \/>/, "a source without credentials is left as it is");
    assert.doesNotMatch(nuget.text, /alice|s3cret|packageSourceCredentials/);

    const go = withoutCredentials("GOPROXY=https://bob:pw@goproxy.corp.example,direct\n", "go env", relay);
    assert.equal(go.text, `GOPROXY=${relay("https://goproxy.corp.example", basic("bob", "pw"))},direct\n`.replace("/,", "/,"));

    // What cannot be paired with a URL is left out, unrelayed.
    const gradle = withoutCredentials("corpPassword=pw\ncorpUrl=https://nexus.corp.example/maven\n", "gradle.properties", relay);
    assert.equal(gradle.relayed, false);
    assert.equal(gradle.text, "corpUrl=https://nexus.corp.example/maven\n");
  });
});
