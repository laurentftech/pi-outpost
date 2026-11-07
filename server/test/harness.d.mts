/**
 * Types for harness.mjs, the integration harness the server's tests and the e2e
 * global setup share: a real server in its own process, a throwaway workspace, and a
 * WebSocket client. Written from what the harness returns and how the tests use it;
 * the JavaScript stays the source of behaviour.
 */
import type WebSocket from "ws";
import type { ServerMessage } from "@pi-outpost/shared";

/** A message as it comes off the socket: parsed JSON, read by each test for what it expects. */
export type HarnessMessage = { type: string; requestId?: string } & Record<string, any>;

export interface HarnessServer {
  port: number;
  /** `http://127.0.0.1:<port>` */
  base: string;
  root: string;
  /** The config file the server loaded. */
  configFile: string;
  wsUrl(token?: string): string;
  /** Everything the server printed so far. */
  log(): string;
  /** Stop the server's whole process group and remove its workspace. */
  stop(): Promise<void>;
}

export interface HarnessClient {
  ws: WebSocket;
  received: HarnessMessage[];
  closed(): { code: number } | null;
  send(message: unknown): void;
  /**
   * The first message of a type — typed as the protocol declares it — or the first a
   * predicate accepts; a rejection on timeout.
   */
  waitFor<T extends ServerMessage["type"]>(type: T, timeoutMs?: number): Promise<Extract<ServerMessage, { type: T }>>;
  waitFor(match: (message: HarnessMessage) => boolean, timeoutMs?: number): Promise<HarnessMessage>;
  /** The close code; never rejects on a close, only when none comes in time. */
  waitForClose(timeoutMs?: number): Promise<number>;
  open(): Promise<void>;
  close(): void;
}

export interface StartServerOptions {
  /** Patches the server's environment; a key set to undefined is removed. */
  env?: Record<string, string | undefined>;
  /** Run an already-bundled server instead of the TypeScript source. */
  entry?: string;
}

/** A port nothing else is on, from the OS. */
export function freePort(): Promise<number>;
/** A temporary workspace holding `files` (relative path → content). */
export function makeWorkspace(files?: Record<string, string | Buffer | Uint8Array>): Promise<string>;
/** Start a server confined to `root`; `config` is merged over the harness defaults. */
export function startServer(root: string, config?: Record<string, unknown>, options?: StartServerOptions): Promise<HarnessServer>;
export function connect(url: string): HarnessClient;
/** A minimal valid PNG. */
export const PNG_BYTES: Buffer;
