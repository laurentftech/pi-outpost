/**
 * For `agent-scenarios.mts`: spaces the model's requests at least SCENARIO_PACE_MS apart, so a
 * model limited to a few requests a minute (Mistral's codestral at 2) is not refused mid-task.
 * Waits before the request is sent; retries go through it too. Test tooling, never shipped.
 */
let last = 0;
let queue = Promise.resolve();

export default function (pi) {
  const pace = Number(process.env.SCENARIO_PACE_MS ?? 0);
  if (!(pace > 0)) return;
  pi.on("before_provider_request", () => {
    // One at a time: two requests waiting together would both leave at the same moment.
    const turn = queue.then(async () => {
      const wait = last + pace - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      last = Date.now();
    });
    queue = turn;
    return turn.then(() => undefined);
  });
}
