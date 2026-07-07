/**
 * Pi-interface server: bridges a pi AgentSession to WebSocket clients.
 *
 * SECURITY: binds to 127.0.0.1 only. The agent has bash/edit/write tools —
 * exposing this server on a network would give remote shell access.
 */
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { WebSocket } from "ws";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { assistantToItem, contentText, historyToItems, truncate } from "./convert.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

const PORT = Number(process.env.PORT ?? 3141);
const HOST = "127.0.0.1";
const AGENT_CWD = process.env.PI_CWD ?? process.cwd();

// --- Agent session ---------------------------------------------------------

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const { session, modelFallbackMessage } = await createAgentSession({
  cwd: AGENT_CWD,
  sessionManager: SessionManager.create(AGENT_CWD),
  authStorage,
  modelRegistry,
});

if (modelFallbackMessage) console.warn(`[pi] ${modelFallbackMessage}`);
console.log(`[pi] session ${session.sessionId}`);
console.log(`[pi] model ${modelName()} · cwd ${AGENT_CWD}`);

function modelName(): string {
  const model = session.model as { provider?: string; id?: string } | undefined;
  return model ? `${model.provider}/${model.id}` : "unknown";
}

// --- WebSocket broadcast ----------------------------------------------------

const clients = new Set<WebSocket>();

function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

// --- SDK events -> wire events ---------------------------------------------

session.subscribe((event) => {
  switch (event.type) {
    case "agent_start":
      broadcast({ type: "agent_start" });
      break;
    case "agent_end":
      broadcast({ type: "agent_end" });
      break;
    case "message_start":
      if (event.message.role === "assistant") {
        broadcast({ type: "assistant_start" });
      }
      break;
    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta") {
        broadcast({ type: "block_delta", block: "text", contentIndex: e.contentIndex, delta: e.delta });
      } else if (e.type === "thinking_delta") {
        broadcast({ type: "block_delta", block: "thinking", contentIndex: e.contentIndex, delta: e.delta });
      }
      break;
    }
    case "message_end":
      if (event.message.role === "assistant") {
        // Full sync of the finished message (covers retries/partial rebuilds)
        broadcast({ type: "assistant_end", item: assistantToItem(event.message as never) });
      }
      break;
    case "tool_execution_start":
      broadcast({
        type: "tool_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      });
      break;
    case "tool_execution_update": {
      const text = contentText(event.partialResult?.content);
      if (text) {
        broadcast({ type: "tool_update", toolCallId: event.toolCallId, text: truncate(text) });
      }
      break;
    }
    case "tool_execution_end":
      broadcast({
        type: "tool_end",
        toolCallId: event.toolCallId,
        isError: event.isError,
        text: truncate(contentText(event.result?.content)),
      });
      break;
    case "queue_update":
      broadcast({ type: "queue", steering: [...event.steering], followUp: [...event.followUp] });
      break;
    default:
      break;
  }
});

// --- Client message handling ------------------------------------------------

async function handlePrompt(text: string): Promise<void> {
  broadcast({ type: "user", text });
  if (session.isStreaming) {
    await session.prompt(text, { streamingBehavior: "steer" });
  } else {
    await session.prompt(text);
  }
}

function handleClientMessage(raw: string): void {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }
  switch (message.type) {
    case "prompt": {
      const text = message.text.trim();
      if (!text) return;
      handlePrompt(text).catch((error: unknown) => {
        broadcast({ type: "error", message: error instanceof Error ? error.message : String(error) });
      });
      break;
    }
    case "abort":
      session.abort().catch(() => {});
      break;
  }
}

// --- HTTP server -------------------------------------------------------------

const app = Fastify({ logger: false });
await app.register(websocket);

app.get("/ws", { websocket: true }, (socket) => {
  clients.add(socket);
  send(socket, {
    type: "hello",
    sessionId: session.sessionId,
    model: modelName(),
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    items: historyToItems(session.messages as never),
  });
  socket.on("message", (data: Buffer) => handleClientMessage(data.toString()));
  socket.on("close", () => clients.delete(socket));
});

app.get("/health", () => ({ ok: true, sessionId: session.sessionId }));

await app.listen({ port: PORT, host: HOST });
console.log(`[server] ws://${HOST}:${PORT}/ws`);

// --- Shutdown ----------------------------------------------------------------

async function shutdown(): Promise<void> {
  session.dispose();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
