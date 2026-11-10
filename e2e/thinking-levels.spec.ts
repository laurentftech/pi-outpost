import { expect, test } from "@playwright/test";
import { connect, makeWorkspace, startServer } from "../server/test/harness.mjs";

// openlore: scenario=SnapshotCarriesTheModelsAcceptedThinkingLevels spec=api
// openlore: scenario=TheAcceptedLevelsFollowAModelChange spec=api
// openlore: scenario=RuntimeThinkingFloorIsPreserved spec=api
// openlore: scenario=AModelRequiringReasoningHasNoOffStop spec=components
test("a real model requiring reasoning clamps an off preference to low and never offers an unsupported off stop", async ({ page }) => {
  const root = await makeWorkspace({
    ".pi-agent/settings.json": JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-opus-5-5", defaultThinkingLevel: "off" }),
  });
  const server = await startServer(root, { noExtensions: true }, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello");
    expect(hello.model).toBe("anthropic/claude-opus-5-5");
    expect(hello.thinkingLevel).toBe("low");
    expect(hello.thinkingLevels).toEqual(["low", "medium", "high", "xhigh"]);
    await page.goto(server.base);
    const button = page.getByTitle("thinking level");
    await expect(button).toHaveText(/\blow\b/);
    await button.click();
    const slider = page.getByLabel("Thinking level");
    await expect(slider).toHaveAttribute("max", "3");
    for (const [pos, level] of [["1", "medium"], ["2", "high"], ["3", "xhigh"], ["0", "low"]] as const) {
      await slider.fill(pos);
      await expect(button).toHaveText(new RegExp(`\\b${level}\\b`));
    }
    const seen = client.received.length;
    client.send({ type: "set_thinking", level: "off" });
    expect(await client.waitFor(m => client.received.indexOf(m) >= seen && m.type === "thinking_changed"))
      .toMatchObject({ type: "thinking_changed", level: "low" });
    await expect(button).toHaveText(/\blow\b/);
    await page.reload();
    await expect(button).toHaveText(/\blow\b/);

    // Switching to a model with optional reasoning must restore its genuine off stop.
    client.send({ type: "set_model", provider: "anthropic", id: "claude-sonnet-4-5" });
    expect((await client.waitFor("model_changed")).thinkingLevels).toEqual(["off", "minimal", "low", "medium", "high"]);
    await button.click();
    await expect(slider).toHaveAttribute("max", "4");
    await slider.fill("0");
    await expect(button).toHaveText(/\boff\b/);
  } finally {
    client.close();
    await server.stop();
  }
});

test("the thinking slider offers only the levels the model accepts, in order, with no gap stop", async ({ page }) => {
  await page.goto(process.env.PI_E2E_THINKING_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("combobox", { name: "Model", exact: true }).selectOption("local/qwen3.8");

  // The scripted model accepts low, medium and xhigh — no `high`.
  const button = page.getByTitle("thinking level");
  await button.click();

  const slider = page.getByLabel("Thinking level");
  await expect(slider).toBeVisible();

  // Four stops: off, low, medium, xhigh — not the global six, and no `high`.
  await expect(slider).toHaveAttribute("max", "3");

  // Each stop maps to the level it should, and the last one — xhigh — is reached
  // without ever landing on `high`, and it sticks (no snap-back).
  for (const [pos, level] of [["0", "off"], ["1", "low"], ["2", "medium"], ["3", "xhigh"]] as const) {
    await slider.fill(pos);
    await expect(button).toHaveText(new RegExp(`\\b${level}\\b`));
  }
});

test("a model that accepts every level still shows all six stops", async ({ page }) => {
  // This contract needs an explicit six-level model, independent of SDK defaults.
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
  await page.goto(process.env.PI_E2E_THINKING_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("combobox", { name: "Model", exact: true }).selectOption("local/six-levels");
  const button = page.getByTitle("thinking level");
  await button.click();
  const slider = page.getByLabel("Thinking level");
  await expect(slider).toHaveAttribute("max", "5");
  for (const [position, level] of levels.entries()) {
    await slider.fill(String(position));
    await expect(button).toHaveText(new RegExp(`\\b${level}\\b`));
  }
});
