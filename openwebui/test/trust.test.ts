/**
 * The trust boundary: nothing is read or written for a request Open WebUI did not
 * send, or that does not say — verifiably, in signed mode — whose it is.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ConfigError, ENV, loadConfig } from "../src/config.ts";
import { bearerMatches, resolveOwner, verifySignedIdentity } from "../src/trust.ts";
import { KEY, SECRET, filesUnder, mintToken, samplePlanning, testApp } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

function startServer(env: Record<string, string>) {
  // Only the variables given: the developer's own OUTPOST_* must not leak in.
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("OUTPOST_")));
  return spawnSync(process.execPath, ["--import", "tsx", MAIN], {
    cwd: path.dirname(MAIN),
    env: { ...clean, ...env, [ENV.port]: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
}

// openlore: scenario=TheServerWillNotStartWithoutASecret spec=openwebui-planning-server
test("TheServerWillNotStartWithoutASecret: it exits naming the setting and listens on nothing", () => {
  const run = startServer({ [ENV.identityKey]: KEY });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /OUTPOST_SECRET is not set/);
  assert.doesNotMatch(run.stdout, /listening/);
  assert.throws(() => loadConfig({ [ENV.identityKey]: KEY }), ConfigError);
});

// openlore: scenario=SignedModeWillNotStartWithoutAKey spec=openwebui-planning-server
test("SignedModeWillNotStartWithoutAKey: signed is the default mode, and it needs the key", () => {
  const run = startServer({ [ENV.secret]: SECRET });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /OUTPOST_IDENTITY_KEY is not set/);
  assert.doesNotMatch(run.stdout, /listening/);
  // Plain mode needs no key.
  assert.equal(loadConfig({ [ENV.secret]: SECRET, [ENV.identity]: "plain" }).identity, "plain");
});

test("bearer comparison takes exactly the configured key", () => {
  assert.equal(bearerMatches(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(bearerMatches(`bearer   ${SECRET} `, SECRET), true);
  assert.equal(bearerMatches(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(bearerMatches(SECRET, SECRET), false);
  assert.equal(bearerMatches(undefined, SECRET), false);
  assert.equal(bearerMatches("Bearer ", SECRET), false);
  assert.equal(bearerMatches("Bearer\tx", SECRET), false);
  // A run of spaces must cost nothing (CodeQL: polynomial regular expression).
  const started = performance.now();
  assert.equal(bearerMatches(`bearer ${" ".repeat(200_000)}x`, SECRET), false);
  assert.ok(performance.now() - started < 50, "linear in the header's length");
});

// openlore: scenario=ARequestWithoutTheSecretIsRefused spec=openwebui-planning-server
test("ARequestWithoutTheSecretIsRefused: no bearer, or a wrong one, reads and writes nothing", async (t) => {
  const { app, config, call } = await testApp(t);
  const created = await call("create_planning", { planning: samplePlanning() });
  assert.equal(created.statusCode, 201);
  const id = created.json().id as string;
  const before = await filesUnder(config.dataDir);

  for (const authorization of [undefined, "Bearer wrong", `Basic ${SECRET}`]) {
    for (const [tool, body] of [
      ["list_plannings", {}],
      ["get_planning", { id }],
      ["show_planning", { id }],
      ["create_planning", { planning: samplePlanning("Intruder") }],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/${tool}`,
        headers: { ...(authorization ? { authorization } : {}), "x-openwebui-user-jwt": mintToken("alice") },
        payload: body,
      });
      assert.equal(response.statusCode, 401, `${tool} with ${authorization}`);
      assert.doesNotMatch(response.body, /Programme X|pl_/);
    }
    const description = await app.inject({ method: "GET", url: "/openapi.json", headers: authorization ? { authorization } : {} });
    assert.equal(description.statusCode, 401);
  }
  assert.deepEqual(await filesUnder(config.dataDir), before);
});

// openlore: scenario=ARequestWithoutAUserIsRefused spec=openwebui-planning-server
test("ARequestWithoutAUserIsRefused: the right secret alone acts for nobody", async (t) => {
  for (const identity of ["signed", "plain"] as const) {
    const { app, config } = await testApp(t, { identity });
    for (const tool of ["list_plannings", "create_planning"]) {
      const response = await app.inject({
        method: "POST",
        url: `/${tool}`,
        headers: { authorization: `Bearer ${SECRET}` },
        payload: tool === "create_planning" ? { planning: samplePlanning() } : {},
      });
      assert.equal(response.statusCode, 401, `${identity} ${tool}`);
      assert.match(response.json().error, /identity/);
    }
    assert.deepEqual(await filesUnder(config.dataDir), []);
    // The description acts for nobody, so it needs no user.
    const description = await app.inject({ method: "GET", url: "/openapi.json", headers: { authorization: `Bearer ${SECRET}` } });
    assert.equal(description.statusCode, 200);
  }
});

// openlore: scenario=AForgedTokenIsRefused spec=openwebui-planning-server
test("AForgedTokenIsRefused: another key, another algorithm, another issuer, a tampered payload", async (t) => {
  const { app, config } = await testApp(t);
  const genuine = mintToken("alice");
  const [h, , s] = genuine.split(".");
  const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: "mallory", iss: "open-webui", exp: Date.now() / 1000 + 300 })).toString("base64url")}.${s}`;
  const forgeries = {
    "other key": mintToken("alice", { key: "not-the-key" }),
    "alg none": mintToken("alice", { alg: "none" }),
    "other issuer": mintToken("alice", { iss: "someone-else" }),
    tampered,
    garbage: "not.a.token",
  };
  for (const [name, token] of Object.entries(forgeries)) {
    const response = await app.inject({
      method: "POST",
      url: "/create_planning",
      headers: { authorization: `Bearer ${SECRET}`, "x-openwebui-user-jwt": token },
      payload: { planning: samplePlanning() },
    });
    assert.equal(response.statusCode, 401, name);
  }
  assert.deepEqual(await filesUnder(config.dataDir), []);
  assert.ok("refused" in verifySignedIdentity(forgeries["other key"], KEY));
});

// openlore: scenario=AnExpiredTokenIsRefused spec=openwebui-planning-server
test("AnExpiredTokenIsRefused: a genuine token past its expiry acts for nobody", async (t) => {
  const { app, config } = await testApp(t);
  const response = await app.inject({
    method: "POST",
    url: "/create_planning",
    headers: { authorization: `Bearer ${SECRET}`, "x-openwebui-user-jwt": mintToken("alice", { expiresIn: -120 }) },
    payload: { planning: samplePlanning() },
  });
  assert.equal(response.statusCode, 401);
  assert.match(response.json().error, /expired/);
  assert.deepEqual(await filesUnder(config.dataDir), []);
  // Still valid within the tolerated clock skew.
  assert.deepEqual(verifySignedIdentity(mintToken("alice", { expiresIn: -5 }), KEY), { owner: "alice" });
});

// openlore: scenario=PlainHeadersAreIgnoredInSignedMode spec=openwebui-planning-server
test("PlainHeadersAreIgnoredInSignedMode: the token's user, never the header's", async (t) => {
  const { call } = await testApp(t);
  const created = await call("create_planning", { planning: samplePlanning("Bob's") }, "bob");
  assert.equal(created.statusCode, 201);
  // Alice's token, with a header claiming to be Bob.
  const listed = await call("list_plannings", {}, "alice", { "x-openwebui-user-id": "bob" });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json().plannings, []);
  assert.deepEqual(resolveOwner({ "x-openwebui-user-id": "bob" }, "signed", KEY), {
    refused: "no signed identity: Open WebUI must forward users with FORWARD_USER_INFO_HEADER_JWT_SECRET set",
  });
});
