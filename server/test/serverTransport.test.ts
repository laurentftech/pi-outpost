import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { listenerTls } from "../src/serverTransport.ts";
import { browsableUrl } from "../src/openBrowser.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tls");
const certFile = path.join(fixtures, "test-cert.pem");
const keyFile = path.join(fixtures, "test-key.pem");

async function configCase(run: (dir: string, read: (server: unknown, env?: NodeJS.ProcessEnv) => ReturnType<typeof loadConfig>) => Promise<void> | void) {
  const dir = await mkdtemp(path.join(tmpdir(), "outpost-transport-config-"));
  const file = path.join(dir, "config.json");
  try {
    await run(dir, (server, env = {}) => {
      // Synchronous config loading is the production boundary; keep the file write synchronous too.
      writeConfig(file, server);
      return loadConfig(dir, { config: file }, env, { quiet: true });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function writeConfig(file: string, server: unknown) {
  writeFileSync(file, JSON.stringify({ sandbox: false, server }));
}

test("LocalHttp", async () => configCase((_dir, read) => {
  for (const host of ["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]) {
    assert.equal(read({ host }).tls, undefined);
  }
}));

test("RemoteHttpRefused", async () => configCase((_dir, read) => {
  for (const host of ["0.0.0.0", "::", "192.168.1.2", "remote.example.com"]) {
    assert.throws(() => read({ host, token: "test-secret" }), /refusing unencrypted HTTP/);
  }
}));

test("RemoteStillRequiresToken", async () => configCase((_dir, read) => {
  assert.throws(() => read({ host: "0.0.0.0", tls: { certFile, keyFile } }), /without an auth token/);
  assert.throws(() => read({ host: "0.0.0.0", allowInsecureHttp: true }), /without an auth token/);
}));

test("TlsFilesResolveAgainstConfig", async () => configCase((dir, read) => {
  const config = read({ tls: { certFile: "cert.pem", keyFile: "key.pem" } });
  assert.deepEqual(config.tls, { certFile: path.resolve(dir, "cert.pem"), keyFile: path.resolve(dir, "key.pem") });
}));

test("IncompleteTlsRejected", async () => configCase((_dir, read) => {
  for (const tls of [{}, { certFile }, { keyFile }, { certFile: " ", keyFile }, { certFile, keyFile: "" }, { certFile: 42, keyFile }]) {
    assert.throws(() => read({ tls }), /server.tls|certFile|keyFile/);
  }
  assert.throws(() => read({ allowInsecureHttp: "true" }), /boolean/);
}));

test("EnvironmentPolicyOverride", async () => configCase((_dir, read) => {
  const remote = { host: "0.0.0.0", token: "test-secret", allowInsecureHttp: true };
  assert.throws(() => read(remote, { PI_OUTPOST_ALLOW_INSECURE_HTTP: "0" }), /refusing unencrypted HTTP/);
  assert.equal(read({ ...remote, allowInsecureHttp: false }, { PI_OUTPOST_ALLOW_INSECURE_HTTP: "1" }).allowInsecureHttp, true);
  const config = read({ tls: { certFile, keyFile } }, { PI_OUTPOST_TLS_CERT: "other-cert.pem", PI_OUTPOST_TLS_KEY: "other-key.pem" });
  assert.deepEqual(config.tls, { certFile: path.resolve("other-cert.pem"), keyFile: path.resolve("other-key.pem") });
  for (const value of ["", "true", "yes", "2"]) assert.throws(() => read({}, { PI_OUTPOST_ALLOW_INSECURE_HTTP: value }), /must be 0 or 1/);
  assert.throws(() => read({}, { PI_OUTPOST_TLS_CERT: "" }), /nonempty/);
}));

test("EnvOverridesConfig", async () => configCase((_dir, read) => {
  assert.equal(read({ token: "file-token" }, { PI_OUTPOST_TOKEN: "environment-token" }).token, "environment-token");
}));

test("Native TLS enforces a TLS 1.2 floor and HTTPS browser URLs", async () => {
  const options = await listenerTls({ tls: { certFile, keyFile } });
  assert.equal(options?.minVersion, "TLSv1.2");
  assert.equal(browsableUrl({ address: "0.0.0.0", port: 3141 }, "https"), "https://127.0.0.1:3141/");
  assert.equal(browsableUrl({ address: "::1", port: 3141 }, "https"), "https://[::1]:3141/");
  assert.equal(await listenerTls({}), undefined);
});

test("InvalidTlsFailsClosed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "outpost-invalid-tls-"));
  try {
    const invalid = path.join(dir, "invalid.pem");
    await writeFile(invalid, "not PEM: PRIVATE_TEST_SENTINEL");
    const wrongKey = path.join(dir, "wrong-key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await writeFile(wrongKey, privateKey.export({ format: "pem", type: "pkcs8" }));
    for (const tls of [
      { certFile: path.join(dir, "missing.pem"), keyFile },
      { certFile: invalid, keyFile }, { certFile, keyFile: invalid },
      { certFile, keyFile: wrongKey },
      { certFile: path.join(fixtures, "expired-cert.pem"), keyFile },
      { certFile: path.join(fixtures, "future-cert.pem"), keyFile },
    ]) {
      await assert.rejects(listenerTls({ tls }), (error: Error) => {
        assert.match(error.message, /server.tls/);
        assert.doesNotMatch(error.message, /PRIVATE_TEST_SENTINEL|BEGIN.*PRIVATE KEY/);
        return true;
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
