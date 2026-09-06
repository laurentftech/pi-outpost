/**
 * Supervision and framing for a `pi --mode rpc` child process.
 *
 * Transport only: it spawns the child, frames JSONL both ways, correlates
 * responses to commands, and fails closed. It knows nothing about prompts,
 * sessions or models — that translation is rpcRuntime.ts's job.
 *
 * FRAMING: Pi's RPC contract is strict JSONL with LF as the *only* record
 * delimiter (docs/rpc.md § Framing). Node's `readline` also splits on U+2028 and
 * U+2029, which are valid inside JSON strings — an assistant message containing
 * one would be torn in half and parsed as two broken records. So the decoding
 * here is hand-rolled: buffer UTF-8 through a StringDecoder (a multi-byte
 * character can straddle two chunks), split on "\n", strip one trailing "\r".
 *
 * SECURITY: no shell. The executable and its arguments are an argv vector, so
 * nothing in the configuration is ever parsed as a command line, and a value
 * containing spaces or metacharacters is exactly one argument.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** Records arriving from the child that are not correlated command responses. */
export type RpcIncoming = Record<string, unknown> & { type: string };

export interface PiRpcProcessOptions {
  executable: string;
  /** Extra fixed arguments; `--mode rpc` is appended by this class, never by the caller. */
  args: string[];
  cwd: string;
  /** Pi's own config directory, passed through the environment (`PI_CODING_AGENT_DIR`). */
  agentDir?: string;
  /** Session store, passed as `--session-dir` so it wins over any inherited variable. */
  sessionDir?: string;
  /** Extra environment for the child (the tools extension reads its settings there). */
  env?: Record<string, string>;
  commandTimeoutMs: number;
  shutdownGraceMs: number;
  /** Every record that is not a correlated response: events and extension UI requests. */
  onRecord: (record: RpcIncoming) => void;
  /**
   * Called once, on the first unrecoverable transport problem. `message` is the
   * cause and is safe to show a browser; `detail` adds the child's own output and
   * belongs in the server log.
   */
  onFailure: (message: string, detail: string) => void;
}

/** How much of the child's stderr to keep for the failure message. */
const STDERR_KEEP = 4000;

/**
 * Ceiling on one JSONL record. Generous — a prompt carrying several base64 images
 * is megabytes — but finite, so a child that never sends a newline fails as a
 * protocol error rather than as an out-of-memory crash with nothing to read.
 */
const MAX_RECORD_CHARS = 64 * 1024 * 1024;

/**
 * What is actually answering prompts, for the settings panel.
 *
 * In RPC mode the SDK version pi-outpost ships says nothing about the agent: the
 * child may be pi, a fork like little-coder, or omp, at any version. Nothing in
 * the RPC protocol reports it, so it is read the only way available — by running
 * the executable once with `--version`.
 *
 * Deliberately forgiving. The three known harnesses answer "0.84.1", "omp/17.3.5"
 * and (little-coder) a line of startup noise followed by "0.83.0", so the last
 * non-empty line is taken and a version-looking token pulled out of it. A probe
 * that fails, hangs or prints something unrecognisable yields the executable's
 * name alone: knowing *which* agent runs is the part that matters, and a wrong
 * version number would be worse than none.
 */
export async function probeAgentLabel(executable: string, cwd: string, timeoutMs = 5_000): Promise<string> {
  const name = executable.split(/[\\/]/).pop() || executable;
  const version = await new Promise<string | undefined>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      // Killed on the timeout path, so it needs the same coverage exclusion.
      child = spawn(executable, ["--version"], {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv(),
        windowsHide: true,
      });
    } catch {
      return resolve(undefined);
    }
    let out = "";
    const done = (value: string | undefined) => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(value);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    timer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", () => done(undefined));
    child.on("exit", () => {
      const last = out.split("\n").map((line) => line.trim()).filter(Boolean).pop();
      if (last === undefined) return done(undefined);
      const semver = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(last);
      done(semver ? semver[0] : last.slice(0, 40));
    });
  });
  return version ? `${name} ${version}` : name;
}

let nextCommandId = 0;

/**
 * The agent-directory variable, under every name the child might read it by.
 *
 * The SDK builds the name from its own package identity —
 * `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`, where APP_NAME comes from
 * `piConfig.name` in package.json and defaults to "pi". pi, omp and little-coder all
 * currently resolve to "pi", so `PI_CODING_AGENT_DIR` reaches all three; a fork that
 * sets `piConfig.name` reads a different variable and would silently fall back to
 * *its own* default directory — different credentials, different models.json — while
 * pi-outpost logs `agentDir` and reports it in onboarding. `--session-dir` is a flag
 * and would still point at ours, which makes the split harder to notice, not easier.
 *
 * So both are set: the canonical one, and one derived from the executable's name.
 * A variable the child does not read costs nothing; the setting being ignored does.
 */
/**
 * The child's environment: ours, minus the things that are ours alone.
 *
 * `NODE_V8_COVERAGE` is the one that bites. Node sets it for the whole process
 * tree when a test run asks for coverage, so an inherited value makes the agent
 * child write its own coverage JSON into the parent's collection directory — and
 * this class kills children, by design, on every failure and on shutdown. A child
 * killed mid-write leaves a truncated file, and the parent's reporter then dies
 * parsing it: a green test run reported as a failed one, with the real failure
 * ("Could not report code coverage", a JSON syntax error at a buffer boundary)
 * naming nothing that would lead you here.
 *
 * It is set to the empty string rather than deleted, which looks wrong and is not:
 * Node re-injects the variable into a child from its own coverage state, so a
 * `delete` on the env object is silently undone and the child writes anyway. An
 * explicit empty value survives, and collects nothing.
 *
 * The agent is a separate program besides; its coverage was never ours to collect.
 */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, NODE_V8_COVERAGE: "", ...extra };
}

export function agentDirEnv(executable: string, agentDir: string): Record<string, string> {
  const env: Record<string, string> = { PI_CODING_AGENT_DIR: agentDir };
  const base = (executable.split(/[\\/]/).pop() ?? "").replace(/\.(exe|cmd|bat|js|mjs)$/i, "");
  const derived = base.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (derived !== "" && derived !== "PI" && /^[A-Z]/.test(derived)) env[`${derived}_CODING_AGENT_DIR`] = agentDir;
  return env;
}

export class PiRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    string,
    {
      type: string;
      timeoutMs: number;
      resolve: (data: unknown) => void;
      reject: (error: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  /** Serializes stdin writes so a `false` from `write` is honoured before the next record. */
  private writeChain: Promise<void> = Promise.resolve();
  private stderrTail = "";
  private failed: string | undefined;
  /** The same failure with the child's own output appended — server logs only. */
  private failureDetail: string | undefined;
  private stopping = false;
  /** The single in-flight shutdown, so every caller awaits the same one. */
  private stopPromise: Promise<void> | undefined;
  /** Bound once so it can be removed again; see the `exit` registration below. */
  private readonly killOnExit = () => {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
  };

  constructor(private readonly options: PiRpcProcessOptions) {
    const argv = [
      ...options.args,
      // pi-outpost owns the session directory: the browser's session list and the
      // agent's own store must be the same place, whatever the environment says.
      ...(options.sessionDir ? ["--session-dir", options.sessionDir] : []),
      // Appended last and by us, so no configured argument can move the child off
      // the protocol this server speaks.
      "--mode",
      "rpc",
    ];
    this.child = spawn(options.executable, argv, {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      // The agent runs behind the interface, not in a console of its own: without
      // this, starting a session throws a window across the user's screen.
      windowsHide: true,
      env: childEnv({
        // A deliberate environment, not an inherited surprise: this is the one way
        // to point the child at pi-outpost's own agent directory.
        ...(options.agentDir ? agentDirEnv(options.executable, options.agentDir) : {}),
        ...options.env,
      }),
    });

    this.child.on("error", (error) => this.fail(`could not start "${options.executable}": ${error.message}`));
    this.child.on("exit", (code, signal) => {
      if (this.stopping) return;
      const how = signal ? `signal ${signal}` : `exit code ${code}`;
      // The cause goes to the browser; the child's own output stays on the server.
      // A crashing agent prints absolute paths, a Node stack trace and whatever a
      // provider put in an error body — the same class of detail that
      // `redactRpcCommand` and `credentialStatus` deliberately withhold from clients.
      this.fail(`the Pi RPC process ended (${how})`, this.stderrTail.trim() || undefined);
    });
    this.child.stdin.on("error", (error) => this.fail(`writing to the Pi RPC process failed: ${error.message}`));
    this.child.stdout.on("error", (error) => this.fail(`reading from the Pi RPC process failed: ${error.message}`));

    // Last-resort cleanup: an uncaught exception or a bare `process.exit()` skips
    // the SIGINT/SIGTERM path that calls `dispose()`, and would leave the child
    // running with the workspace still open to it. `exit` handlers must be
    // synchronous, so this is a bare kill rather than the graceful sequence.
    // (A SIGKILL of the server cannot be caught at all — the child is orphaned then,
    // and no amount of handler registration changes that.)
    process.on("exit", this.killOnExit);

    this.readJsonl(this.child.stdout, (line) => this.onLine(line));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_KEEP);
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Safe to show a browser: the cause, without the child's own output. */
  get failure(): string | undefined {
    return this.failed;
  }

  /** The same thing with the child's stderr — for the console, never the wire. */
  get failureWithOutput(): string | undefined {
    return this.failureDetail;
  }

  // --- framing -------------------------------------------------------------

  /**
   * LF-delimited records off a byte stream. Deliberately not `readline` — see the
   * framing note at the top of this file.
   */
  private readJsonl(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      // A record has to end eventually. Without a ceiling, a child that writes a long
      // run of bytes with no newline — a crash dump, a binary stream, a runaway log —
      // grows this string until the server dies of memory rather than of protocol,
      // which is the one failure mode nothing else here can report.
      if (buffer.length > MAX_RECORD_CHARS) {
        buffer = "";
        this.fail(`the Pi RPC process sent more than ${MAX_RECORD_CHARS} characters with no record delimiter`);
        return;
      }
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.length > 0) onLine(line);
      }
    });
    stream.on("end", () => {
      buffer += decoder.end();
      if (buffer.length === 0) return;
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      if (line.length > 0) onLine(line);
    });
  }

  private onLine(line: string): void {
    if (this.failed !== undefined) return;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      // A record we cannot parse means the stream is no longer the protocol. Guessing
      // a conversation event from it would put invented content in the transcript.
      this.fail(`the Pi RPC process sent a record that is not JSON: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      this.fail("the Pi RPC process sent a JSON value that is not an object");
      return;
    }
    const message = record as Record<string, unknown>;
    if (typeof message.type !== "string") {
      this.fail("the Pi RPC process sent a record with no type");
      return;
    }
    if (message.type === "response") {
      this.settle(message);
      return;
    }
    this.options.onRecord(message as RpcIncoming);
  }

  private settle(message: Record<string, unknown>): void {
    let id = typeof message.id === "string" ? message.id : undefined;
    if (id === undefined && typeof message.command === "string") {
      // Older Pi-derived runtimes (notably OMP) omit the caller's id from an
      // "unknown command" response. Preserve correlation only when it is still
      // unambiguous: exactly one outstanding command has that type. Two concurrent
      // commands of the same kind cannot be guessed apart and remain a hard fault.
      const matches = [...this.pending].filter(([, candidate]) => candidate.type === message.command);
      if (matches.length === 1) id = matches[0][0];
    }
    if (id === undefined) {
      this.fail(`the Pi RPC process sent an uncorrelated response for ${String(message.command ?? "an unknown command")}`);
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      this.fail(`the Pi RPC process sent a response for unknown id ${id}`);
      return;
    }
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    if (message.success === true) pending.resolve(message.data);
    else pending.reject(new Error(String(message.error ?? `the ${String(message.command)} command failed`)));
  }

  // --- sending -------------------------------------------------------------

  /**
   * Write one record. Chained rather than fired: `write` returning false means the
   * pipe is full, and ignoring that on a large prompt (six base64 images) is how a
   * command gets interleaved with the tail of the previous one.
   */
  private write(record: unknown): Promise<void> {
    const payload = `${JSON.stringify(record)}\n`;
    const next = this.writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (this.failed !== undefined) return reject(new Error(this.failed));
          // The callback fires when the chunk has actually been flushed, whether or
          // not `write` returned false — that *is* the backpressure handling.
          this.child.stdin.write(payload, (error) => (error ? reject(error) : resolve()));
        }),
    );
    // The chain must keep accepting work after a failed write: leaving a rejected
    // promise in it would turn one broken record into every later command rejecting,
    // plus an unhandled rejection nobody is waiting on.
    this.writeChain = next.catch(() => {});
    return next;
  }

  /** Send a correlated command and resolve with its `data`, or reject with its error. */
  async command(type: string, payload: Record<string, unknown> = {}, timeoutMs = this.options.commandTimeoutMs): Promise<unknown> {
    if (this.failed !== undefined) throw new Error(this.failed);
    const id = `pi-outpost-${++nextCommandId}`;
    const result = new Promise<unknown>((resolve, reject) => {
      const pending = { type, timeoutMs, resolve, reject };
      this.pending.set(id, pending);
      this.armTimeout(id, pending);
    });
    // `spawn` can fail before this first write settles. `fail()` then rejects the
    // correlated result while `write()` rejects independently; observe the result
    // immediately so that short window cannot become an unhandled rejection. The
    // caller still receives the write/startup error below, and normal command
    // failures are still awaited from `result`.
    void result.catch(() => {});
    try {
      await this.write({ ...payload, id, type });
    } catch (error) {
      // The command never reached the child, so nothing will ever answer it. Drop it
      // now rather than leaving an armed timer to "expire" on a command that was
      // never sent — a misleading message, and an entry the map keeps until then.
      const pending = this.pending.get(id);
      if (pending?.timer) clearTimeout(pending.timer);
      this.pending.delete(id);
      throw error;
    }
    return await result;
  }

  /**
   * A Pi extension command deliberately leaves its `prompt` response pending while
   * it waits for browser input. Pause only that command class; every other command
   * remains bounded, and answering/cancelling the final dialog arms a fresh timeout.
   */
  suspendCommandTimeout(type: string): void {
    for (const pending of this.pending.values()) {
      if (pending.type !== type || pending.timer === undefined) continue;
      clearTimeout(pending.timer);
      pending.timer = undefined;
    }
  }

  resumeCommandTimeout(type: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.type === type && pending.timer === undefined) this.armTimeout(id, pending);
    }
  }

  private armTimeout(id: string, pending: (typeof this.pending extends Map<string, infer T> ? T : never)): void {
    pending.timer = setTimeout(() => {
      this.pending.delete(id);
      // A command with no answer means we no longer know what the child is doing.
      this.fail(`the Pi RPC process did not answer the ${pending.type} command within ${pending.timeoutMs} ms`);
      pending.reject(new Error(`the ${pending.type} command timed out`));
    }, pending.timeoutMs);
    // A pending command must never hold the process open by itself.
    pending.timer.unref?.();
  }

  /** Send a record that has no response (an extension UI answer). */
  async notify(record: Record<string, unknown>): Promise<void> {
    await this.write(record);
  }

  // --- failure and shutdown ------------------------------------------------

  /**
   * Fail closed, once. Every pending command is rejected, and no restart or replay
   * is attempted: the prompt or tool call in flight may already have had effects.
   *
   * And the child is terminated. "Fail closed" has to mean the thing with the
   * effects, not merely the protocol: a `prompt` that times out mid-`bash` leaves a
   * server answering 503 and refusing every browser command while pi carries on
   * running tools against the workspace and appending to the live session file,
   * unsupervised, until someone stops the server. The reason we never restart or
   * replay — in-flight effects are unsafe — is the same reason we must not leave
   * them running.
   */
  private fail(message: string, detail?: string): void {
    if (this.failed !== undefined) return;
    this.failed = message;
    this.failureDetail = detail === undefined ? message : `${message}: ${detail}`;
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.options.onFailure(message, this.failureDetail);
    // After the listeners, so the failure is reported with the message that caused
    // it rather than with the exit this kill is about to produce.
    void this.stop().catch(() => {});
  }

  /**
   * Ask the child to stop, then make sure it did.
   *
   * The kill targets `child.pid` and nothing else: a negative pid would signal the
   * whole process group, which on a server started from a shell is the operator's
   * own session.
   */
  stop(): Promise<void> {
    // One shutdown, awaited by everyone who asks for it. `fail()` starts a stop
    // without waiting, so a `dispose()` that arrived afterwards used to see
    // `stopping` and return at once — promising the child was gone while it was
    // still dying. On Windows that promise is load-bearing: a live process locks
    // its working directory, so the caller's cleanup failed with EBUSY.
    return (this.stopPromise ??= this.runStop());
  }

  private async runStop(): Promise<void> {
    this.stopping = true;
    process.off("exit", this.killOnExit);
    // Nothing will answer a command once the child is going away, and `stopping`
    // suppresses the exit-driven failure that would otherwise reject them. Settle
    // them here, and make the process unusable, so a caller in flight during
    // shutdown gets an error instead of a promise that never resolves.
    const shuttingDown = "the Pi RPC process is shutting down";
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(shuttingDown));
    }
    this.pending.clear();
    this.failed ??= shuttingDown;
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const graced = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.options.shutdownGraceMs);
    });
    const outcome = await Promise.race([exited.then(() => "exited" as const), graced]);
    if (timer) clearTimeout(timer);
    if (outcome === "timeout") {
      this.child.kill("SIGKILL");
      await exited;
    }
  }
}
