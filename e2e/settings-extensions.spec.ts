/**
 * Adding an extension from the interface, in a real browser against a real server.
 *
 * The component tests drive `SettingsMenu` in jsdom with the callbacks mocked, so they
 * prove the menu reports what the user asked for. They cannot see whether the server
 * then loads anything: that needs the socket, the persistence, the session rebuild and
 * the extension actually running. What is asserted here is the end of that chain — a
 * command the extension registers, appearing in the composer where the user would find
 * it — because a control that looks right and loads nothing is the failure this whole
 * change would otherwise ship.
 */
import { expect, test, type WebSocketRoute } from "@playwright/test";
import type { AgentResourceInventory, AgentResourceRepository } from "@pi-outpost/shared";

const EXTENSIONS_DIR = process.env.PI_E2E_EXTENSIONS_DIR!;

const settingsButton = "Settings";

const revision = (character: string) => character.repeat(40);

function repository(
  id: string,
  name: string,
  status: AgentResourceRepository["assessment"]["status"],
  options: { extensions?: boolean; reason?: string } = {},
): AgentResourceRepository {
  const assessment = status === "updateable"
    ? {
        repositoryId: id,
        status,
        branch: "main",
        upstream: "origin/main",
        localRevision: revision("1"),
        upstreamRevision: revision("2"),
        token: `assessment-${id}`,
      } as const
    : {
        repositoryId: id,
        status,
        reason: options.reason ?? `${name} cannot be updated`,
      } as const;
  return {
    id,
    name,
    path: `/fixtures/${id}`,
    resourceIds: [`${id}-resource`],
    containsExtensions: options.extensions ?? false,
    assessment,
  };
}

function syntheticInventory(): AgentResourceInventory {
  const repositories = [
    repository("repo-skill", "Shared skills", "updateable"),
    repository("repo-extension", "Executable tools", "updateable", { extensions: true }),
    repository("repo-dirty", "Locally edited", "dirty", { reason: "Uncommitted files are present." }),
    repository("repo-busy", "In use", "busy", { reason: "An update is already running." }),
    repository("repo-stale", "Stale assessment", "updateable"),
  ];
  return {
    repositories,
    resources: repositories.map((entry) => ({
      id: entry.resourceIds[0],
      kind: entry.containsExtensions ? "extension" as const : "skill" as const,
      name: `${entry.name} resource`,
      origin: "user" as const,
      path: `${entry.path}/${entry.containsExtensions ? "extensions" : "skills"}`,
    })),
    capabilities: { skills: "available", extensions: "available" },
  };
}

test("an extension directory added through the resource manager is loaded, then can be taken back", async ({ page }) => {
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();

  await page.getByRole("button", { name: settingsButton }).click();
  await page.getByRole("button", { name: "Manage agent resources" }).click();
  await expect(page.getByRole("dialog", { name: "Agent resources" })).toBeVisible();

  await page.getByRole("button", { name: "Add local folder…" }).click();
  await page.getByRole("button", { name: "Extension folder" }).click();
  // The warning is part of the act, not a caption: it is on screen before the path is.
  await expect(page.getByText(/Extensions execute code with the agent's privileges/)).toBeVisible();

  // Typed rather than walked: the picker browses the server's filesystem, and the
  // fixture sits in a temporary directory nobody wants to descend into by hand.
  await page.getByTestId("picker-path").fill(EXTENSIONS_DIR);
  await page.getByRole("button", { name: "Go" }).click();
  await page.getByRole("button", { name: "Use this directory" }).click();
  await expect(page.getByRole("textbox", { name: "Local resource folder" })).toHaveValue(EXTENSIONS_DIR);

  await page.getByText(/I trust every extension/).click();
  await page.getByRole("button", { name: "Add folder" }).click();
  await expect(page.getByText(EXTENSIONS_DIR, { exact: true })).toBeVisible();

  // The inventory now reports it, from the server rather than from the draft list:
  // the configured root is removable from the repository/local grouping.
  await expect(page.getByRole("button", { name: `Remove ${EXTENSIONS_DIR}` })).toBeVisible();
  await page.getByRole("button", { name: "Close agent resources" }).click();

  // The end of the chain: the extension ran and registered its command, so the
  // composer offers it. Nothing short of a real session rebuild produces this.
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await composer.click();
  await composer.fill("/e2e-added");
  await expect(page.getByText("Added through Settings")).toBeVisible();
  await composer.fill("");
  await page.keyboard.press("Escape");

  // And taking it back rebuilds a session without it.
  await page.getByRole("button", { name: settingsButton }).click();
  await page.getByRole("button", { name: "Manage agent resources" }).click();
  await page.getByRole("button", { name: `Remove ${EXTENSIONS_DIR}` }).click();
  await expect(page.getByRole("button", { name: `Remove ${EXTENSIONS_DIR}` })).toHaveCount(0);
});

test("a deployment that locks extension paths offers no way to change them", async ({ page }) => {
  await page.goto(process.env.PI_E2E_EXTENSIONS_LOCKED_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();

  await page.getByRole("button", { name: settingsButton }).click();
  await expect(page.getByTestId("extensions-locked")).toBeVisible();
  await page.getByRole("button", { name: "Manage agent resources" }).click();
  await page.getByRole("button", { name: "Add local folder…" }).click();
  await expect(page.getByRole("button", { name: "Extension folder" })).toBeDisabled();
  await expect(page.getByText("Extension paths are locked by this deployment.")).toBeVisible();
  // Still says what is loaded: the lock is about changing them, not about hiding them.
  await page.getByTestId("add-local-folder").getByRole("button", { name: "Cancel" }).last().click();
  await expect(page.getByText(EXTENSIONS_DIR, { exact: true })).toBeVisible();
});

test("repository states stay correlated through rapid actions and changing inventory", async ({ page }) => {
  const consoleErrors: string[] = [];
  const requests = { refresh: 0, update: 0 };
  let browserSocket: WebSocketRoute | null = null;
  let inventory = syntheticInventory();
  let holdSkillUpdate = false;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    browserSocket = socket;
    const server = socket.connectToServer();
    server.onMessage((message) => {
      socket.send(message);
      try {
        if (["hello", "workspace_switched"].includes(JSON.parse(String(message)).type)) {
          socket.send(JSON.stringify({ type: "agent_resource_inventory", inventory }));
        }
      } catch {
        // Binary and non-JSON traffic still belongs to the real server.
      }
    });
    socket.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.type === "refresh_agent_resource_repositories") {
        requests.refresh += 1;
        setTimeout(() => socket.send(JSON.stringify({
          type: "agent_resource_assessments",
          requestId: parsed.requestId,
          assessments: inventory.repositories.map((entry) => entry.assessment),
        })), 200);
        return;
      }
      if (parsed.type === "update_agent_resource_repository") {
        requests.update += 1;
        const result = {
          status: parsed.repositoryId === "repo-extension" ? "updated-reload-failed" : "updated",
          repositoryId: parsed.repositoryId,
          beforeRevision: revision("1"),
          afterRevision: revision("2"),
          submodulesUpdated: false,
          reloads: parsed.repositoryId === "repo-extension"
            ? [{ workspaceRoot: "/fixtures/workspace", status: "failed", message: "Fixture reload failed" }]
            : [{ workspaceRoot: "/fixtures/workspace", status: "reloaded" }],
        };
        setTimeout(() => {
          if (parsed.repositoryId === "repo-stale") {
            socket.send(JSON.stringify({ type: "agent_resource_error", requestId: parsed.requestId, message: "Assessment expired; check again." }));
          } else {
            socket.send(JSON.stringify({ type: "agent_resource_update_result", requestId: parsed.requestId, result, inventory }));
          }
        }, parsed.repositoryId === "repo-skill" ? (holdSkillUpdate ? 1_500 : 350) : 50);
        return;
      }
      server.send(message);
    });
  });

  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("button", { name: settingsButton }).click();
  await page.getByRole("button", { name: "Manage agent resources" }).click();
  const dialog = page.getByRole("dialog", { name: "Agent resources" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Shared skills/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Executable tools/ })).toBeVisible();

  // React disables this control as soon as the first request starts. Hammering it
  // must still produce one request and return to an enabled state after correlation.
  const refresh = dialog.getByRole("button", { name: "Refresh all" });
  await refresh.dblclick();
  await expect(refresh).toBeDisabled();
  await expect.poll(() => requests.refresh).toBe(1);
  await expect(refresh).toBeEnabled();

  // Finish an update while another repository is selected. Its result must stay
  // keyed to the repository that initiated it, not leak into the active detail pane.
  await dialog.getByRole("button", { name: /Shared skills/ }).click();
  await dialog.getByRole("button", { name: "Update repository" }).click();
  await dialog.getByRole("button", { name: /Locally edited/ }).click();
  await expect(dialog.getByText("Uncommitted files are present.")).toBeVisible();
  await expect(dialog.getByText(/external terminal/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Update repository" })).toBeDisabled();
  await expect.poll(() => requests.update).toBe(1);
  await expect(dialog.getByText("Repository updated and runtimes reloaded.")).toHaveCount(0);
  await dialog.getByRole("button", { name: /Shared skills/ }).click();
  await expect(dialog.getByText("Repository updated and runtimes reloaded.")).toBeVisible();

  await dialog.getByRole("button", { name: /Executable tools/ }).click();
  await dialog.getByRole("button", { name: "Update repository" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Update executable extensions?" });
  await expect(confirmation.getByText(`${revision("1").slice(0, 8)} to ${revision("2").slice(0, 8)}`, { exact: false })).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirm executable update" }).click();
  await expect(dialog.getByText("Repository updated on disk, but at least one runtime failed to reload.")).toBeVisible();

  await dialog.getByRole("button", { name: /In use/ }).click();
  await expect(dialog.getByText("Workspace busy", { exact: true }).last()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Update repository" })).toBeDisabled();

  await dialog.getByRole("button", { name: /Stale assessment/ }).click();
  await dialog.getByRole("button", { name: "Update repository" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Assessment expired; check again.");

  // The selected repository can disappear underneath an open manager. The UI
  // must fall back to a live group and remain usable during filter bursts.
  inventory = {
    ...inventory,
    repositories: inventory.repositories.filter((entry) => entry.id !== "repo-stale"),
    resources: inventory.resources.filter((entry) => entry.id !== "repo-stale-resource"),
  };
  browserSocket!.send(JSON.stringify({ type: "agent_resource_inventory", inventory }));
  await expect(dialog.getByText("Stale assessment", { exact: true })).toHaveCount(0);
  const search = dialog.getByRole("textbox", { name: "Search resources" });
  await search.fill("edited");
  await dialog.getByRole("button", { name: "Needs attention" }).dblclick();
  await search.fill("");
  await dialog.getByRole("button", { name: "Extensions" }).click();
  await dialog.getByRole("button", { name: "All", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /Shared skills/ })).toBeVisible();

  // A workspace snapshot clears its predecessor's pending operations. Delay and
  // double-click an update, switch projects underneath it, then let the old reply
  // arrive: it must neither overwrite the new snapshot nor produce a status there.
  await dialog.getByRole("button", { name: /Shared skills/ }).click();
  holdSkillUpdate = true;
  const updatesBeforeSwitch = requests.update;
  await dialog.getByRole("button", { name: "Update repository" }).dblclick();
  await expect.poll(() => requests.update).toBe(updatesBeforeSwitch + 1);
  await page.getByRole("button", { name: "Close agent resources" }).click();
  await page.getByTitle(/^Project:/).click();
  await page.getByRole("menuitem").filter({ hasText: process.env.PI_E2E_SECOND_PROJECT! }).click();
  await page.getByRole("button", { name: settingsButton }).click();
  await page.getByRole("button", { name: "Manage agent resources" }).click();
  await expect(dialog.getByRole("button", { name: /Shared skills/ })).toBeVisible();
  await page.waitForTimeout(1_600);
  await expect(dialog.getByText("Repository updated and runtimes reloaded.")).toHaveCount(0);
  await page.getByRole("button", { name: "Close agent resources" }).click();
  await page.getByTitle(/^Project:/).click();
  await page.getByRole("menuitem").filter({ hasText: process.env.PI_E2E_PRIMARY_PROJECT! }).click();
  expect(consoleErrors).toEqual([]);
});
