/**
 * `pi-outpost -p`: one turn of the agent, without a browser.
 *
 * The server this process just started is the one that runs it — its configuration, sandbox,
 * runner, grants, extensions and sessions — and this is its client, talking to it over the
 * same WebSocket the interface uses. So what a prompt does here is what it does in the
 * interface: nothing is reimplemented for the headless case.
 *
 * The answer is the only thing on stdout; everything else goes to stderr, so `-p` composes in
 * a shell. Nobody is there to click: a grant request is answered by `--grants`, and an
 * extension's dialog is declined, each said on stderr.
 */
import type { SandboxGrantDecision, ServerMessage } from "@pi-outpost/shared";
import type { PrintGrants } from "./cli.ts";

export interface PrintTurn {
  /** The server's WebSocket, `ws://127.0.0.1:<port>/ws`. */
  url: string;
  prompt: string;
  json: boolean;
  grants: PrintGrants;
  /** `provider/id`. */
  model?: string;
  /** stdout and stderr; parameters so the turn is tested without a process. */
  out(text: string): void;
  err(text: string): void;
}

const DECISION: Record<PrintGrants, SandboxGrantDecision> = { refuse: "refuse", once: "once", session: "session" };

/** Runs the turn and resolves with the exit status: 0 when it ended, 1 when it failed. */
export function runPrintTurn(turn: PrintTurn): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(turn.url);
    let phase: "hello" | "session" | "model" | "turn" | "done" = "hello";
    let failed = false;
    let started = false;
    let wroteText = false;
    /** Whether the message under way came as deltas: if not, its text is printed whole at its end. */
    let streamed = false;
    const send = (message: unknown) => socket.send(JSON.stringify(message));
    const finish = (code: number) => {
      if (phase === "done") return;
      phase = "done";
      if (wroteText && !turn.json) turn.out("\n");
      socket.close();
      resolve(code);
    };
    const prompt = () => {
      phase = "turn";
      send({ type: "prompt", text: turn.prompt });
    };
    // A turn of its own: a one-shot prompt must not append to the conversation open last.
    const begin = () => {
      phase = "session";
      send({ type: "new_session" });
    };
    const afterSession = () => {
      if (!turn.model) return prompt();
      phase = "model";
      const slash = turn.model.indexOf("/");
      send({ type: "set_model", provider: turn.model.slice(0, slash), id: turn.model.slice(slash + 1) });
    };

    socket.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (turn.json && phase !== "done") turn.out(`${JSON.stringify(message)}\n`);
      switch (message.type) {
        case "hello":
          if (phase === "hello") begin();
          return;
        case "session_replaced":
          if (phase === "session") afterSession();
          return;
        case "model_changed":
          if (phase === "model") prompt();
          return;
        case "error":
          turn.err(`[pi-outpost] ${message.message}\n`);
          // Fatal only as the answer to what was just asked: a model refused, or a prompt refused
          // before its turn started — then nothing would ever end it. Any other error is the
          // server's to report, and the turn's own failure is its message's.
          if (phase === "model" || (phase === "turn" && !started)) return finish(1);
          return;
        case "agent_start":
          started = true;
          return;
        case "assistant_start":
          streamed = false;
          return;
        case "block_delta":
          if (!turn.json && message.block === "text") {
            turn.out(message.delta);
            wroteText = true;
            streamed = true;
          }
          return;
        case "assistant_end":
          if (message.item.kind !== "assistant") return;
          // A provider that sends its text whole, without deltas: the message carries it.
          if (!turn.json && !streamed) {
            const text = message.item.blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
            if (text) {
              turn.out(text);
              wroteText = true;
            }
          }
          if (message.item.errorMessage) {
            turn.err(`[pi-outpost] the turn failed: ${message.item.errorMessage}\n`);
            failed = true;
          }
          return;
        case "tool_start":
          turn.err(`[tool] ${message.toolName}\n`);
          return;
        case "sandbox_grant_request": {
          const { request } = message;
          const targets = [...request.grant.hosts.map((host) => `host ${host}`), ...request.grant.directories.map((d) => `${d.access} ${d.path}`)].join(", ");
          turn.err(`[grant] ${targets} for ${JSON.stringify(request.command)}: ${turn.grants === "refuse" ? "refused" : `allowed (${turn.grants})`} by --grants ${turn.grants}\n`);
          send({ type: "sandbox_grant_response", id: request.id, decision: DECISION[turn.grants] });
          return;
        }
        case "extension_ui_request":
          if (message.method === "select" || message.method === "confirm" || message.method === "input" || message.method === "editor") {
            turn.err(`[extension] declined, nobody to answer: ${message.title}\n`);
            send({ type: "extension_ui_response", id: message.id, cancelled: true });
          } else if (message.method === "notify") {
            turn.err(`[extension] ${message.message}\n`);
          }
          return;
        case "agent_end":
          if (phase === "turn") finish(failed ? 1 : 0);
          return;
      }
    });
    socket.addEventListener("error", () => {
      turn.err(`[pi-outpost] the connection to the server failed\n`);
      finish(1);
    });
    socket.addEventListener("close", (event) => {
      if (phase !== "done") {
        const why = event.reason ? `: ${event.reason}` : "";
        turn.err(`[pi-outpost] the server closed the connection before the turn ended (${event.code}${why})\n`);
        finish(1);
      }
    });
  });
}

/** The prompt: as given, or stdin for `-`. */
export async function readPrompt(given: string, stdin: NodeJS.ReadableStream = process.stdin): Promise<string> {
  if (given !== "-") return given;
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8").trim();
}
