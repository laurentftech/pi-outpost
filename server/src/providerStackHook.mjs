/**
 * Arm the provider stack probe, or do nothing at all.
 *
 * Passed with `--import`, because the whole module graph is loaded before any of
 * pi-outpost's own code evaluates: a `register()` call from inside `index.ts` would run
 * after the SDK was already parsed, and rewrite nothing. This is the only slot early
 * enough, which is why it is a module of its own rather than a few lines somewhere.
 *
 * Inert unless `PI_OUTPOST_PROVIDER_STACK` is set to something meaning yes. Off, this
 * file costs one environment read and returns; nothing is registered, no module is
 * rewritten, and the process runs exactly as it did before. That is the point of the
 * flag: a diagnostic nobody asked for should not be in the path of everybody's turns.
 *
 * On, it also raises `Error.stackTraceLimit`. V8's default of 10 frames is nothing on a
 * recursion — the repeated frame is the answer, and ten of it says only that something
 * repeated.
 */
import { register } from "node:module";
import { MessageChannel } from "node:worker_threads";

export const ENV_VAR = "PI_OUTPOST_PROVIDER_STACK";

/** How many frames are worth keeping. A recursion shows its cycle long before this. */
export const STACK_TRACE_LIMIT = 200;

/** Whether the flag's value means yes. Unset, empty, `0`, `false` and `no` mean no. */
export function isEnabled(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

/**
 * Registers the load hook and returns the port arming announcements arrive on.
 *
 * Exported so a test can drive it without a second process, and so the caller decides
 * what to do with the announcements — this module only prints them.
 */
export function armProviderStackProbe(env = process.env) {
  if (!isEnabled(env[ENV_VAR])) return undefined;
  Error.stackTraceLimit = STACK_TRACE_LIMIT;
  const { port1, port2 } = new MessageChannel();
  port1.on("message", (url) => {
    console.error(`[pi-outpost] provider stack probe armed on ${url}`);
  });
  // Nothing should wait on this port: an armed probe must not hold the event loop open.
  port1.unref();
  register("./providerStackRewrite.mjs", {
    parentURL: import.meta.url,
    data: port2,
    transferList: [port2],
  });
  console.error(
    `[pi-outpost] provider stack probe on (${ENV_VAR}). If no probe reports in by the first` +
      " model call, the SDK's catch has moved and there was nothing to read.",
  );
  return port1;
}

armProviderStackProbe();
