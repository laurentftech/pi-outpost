/**
 * The signing relay: a confined `git commit -S` signs through the server, the private key staying
 * out of the sandbox (`signingRelay.ts`).
 */
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { SIGNING_SHIM_NAME, signingArgs, startSigningRelay, type SigningRelay } from "../src/signingRelay.ts";

/** One request to the relay: status and body. */
function post(relay: SigningRelay, options: { token?: string; method?: string; args?: string[]; body?: Buffer }): Promise<{ status: number; body: Buffer }> {
  const token = options.token ?? relay.token;
  const query = (options.args ?? []).map((arg) => `a=${encodeURIComponent(arg)}`).join("&");
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port: relay.port,
        method: options.method ?? "POST",
        path: `/sign/${token}${query ? `?${query}` : ""}`,
        headers: { "content-type": "application/octet-stream" },
      },
      (reply) => {
        const chunks: Buffer[] = [];
        reply.on("data", (chunk: Buffer) => chunks.push(chunk));
        reply.on("end", () => resolve({ status: reply.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );
    sent.on("error", reject);
    sent.end(options.body ?? Buffer.from("the commit object"));
  });
}

describe("signingArgs", () => {
  test("git's signing arguments pass: detach, armor, local user, output", () => {
    assert.deepEqual(signingArgs(["-bsau", "2BD9C7A1"]), ["-b", "-s", "-a", "-u", "2BD9C7A1"], "combined short flags expand");
    assert.equal(signingArgs(["-bsax", "2BD9C7A1"]), undefined, "a letter the relay does not take");
    assert.deepEqual(signingArgs(["--detach-sign", "--armor", "--local-user", "me@example.com", "--output", "-"]), [
      "--detach-sign",
      "--armor",
      "--local-user",
      "me@example.com",
      "--output",
      "-",
    ]);
    assert.deepEqual(signingArgs(["--status-fd", "2", "--keyid-format", "0xlong"]), ["--status-fd", "2", "--keyid-format", "0xlong"]);
  });

  test("anything else is refused: verification, file paths, options the relay does not take", () => {
    assert.equal(signingArgs(["--verify", "sig.asc", "payload"]), undefined, "sign only: --verify names files for the host to read");
    assert.equal(signingArgs(["--homedir", "/home/me/.gnupg"]), undefined);
    assert.equal(signingArgs(["--output", "/etc/passwd"]), undefined, "a value that is a path");
    assert.equal(signingArgs(["--batch", "--extra", "arg"]), undefined);
    assert.equal(signingArgs(["-u"]), undefined, "a value flag left without its value");
    assert.equal(signingArgs([]), undefined, "signing with no operation is refused");
    assert.equal(signingArgs(["--local-user", "a;b"]), undefined, "a value with shell metacharacters");
  });
});

describe("the signing relay", () => {
  let cacheDir: string;
  let relay: SigningRelay;
  const calls: { args: string[]; payload: Buffer }[] = [];

  before(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "signing-relay-"));
    relay = await startSigningRelay({
      cacheDir,
      serverEnv: { HOME: "/home/me", GNUPGHOME: "/home/me/.gnupg" },
      runSigner: async (args, payload) => {
        calls.push({ args, payload });
        return { code: 0, stdout: Buffer.from(`-----BEGIN PGP SIGNATURE-----\n${payload.toString("base64")}\n-----END PGP SIGNATURE-----\n`), stderr: Buffer.alloc(0) };
      },
    });
  });

  after(async () => {
    await relay?.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  test("a POST with the token and git's args signs: the payload goes to the signer, the signature comes back", async () => {
    const answer = await post(relay, { args: ["-b", "-a", "-u", "2BD9C7A1"], body: Buffer.from("the commit object") });
    assert.equal(answer.status, 200);
    assert.ok(answer.body.toString().startsWith("-----BEGIN PGP SIGNATURE-----"));
    assert.deepEqual(calls.at(-1), { args: ["-b", "-a", "-u", "2BD9C7A1"], payload: Buffer.from("the commit object") });
  });

  test("a wrong token, another path, a GET, and a disallowed argument are each refused", async () => {
    assert.equal((await post(relay, { token: "0".repeat(48) })).status, 404);
    assert.equal((await post(relay, { token: relay.token.slice(0, -1) + (relay.token.endsWith("0") ? "1" : "0") })).status, 404, "a token of the right length but wrong value");
    assert.equal((await post(relay, { method: "GET" })).status, 405);
    assert.equal((await post(relay, { args: ["--verify", "sig.asc", "payload"] })).status, 400);
    assert.equal((await post(relay, { args: ["--homedir", "/home/me/.gnupg"] })).status, 400);
    assert.equal(calls.length, 1, "only the first POST reached the signer");
  });

  test("a payload over the cap is refused", async () => {
    const answer = await post(relay, { args: ["-b"], body: Buffer.alloc(1024 * 1024 + 1) });
    assert.equal(answer.status, 413);
    assert.equal(calls.length, 1);
  });

  test("a signer that fails answers 500 with its first line, and signs nothing", async () => {
    const otherCache = await mkdtemp(path.join(tmpdir(), "signing-relay-fail-"));
    const failing = await startSigningRelay({
      cacheDir: otherCache,
      runSigner: async () => ({ code: 2, stdout: Buffer.alloc(0), stderr: Buffer.from("gpg: signing failed: No secret key\r\nsecond line") }),
    });
    try {
      const answer = await post(failing, { args: ["-b", "-a", "-u", "DEADBEEF"] });
      assert.equal(answer.status, 500);
      assert.ok(answer.body.toString().includes("gpg: signing failed: No secret key"), answer.body.toString());
      assert.ok(!answer.body.toString().includes("second line"), "one line only");
    } finally {
      await failing.close();
      await rm(otherCache, { recursive: true, force: true });
    }
  });

  test("the shim is written into the cache as a .cmd handing the inner PowerShell script git's args", async () => {
    const shim = await readFile(path.join(cacheDir, SIGNING_SHIM_NAME), "utf8");
    assert.ok(shim.includes("powershell.exe"), shim);
    assert.ok(shim.includes(".inner.ps1"), shim);
    assert.ok(shim.includes("%*"), "git's args are handed on");
    assert.ok(shim.includes("\r\n"), "CRLF, as cmd expects");
    const inner = await readFile(path.join(cacheDir, SIGNING_SHIM_NAME.replace(/\.cmd$/i, "") + ".inner.ps1"), "utf8");
    assert.ok(inner.includes(`http://127.0.0.1:${relay.port}/sign/${relay.token}`), "the shim POSTs to this relay's token");
    assert.ok(inner.includes("OpenStandardInput"), "the payload is read from stdin");
  });
});
