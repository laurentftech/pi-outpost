/**
 * The signing relay: git commits signed inside the sandbox, the key staying in the server.
 *
 * GnuPG for Windows is built without ASLR, which MXC's process container enforces, so `gpg.exe`
 * cannot start inside the sandbox at all — and the private keys must stay out of it anyway: a key
 * a confined command can read is a key it can print and send anywhere. Same shape as the registry
 * relay (`registryRelay.ts`): the confined shell's `gpg.program` points at a shim in the sandbox
 * cache, which POSTs the payload to this relay on the host's loopback (open under MXC), and the
 * server runs gpg unconfined, with the user's real HOME/GNUPGHOME. Only payloads cross into the
 * server and only signatures come back.
 *
 * Sign only: verification (`git log --show-signature`) passes file paths to gpg, and letting a
 * confined command name files for the server to read would open the host's — so `--verify` is
 * refused and the shim exits non-zero; git then reports the commit as unsigned. Verify outside the
 * sandbox, or from the app, which runs git unconfined.
 */
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";

/**
 * The shim the confined shell's `gpg.program` points at; written into the sandbox cache. A `.cmd`:
 * git starts `gpg.program` with CreateProcess, which runs batch files but not `.ps1` — the wrapper
 * only hands the inner PowerShell script the args.
 */
export const SIGNING_SHIM_NAME = "gpg-relay.cmd";

/** Payload cap: a commit object is kilobytes; a tag a little more. */
const MAX_PAYLOAD = 1024 * 1024;

/**
 * The gpg flags git passes when signing (`-bsau <key>` and friends). Anything else the sandbox
 * sends is refused: the relay runs gpg unconfined, so its arguments are the server's to vet.
 */
const FLAGS = new Set(["-b", "--detach-sign", "-s", "--sign", "-a", "--armor", "-u", "--local-user", "--status-fd", "--keyid-format", "--output", "-o", "--batch", "--yes", "--pinentry-mode", "--no-tty", "--quiet", "-q"]);
/** Whitelisted flags that take the next argument as their value. */
const VALUE_FLAGS = new Set(["-u", "--local-user", "--status-fd", "--keyid-format", "--output", "-o", "--pinentry-mode"]);

/** A value a whitelisted flag takes: a key id, a file descriptor number, a format — nothing path-like. */
const VALUE = /^[\w@.:+-]{1,256}$/;

export interface SigningRelay {
  port: number;
  /** The per-launch token the shim presents; compared in constant time. */
  token: string;
  /** The shim path, for `gpg.program`. */
  shim: string;
  close(): Promise<void>;
}

export interface SigningRelayOptions {
  /** Where the shim is written; the sandbox policy makes the cache readable. */
  cacheDir: string;
  /** The server's environment: the user's HOME and GNUPGHOME, for gpg to find the key. */
  serverEnv?: NodeJS.ProcessEnv;
  /** The signer to run unconfined: the user's own `gpg.program` when their gitconfig names one, else `gpg`. */
  program?: string;
  /** For tests: run the signer instead of gpg. */
  runSigner?: (args: string[], payload: Buffer, env: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: Buffer; stderr: Buffer }>;
}

/** Short flags that may be combined, as git passes them (`-bsau <key>`): detach, sign, armor, quiet. */
const SHORT_FLAGS = new Set(["b", "s", "a", "q"]);
/** The combined short flag that takes the next argument as its value: `-u <key>`. */
const SHORT_VALUE = "u";

/** Validate git's gpg arguments: whitelisted flags, values only after the flags that take one. */
export function signingArgs(args: readonly string[]): string[] | undefined {
  // Combined short flags (`-bsau`) expand to their letters; any other letter is refused.
  const expanded: string[] = [];
  for (const arg of args) {
    if (/^-[A-Za-z]{2,}$/.test(arg)) {
      const letters = arg.slice(1).split("");
      for (let i = 0; i < letters.length; i++) {
        const letter = letters[i]!;
        if (letter.toLowerCase() === SHORT_VALUE && i === letters.length - 1) {
          expanded.push("-u");
          continue;
        }
        if (SHORT_FLAGS.has(letter.toLowerCase())) {
          expanded.push(`-${letter.toLowerCase()}`);
          continue;
        }
        return undefined;
      }
    } else expanded.push(arg);
  }
  const kept: string[] = [];
  for (let i = 0; i < expanded.length; i++) {
    const arg = expanded[i]!;
    if (VALUE_FLAGS.has(kept[kept.length - 1] ?? "")) {
      if (!VALUE.test(arg)) return undefined;
      kept.push(arg);
      continue;
    }
    if (!FLAGS.has(arg) || !/^--?[A-Za-z0-9][\w-]*$/.test(arg)) return undefined;
    if (arg === "--verify") return undefined; // sign only: verification names files for the host to read
    kept.push(arg);
  }
  if (kept.length === 0) return undefined;
  if (VALUE_FLAGS.has(kept[kept.length - 1]!)) return undefined; // a value flag left without its value
  return kept;
}

/** A script's lines joined with CRLF, the line ending Windows' cmd and PowerShell expect. */
const crlf = (lines: string[]): string => lines.join("\r\n") + "\r\n";

/** The shim git starts: hands git's args to the inner PowerShell script, which POSTs the payload. */
function shimScript(port: number, token: string): string {
  return crlf([
    "@echo off",
    "rem pi-outpost's signing relay shim: git's gpg.program in the sandbox. The key stays in the server.",
    `"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0${SIGNING_SHIM_NAME.replace(/\.cmd$/i, "")}.inner.ps1" %*`,
    "exit /b %ERRORLEVEL%",
  ]);
}

function shimInnerScript(port: number, token: string): string {
  return crlf([
    '$ErrorActionPreference = "Stop"',
    "$in = [Console]::OpenStandardInput()",
    "$ms = New-Object System.IO.MemoryStream",
    "$in.CopyTo($ms)",
    "$body = $ms.ToArray()",
    '$qs = @(); foreach ($a in $args) { $qs += "a=" + [Uri]::EscapeDataString([string]$a) }',
    `$uri = "http://127.0.0.1:${port}/sign/${token}" + $(if ($qs.Count) { "?" + ($qs -join "&") } else { "" })`,
    "try {",
    '  $resp = Invoke-WebRequest -Uri $uri -Method Post -Body $body -ContentType "application/octet-stream" -UseBasicParsing',
    "  [Console]::Out.Write($resp.Content)",
    "  exit 0",
    "} catch {",
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    "  exit 1",
    "}",
  ]);
}

const defaultRunSigner = (program: string, serverEnv: NodeJS.ProcessEnv) => (args: string[], payload: Buffer, env: NodeJS.ProcessEnv) =>
  new Promise<{ code: number; stdout: Buffer; stderr: Buffer }>((resolve) => {
    const child = spawn(program, [...args, "--batch", "--yes"], { env: { ...env, ...serverEnv } });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => resolve({ code: 127, stdout: Buffer.alloc(0), stderr: Buffer.from(String(error)) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    child.stdin.write(payload);
    child.stdin.end();
  });

export async function startSigningRelay(options: SigningRelayOptions): Promise<SigningRelay> {
  const token = randomBytes(24).toString("hex");
  const runSigner = options.runSigner ?? defaultRunSigner(options.program ?? "gpg", options.serverEnv ?? process.env);
  const shim = path.join(options.cacheDir, SIGNING_SHIM_NAME);
  const inner = `${shim.replace(/\.cmd$/i, "")}.inner.ps1`;
  let port = 0;

  const answer = (response: ServerResponse, status: number, message: string) =>
    response.writeHead(status, { "content-type": "text/plain", connection: "close" }).end(`${message}\n`);

  const handle = (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const match = /^\/sign\/([0-9a-f]+)$/.exec(url.pathname);
    const given = Buffer.from(match?.[1] ?? "");
    const expected = Buffer.from(token);
    if (!match || given.length !== expected.length || !timingSafeEqual(given, expected)) return answer(response, 404, "no such relay");
    if (request.method !== "POST") return answer(response, 405, "the signing relay takes POST only");
    const args = signingArgs(url.searchParams.getAll("a"));
    if (args === undefined) return answer(response, 400, "an argument the relay does not take");
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    request.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_PAYLOAD) {
        // Answer at the end, once the body is drained: destroying the socket now would take the
        // 413 with it. Past a hard limit the connection is dropped instead.
        over = true;
        chunks.length = 0;
        if (size > MAX_PAYLOAD * 4) request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (over) return answer(response, 413, "the payload is over the relay's cap");
      void (async () => {
        const env = { ...process.env, ...(options.serverEnv ?? {}) };
        const result = await runSigner(args, Buffer.concat(chunks), env);
        if (result.code === 0) response.writeHead(200, { "content-type": "text/plain" }).end(result.stdout);
        else answer(response, 500, `the signer failed: ${result.stderr.toString().split(/\r?\n/)[0] ?? result.code}`);
      })();
    });
  };

  const server: Server = createServer((request, response) => handle(request, response, new URL(request.url ?? "/", "http://127.0.0.1")));
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
  await mkdir(options.cacheDir, { recursive: true });
  await writeFile(shim, shimScript(port, token), { mode: 0o644 });
  await writeFile(inner, shimInnerScript(port, token), { mode: 0o644 });

  return {
    port,
    token,
    shim,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
