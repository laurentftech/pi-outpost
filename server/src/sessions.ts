/**
 * Session naming and search.
 *
 * A session's display name is a `session_info` entry in its file — the SDK
 * persists it, `SessionManager.list` reads it back. We fill it in two ways: the
 * model titles a session after its first exchange, and the user can always
 * rename. Search runs here too: `SessionInfo` already carries the whole
 * transcript as text (`allMessagesText`), so matching costs no extra I/O — and
 * that text never leaves the server, only the matched excerpt does.
 */
import type { AgentSession, SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import { MIN_SESSION_QUERY_LENGTH, type SessionSummary } from "@pi-outpost/shared";
import { contentText } from "./convert.ts";

/**
 * Model and stream function of the live session (typed off AgentSession — pi-ai is
 * only a transitive dep, so its types aren't importable here).
 *
 * Titling calls the stream function directly: one request, our prompt, no agent
 * state touched. The SDK's own summarizers (`generateBranchSummary`,
 * `generateSummary`) are the wrong tool — they wrap the model's answer in a
 * branch/compaction preamble, which would land verbatim in the session menu.
 */
export type SdkModel = NonNullable<AgentSession["model"]>;
export type SdkStreamFn = AgentSession["agent"]["streamFn"];

/** `apiKey` is only what the registry resolves eagerly — a provider whose key lives in an env var has none. */
export interface RequestAuth {
  apiKey?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export const MAX_NAME_LENGTH = 80;
/** A search reads every session file — don't let a client scan the store with a novel. */
export const MAX_QUERY_LENGTH = 200;
const SNIPPET_LENGTH = 120;
const FIRST_MESSAGE_LENGTH = 120;
/** Enough of the exchange to name it; a long first prompt or reply is not more informative. */
const EXCHANGE_MESSAGE_LENGTH = 1500;
const TITLE_MAX_TOKENS = 200;

const TITLE_SYSTEM_PROMPT = `You name conversations. You are given the opening exchange of one; reply with a title for it.
A title is 3 to 6 words naming what the conversation is about, the way a person would label it in a list.
Reply with the title only: no quotes, no trailing punctuation, no preamble, no explanation.`;

/**
 * A name is one line of plain text. A model that answers with a paragraph (or a
 * quoted sentence) must not turn the session menu into a wall of text — and the
 * same string is rendered by pi's TUI, so control characters go too. Cut by code
 * point: slicing UTF-16 units would persist a lone surrogate into the session file.
 */
export function sanitizeName(raw: string): string {
  const line = raw.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  const clean = line
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return [...clean].slice(0, MAX_NAME_LENGTH).join("");
}

/**
 * Has this session ever carried a name? A `session_info` entry means the question
 * is settled — the model titled it, or the user named it, or the user *cleared* it
 * (an empty name reads back as `undefined`, which is exactly why the entry, not the
 * name, is the signal: otherwise the next turn would re-title what the user erased).
 */
export function hasBeenNamed(entries: SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === "session_info");
}

/** The first user message and its reply — all a title needs, and all we pay the model for. */
export function firstExchange(entries: SessionEntry[]): string | undefined {
  const message = (entry: SessionEntry): { role?: string; content?: unknown } | undefined =>
    entry.type === "message" ? (entry as { message?: { role?: string; content?: unknown } }).message : undefined;
  const firstUser = entries.findIndex((entry) => message(entry)?.role === "user");
  if (firstUser === -1) return undefined;
  const reply = entries.findIndex((entry, i) => i > firstUser && message(entry)?.role === "assistant");
  if (reply === -1) return undefined;
  return entries
    .slice(firstUser, reply + 1)
    .flatMap((entry) => {
      const content = message(entry);
      if (!content?.role) return [];
      const text = contentText(content.content as never).slice(0, EXCHANGE_MESSAGE_LENGTH);
      return text ? [`${content.role}: ${text}`] : [];
    })
    .join("\n\n");
}

/**
 * Title a session from its opening exchange. Best-effort by contract: any failure
 * (model error, abort, empty answer) yields undefined and the session simply stays
 * unnamed — the UI falls back to its first message.
 */
export async function generateSessionTitle(options: {
  exchange: string;
  model: SdkModel;
  auth: RequestAuth;
  streamFn: SdkStreamFn;
  signal: AbortSignal;
}): Promise<string | undefined> {
  const stream = await options.streamFn(
    options.model,
    {
      systemPrompt: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `<conversation>\n${options.exchange}\n</conversation>` }],
          timestamp: Date.now(),
        },
      ],
    },
    { ...options.auth, signal: options.signal, maxTokens: TITLE_MAX_TOKENS },
  );
  const response = await stream.result();
  if (response.stopReason === "error" || response.stopReason === "aborted") return undefined;
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return sanitizeName(text) || undefined;
}

export function toSummary(info: SessionInfo, snippet?: string): SessionSummary {
  return {
    path: info.path,
    id: info.id,
    ...(info.name ? { name: info.name } : {}),
    firstMessage: info.firstMessage.slice(0, FIRST_MESSAGE_LENGTH),
    modified: info.modified.toISOString(),
    messageCount: info.messageCount,
    ...(snippet ? { snippet } : {}),
  };
}

/** Excerpt of the transcript around the match, so a hit shows *why* it matched. */
function snippetAround(text: string, query: string): string | undefined {
  const at = text.toLowerCase().indexOf(query);
  if (at === -1) return undefined;
  // Never start past the match: a query longer than the window would otherwise
  // produce an excerpt that doesn't contain what the user searched for
  const start = Math.min(at, Math.max(0, at - Math.floor((SNIPPET_LENGTH - query.length) / 2)));
  const end = Math.min(text.length, start + Math.max(SNIPPET_LENGTH, query.length));
  const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`;
}

/**
 * Sessions matching `query` in their name, first message or transcript,
 * most recently modified first. Only the excerpt travels to the client.
 */
export function searchSessions(sessions: SessionInfo[], query: string, limit: number): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_SESSION_QUERY_LENGTH) return [];
  const hits: SessionSummary[] = [];
  for (const info of sessions) {
    const inName = info.name?.toLowerCase().includes(needle) ?? false;
    const inFirst = info.firstMessage.toLowerCase().includes(needle);
    const snippet = snippetAround(info.allMessagesText, needle);
    if (!inName && !inFirst && !snippet) continue;
    hits.push(toSummary(info, snippet));
  }
  return hits.sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, limit);
}
