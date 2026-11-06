/**
 * A real Git smart-HTTPS server behind HTTP Basic authentication, for tests.
 *
 * HTTPS because that is the only scheme pi-outpost accepts and stores credentials for.
 * The certificate (`git-https-test.crt`, CN and SAN 127.0.0.1, valid for a century) is a
 * test fixture; a git process trusts it through `GIT_SSL_CAINFO` — `gitTrustEnv()` —
 * and the server under test inherits that variable, so nothing is weakened by turning
 * verification off.
 *
 * `git http-backend` does the Git side (it is the CGI program Git ships for exactly
 * this); this file only checks the `Authorization` header, answers 401 with a
 * `WWW-Authenticate` challenge when it is missing or wrong, and relays CGI in both
 * directions. That is the shape a private Gitea/GitLab presents to a clone: git asks
 * its credential helpers on the 401, so the code under test meets real git behaviour,
 * not a stub of it.
 *
 * Every request is recorded (method, path, whether it carried credentials, which user),
 * so a test can assert what git actually sent — e.g. that no credential was offered.
 */
import { spawn, execFileSync } from "node:child_process";

import { createServer } from "node:https";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GIT_TEST_CA = path.join(HERE, "git-https-test.crt");
const TLS = { key: readFileSync(path.join(HERE, "git-https-test.key")), cert: readFileSync(GIT_TEST_CA) };

/** What a git process (or a server spawning one) needs to trust the test server. */
export function gitTrustEnv() {
  return { GIT_SSL_CAINFO: GIT_TEST_CA };
}

/**
 * Create a bare repository `<root>/<name>.git` with one commit holding `files`.
 * Returns its path. Uses a throwaway work tree so the bare repo is a real push target.
 */
export function makeBareRepository(root, name, files = { "skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo skill\n---\nDemo.\n" }) {
  const bare = path.join(root, `${name}.git`);
  const work = path.join(root, `${name}-work`);
  const git = (cwd, args) => execFileSync("git", args, { cwd, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1" } });
  mkdirSync(bare, { recursive: true });
  git(bare, ["init", "-q", "--bare", "--initial-branch=main"]);
  // Smart HTTP refuses to serve a repository it was not told it may export.
  git(bare, ["config", "http.receivepack", "true"]);
  mkdirSync(work, { recursive: true });
  git(work, ["init", "-q", "--initial-branch=main"]);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    writeFileSync(path.join(work, file), body);
  }
  git(work, ["add", "-A"]);
  git(work, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "seed"]);
  git(work, ["push", "-q", bare, "main"]);
  return bare;
}

/**
 * Start the server on 127.0.0.1. `credentials` is `{ username, password }`, or a function
 * returning it so a test can change the accepted secret while the server runs.
 */
export async function startGitHttpServer({ root, credentials }) {
  const requests = [];
  const accepted = typeof credentials === "function" ? credentials : () => credentials;

  const server = createServer(TLS, (req, res) => {
    const header = req.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");
    let user;
    let ok = false;
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      user = decoded.slice(0, colon);
      const expected = accepted();
      ok = user === expected.username && decoded.slice(colon + 1) === expected.password;
    }
    const url = new URL(req.url, "https://127.0.0.1");
    requests.push({ method: req.method, path: url.pathname, authorized: ok, user, hadCredentials: Boolean(encoded) });
    if (!ok) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"', "Content-Type": "text/plain" });
      res.end("authentication required\n");
      return;
    }
    const backend = spawn("git", ["http-backend"], {
      env: {
        PATH: process.env.PATH,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: devNull,
        REQUEST_METHOD: req.method,
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers["content-type"] ?? "",
        REMOTE_USER: user,
        REMOTE_ADDR: "127.0.0.1",
        ...(req.headers["git-protocol"] ? { GIT_PROTOCOL: req.headers["git-protocol"] } : {}),
      },
    });
    req.pipe(backend.stdin);
    let headerDone = false;
    let pending = Buffer.alloc(0);
    backend.stdout.on("data", (chunk) => {
      if (headerDone) {
        res.write(chunk);
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf("\r\n\r\n");
      if (end === -1) return;
      headerDone = true;
      let status = 200;
      for (const line of pending.subarray(0, end).toString("utf8").split("\r\n")) {
        const colon = line.indexOf(":");
        const name = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
        else res.setHeader(name, value);
      }
      res.writeHead(status);
      res.write(pending.subarray(end + 4));
    });
    backend.on("close", () => res.end());
    backend.stderr.resume();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `https://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
