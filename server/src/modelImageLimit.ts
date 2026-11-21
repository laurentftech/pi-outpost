/**
 * How many images the active model accepts, and keeping a request within it (#526).
 *
 * A model can declare it in `models.json` (or a `modelOverrides` entry):
 * `"inputLimits": { "images": { "maxPerRequest": 4, "maxPerMessage": 4 } }`. pi reads
 * those fields into the model but does not act on them ("Pi does not yet rewrite or
 * reject history based on them"), so a gateway that enforces one — vLLM's
 * `limit_mm_per_prompt` behind LiteLLM answers "At most 4 image(s) may be provided in one
 * prompt" — refused the turn outright as soon as a tool returned more pictures than that,
 * or a second call brought the conversation past it. The pictures were lost and the user
 * got the proxy's error.
 *
 * Two places act on it here: the tools that return pictures return at most this many,
 * and before each model call the request keeps its newest images within the limit,
 * replacing older ones with a line saying so.
 */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** The part of a model this reads. */
interface WithImageLimits {
  inputLimits?: { images?: { maxPerMessage?: number; maxPerRequest?: number } };
}

/** A usable limit: a whole number of at least one, or nothing. */
function limitOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** The most images one request to `model` may carry, when it declares a limit. */
export function imagesPerRequest(model: unknown): number | undefined {
  return limitOf((model as WithImageLimits | undefined)?.inputLimits?.images?.maxPerRequest);
}

/** The most images one message to `model` may carry: its own limit, or the request's. */
export function imagesPerMessage(model: unknown): number | undefined {
  const images = (model as WithImageLimits | undefined)?.inputLimits?.images;
  const perMessage = limitOf(images?.maxPerMessage);
  const perRequest = limitOf(images?.maxPerRequest);
  if (perMessage === undefined) return perRequest;
  return perRequest === undefined ? perMessage : Math.min(perMessage, perRequest);
}

/** What a tool returning pictures may return in one result: the model's limit, under the tool's own. */
export function picturesPerResult(model: unknown, toolCap: number): number {
  return Math.min(toolCap, imagesPerMessage(model) ?? toolCap);
}

type Block = { type: string; [key: string]: unknown };
type Message = { role?: string; content?: unknown; [key: string]: unknown };

const isImage = (block: unknown): boolean => (block as Block | undefined)?.type === "image";

/** The line that stands where an image was left out of a request. */
export function omittedImageNote(limit: number): string {
  return (
    `[image left out of this request: the model accepts at most ${limit} image${limit === 1 ? "" : "s"} per request, ` +
    `and newer ones took the room. Ask for it again if it is still needed.]`
  );
}

/**
 * The messages with at most `perRequest` images in all and `perMessage` in any one,
 * keeping the newest. Untouched (the same array) when nothing is over; otherwise new
 * message objects, so the session's history is never rewritten.
 *
 * Newest first because the picture just asked for is the one the next answer is about;
 * an older one can be asked for again, and the line left in its place says so.
 */
export function withinImageLimits(messages: readonly Message[], perRequest: number | undefined, perMessage: number | undefined): Message[] {
  const count = (message: Message) => (Array.isArray(message.content) ? message.content.filter(isImage).length : 0);
  const total = messages.reduce((sum, message) => sum + count(message), 0);
  const overMessage = perMessage !== undefined && messages.some((message) => count(message) > perMessage);
  if ((perRequest === undefined || total <= perRequest) && !overMessage) return messages as Message[];

  let room = perRequest ?? Number.POSITIVE_INFINITY;
  const out = [...messages];
  for (let at = out.length - 1; at >= 0; at--) {
    const message = out[at];
    if (!Array.isArray(message.content) || count(message) === 0) continue;
    let inMessage = perMessage ?? Number.POSITIVE_INFINITY;
    const limit = Math.min(perRequest ?? Number.POSITIVE_INFINITY, perMessage ?? Number.POSITIVE_INFINITY);
    let changed = false;
    // Within a message too, the last image kept is the last one shown.
    const kept = [...message.content].reverse().map((block: unknown) => {
      if (!isImage(block)) return block;
      if (room > 0 && inMessage > 0) {
        room--;
        inMessage--;
        return block;
      }
      changed = true;
      return { type: "text", text: omittedImageNote(limit) };
    });
    if (changed) out[at] = { ...message, content: kept.reverse() };
  }
  return out;
}

/**
 * The extension that applies the active model's limit to every request.
 *
 * On `context`, which pi fires before each model call with a copy it then sends: the
 * stored conversation keeps every image, so a model with a higher limit, chosen later,
 * sees them all again.
 */
export function createImageLimitExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("context", (event, ctx) => {
      const perRequest = imagesPerRequest(ctx.model);
      const perMessage = imagesPerMessage(ctx.model);
      if (perRequest === undefined && perMessage === undefined) return undefined;
      const messages = withinImageLimits(event.messages as unknown as Message[], perRequest, perMessage);
      return messages === (event.messages as unknown) ? undefined : { messages: messages as unknown as typeof event.messages };
    });
  };
}
