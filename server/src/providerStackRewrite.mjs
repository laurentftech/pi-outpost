/**
 * The module-load hook that puts a provider's lost stack back on stderr.
 *
 * Every pi-ai provider's stream loop ends in the same catch:
 *
 *   catch (error) { output.errorMessage = formatProviderError(normalizeProviderError(error)); … }
 *
 * The message is kept and the `Error` is dropped, so by the time `assistant_end`
 * crosses the runtime seam there is no `.stack` left anywhere in the process — which is
 * the gap `turnFailureLog.ts` was written around, and why it records a census of the
 * *input* rather than a trace. `normalizeProviderError` returns a flat
 * `{ status, body, message, messageCarriesBody }`; it never carries the stack either.
 * No extension hook reaches this: `after_provider_response` fires before the stream is
 * consumed, and V8 offers no hook at an `Error`'s construction — `prepareStackTrace`
 * runs on the first read of `.stack`, which never happens.
 *
 * So the stack is read here, at module load, before the catch can drop it — and put
 * back where the rest of the pipeline already knows to look, as an assistant-message
 * diagnostic, which is what the upstream fix would be. The source is rewritten **in
 * memory**: nothing under `node_modules` is touched, `npm ci` has nothing to undo, and
 * a machine running without the flag runs the bytes it installed.
 *
 * Matched on the catch's own line rather than on a filename, so it arms every provider
 * that shares it — and arms none if a future SDK rewrites that line. That silence is
 * reported rather than left to be discovered: each arming is announced through the
 * port, and a run that announces nothing is a hook that found nothing.
 *
 * Hooks run off-thread, so `console.error` from here would not interleave with the
 * server's own output; the port is how this side talks back. The injected probe itself
 * runs in the module's own context on the main thread, where stderr is the real one.
 */

/** The assignment that drops the error, verbatim from every pi-ai provider. */
const NEEDLE = "output.errorMessage = formatProviderError(normalizeProviderError(error));";

/**
 * Only stack exhaustion. Deliberately the same test as `isStackExhaustion` in
 * `turnFailureLog.ts`: every other provider failure is already legible in the red
 * bubble, and dumping 200 frames for a rate limit would bury the rare event in the
 * common ones.
 *
 * Two destinations, because they answer different questions. stderr is immediate and
 * is what someone watching a terminal sees. The diagnostic is durable: it rides on the
 * assistant message the way `pi-messages` and `openai-codex-responses` already attach
 * theirs, so it reaches `censusOfTurn`, which records `diagnostics` verbatim and says
 * in its own comment that this is the only object in the pipeline that ever carries a
 * stack. The census and the trace then land in the same record instead of having to be
 * correlated by timestamp across two streams.
 *
 * The shape is `createAssistantMessageDiagnostic` + `appendAssistantMessageDiagnostic`
 * from pi-ai's `utils/diagnostics.js`, inlined rather than imported: this text is
 * injected into a module whose imports were resolved before the rewrite, so there is
 * nothing to add an import to. `details.source` says who attached it, so nobody reads
 * it as something the SDK itself produced.
 */
const PROBE = [
  "try {",
  " if (/maximum call stack size exceeded|call stack size exceeded|stack overflow/i.test(String(error && error.message))) {",
  "  const __piCode = error && error.code;",
  "  output.diagnostics = [...(output.diagnostics ?? []), {",
  '   type: "provider_transport_failure", timestamp: Date.now(),',
  "   error: { name: (error && error.name) || undefined,",
  "    message: (error && error.message) || (error && error.name),",
  "    stack: error && error.stack,",
  '    code: (typeof __piCode === "string" || typeof __piCode === "number") ? __piCode : undefined },',
  '   details: { source: "pi-outpost provider stack probe" } }];',
  '  console.error("[pi-outpost] provider stack:\\n" + ((error && error.stack) || String(error)));',
  " }",
  "} catch { }",
].join("");

/** Set by `initialize`, which `module.register` calls with the port it was given. */
let port;

export function initialize(data) {
  port = data;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (result.source === undefined || result.source === null) return result;
  const source = result.source.toString();
  if (!source.includes(NEEDLE)) return result;
  port?.postMessage(url);
  // Prepended, not replacing: the assignment still runs and the turn still fails the
  // way it did. This hook observes, it does not change what the agent sees.
  return { ...result, source: source.replaceAll(NEEDLE, `${PROBE} ${NEEDLE}`) };
}
