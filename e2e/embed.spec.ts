/**
 * The widget, mounted into a page that is not ours.
 *
 * Everything here is invisible to the unit suites by construction: jsdom has no
 * Shadow DOM worth the name, no cascade to isolate, and no separate origin. The
 * host page fights the widget on purpose — `* { color: red }`, `all: unset` on
 * every control, a `box-sizing` the reset disagrees with — because that is what
 * a design system does to anything it embeds.
 */
import { expect, test, type Page } from "@playwright/test";

/** The host page with the backend it should talk to. */
async function openHost(page: Page, options: { server?: string; theme?: string } = {}): Promise<void> {
  const url = new URL(process.env.PI_E2E_HOST_URL!);
  url.searchParams.set("server", options.server ?? process.env.PI_E2E_SERVER_URL!);
  if (options.theme !== undefined) url.searchParams.set("theme", options.theme);
  await page.goto(url.toString());
}

/** The backend whose session already holds a Mermaid diagram and a structured exchange. */
function withDiagrams(): { server: string } {
  return { server: process.env.PI_E2E_DIAGRAMS_URL! };
}

test.beforeEach(async ({ page }) => {
  // A named theme, so these tests do not read differently on a runner whose OS
  // prefers dark. The tests that are *about* where the theme comes from say so.
  await openHost(page, { theme: "light" });
});

test("mounts inside a shadow root and connects across origins", async ({ page }) => {
  // Playwright pierces shadow roots, so the widget's own controls are reachable
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();
  await expect(page.getByTitle("connected")).toBeVisible();

  const shape = await page.evaluate(() => {
    const shadow = document.querySelector("#widget")!.shadowRoot;
    return {
      open: shadow !== null,
      // The app is mounted under #root inside the shadow tree, not in the document
      rootInside: shadow?.querySelector("#root") !== null,
      rootInDocument: document.querySelector("#widget > #root") !== null,
    };
  });
  expect(shape).toEqual({ open: true, rootInside: true, rootInDocument: false });
});

test("carries its stylesheet as an adopted sheet, not a <style> element", async ({ page }) => {
  // Chrome drops <style> over ~512 KB inside a shadow root and Tailwind v4 is
  // ~1.5 MB, so the widget uses constructable sheets. Falling back silently
  // would leave it unstyled in exactly the browsers it targets.
  const sheets = await page.evaluate(() => {
    const shadow = document.querySelector("#widget")!.shadowRoot!;
    return {
      adopted: shadow.adoptedStyleSheets.length,
      rules: shadow.adoptedStyleSheets[0]?.cssRules.length ?? 0,
    };
  });
  expect(sheets.adopted).toBe(1);
  expect(sheets.rules).toBeGreaterThan(100);
});

test("the host page's styles do not reach into the widget", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await expect(composer).toBeVisible();

  const colour = await composer.evaluate((element) => getComputedStyle(element).color);
  // The host paints every element red; the widget's text must not be
  expect(colour).not.toBe("rgb(255, 0, 0)");

  // `all: unset` on the host's controls would flatten the widget's buttons too
  const button = page.getByTitle("Show files");
  const background = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).not.toBe("rgb(255, 0, 255)");
});

test("the widget's reset does not reach out into the host page", async ({ page }) => {
  // Tailwind's preflight sets margin: 0 on every element. Leaking out of the
  // shadow tree would silently restyle the page that embedded us.
  const host = await page.locator("#host-text").evaluate((element) => ({
    margin: getComputedStyle(element).marginTop,
    family: getComputedStyle(element).fontFamily,
  }));
  expect(host.margin).not.toBe("0px");
  expect(host.family).toContain("Comic Sans MS");
});

test("setTheme switches the widget without touching the host", async ({ page }) => {
  // The theme lands as data-theme on the container the host handed us — the
  // widget needs a cascade root, and it takes the one it was given rather than
  // document.documentElement, which would be the host page's.
  const readTheme = () =>
    page.evaluate(() => ({
      widget: (document.querySelector("#widget") as HTMLElement).dataset.theme ?? "",
      hostBackground: getComputedStyle(document.body).backgroundColor,
    }));

  const light = await readTheme();
  expect(light.widget).toBe("light");

  await page.evaluate(() => window.__embed.setTheme("dark"));
  await expect.poll(async () => (await readTheme()).widget).toBe("dark");

  // The host's own background is the host's business
  expect((await readTheme()).hostBackground).toBe(light.hostBackground);
});

/**
 * Borders, which Tailwind v4 draws through a registered custom property.
 *
 * `@property` registers on the document or not at all: inside a shadow tree, and
 * inside an adopted stylesheet in particular, the rule is parsed and ignored.
 * `.border` is `border-style: var(--tw-border-style); border-width: 1px`, so with
 * the property unregistered that `var()` resolves to nothing, `border-style` is
 * invalid at computed-value time, and every border in the widget silently
 * vanishes — cards, menus, composer, tables alike. Width and colour still arrive,
 * which is why it reads as a flat design rather than as a bug.
 */
test("the widget's borders are drawn, not silently dropped", async ({ page }) => {
  await expect(page.getByTitle("connected")).toBeVisible();

  const drawn = await page.evaluate(() => {
    const shadow = document.querySelector("#widget")!.shadowRoot!;
    const bordered = shadow.querySelector('[title="Settings"]')!;
    const style = getComputedStyle(bordered);
    return {
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      // The registration lives on the document, the one thing that must cross
      // the shadow boundary — and it is Tailwind's own namespace, not the host's.
      registered: document.getElementById("pi-outpost-custom-properties") !== null,
      registrationsAreTailwindsOwn: (document.getElementById("pi-outpost-custom-properties")?.textContent ?? "")
        .split("@property")
        .slice(1)
        .every((rule) => rule.trimStart().startsWith("--tw-")),
    };
  });

  expect(drawn.borderStyle).toBe("solid");
  expect(drawn.borderWidth).not.toBe("0px");
  expect(drawn.registered).toBe(true);
  expect(drawn.registrationsAreTailwindsOwn).toBe(true);
});

test("unmount empties the shadow root and leaves the container", async ({ page }) => {
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();

  const after = await page.evaluate(() => {
    window.__embed.unmount();
    const container = document.querySelector("#widget");
    return {
      containerStillThere: container !== null,
      shadowChildren: container?.shadowRoot?.querySelector("#root")?.childElementCount ?? -1,
    };
  });
  expect(after.containerStillThere).toBe(true);
  expect(after.shadowChildren).toBe(0);
});

// openlore: {"domain":"embed","requirement":"ReachTheBackendFromAnotherOrigin","scenario":"NoConsoleErrorFromMounting","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/embed/spec.md"}
test("mounting reports no console error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openHost(page, { theme: "light" });
  await expect(page.getByTitle("connected")).toBeVisible();

  expect(errors).toEqual([]);
});

test("the branding request survives the origin the widget was mounted from", async ({ page }) => {
  // This was a recorded gap until the server learned to answer allowed origins
  // with CORS headers. It matters more than a header: the HTTP branding request
  // exists to arrive before the agent runtime has finished starting, and a widget
  // that gets branding only from the WebSocket's "hello" visibly restyles itself
  // in front of the user seconds after it appears.
  const response = await page.request.get(`${process.env.PI_E2E_SERVER_URL}/branding`, {
    headers: { Origin: process.env.PI_E2E_HOST_URL! },
  });
  expect(response.headers()["access-control-allow-origin"]).toBe(process.env.PI_E2E_HOST_URL);
});

// openlore: {"domain":"embed","requirement":"ReachTheBackendFromAnotherOrigin","scenario":"BrandingArrivesBeforeTheSession","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/embed/spec.md"}
test.describe("BrandingArrivesBeforeTheSession", () => {
  test("paints HTTP branding before any session message, without painting the default first", async ({ context }) => {
    // The suite's shared page has already navigated in beforeEach. Use a fresh
    // page so interception and frame sampling precede this widget's first mount.
    const page = await context.newPage();
    // A mocked socket opens but never sends `hello`, so the only possible source
    // of branding is the cross-origin HTTP request.
    await page.routeWebSocket(/\/ws(?:\?|$)/, () => {});
    await page.addInitScript(() => {
      const tracked = window as Window & { __brandingFrames?: string[] };
      tracked.__brandingFrames = [];
      let previous = "";
      const sample = () => {
        const title = document.querySelector("#widget")?.shadowRoot?.querySelector("header span.text-lg")?.textContent?.trim();
        if (title && title !== previous) {
          tracked.__brandingFrames?.push(title);
          previous = title;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    await openHost(page, { theme: "light" });
    await expect(page.getByRole("banner").getByText("embed smoke")).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    const frames = await page.evaluate(
      () => (window as Window & { __brandingFrames?: string[] }).__brandingFrames ?? [],
    );
    expect(frames).toEqual(["embed smoke"]);
  });
});

test("a token-protected backend works across origins, preflight and all", async ({ page }) => {
  // The path no curl-shaped test reaches: `Authorization` is not safelisted, so
  // the browser sends a preflight of its own accord and refuses to send the real
  // request until it is answered. A server that handled only the simple case
  // would fail exactly the deployments that bothered to set a token.
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const url = new URL(process.env.PI_E2E_HOST_URL!);
  url.searchParams.set("server", process.env.PI_E2E_GUARDED_URL!);
  url.searchParams.set("token", process.env.PI_E2E_TOKEN!);
  await page.goto(url.toString());

  await expect(page.getByTitle("connected")).toBeVisible();
  // Its own branding, so this is that server answering and not the other one
  await expect(page.getByRole("banner").getByText("guarded smoke")).toBeVisible();
  // No token screen: the host supplied it
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a workspace file is readable from the host page's origin", async ({ page }) => {
  // /files/raw is what an inline image in a message resolves to, and it is the
  // route the "every route" decision is really about — the one place workspace
  // content leaves the server. Fetched from the page so the browser applies its
  // own rules, which is the whole question; a request from the test runner would
  // answer a different one.
  const status = await page.evaluate(
    async ([base, token]) => {
      const res = await fetch(`${base}/files/raw?path=readme.md&token=${encodeURIComponent(token!)}`);
      return { ok: res.ok, text: (await res.text()).slice(0, 20) };
    },
    [process.env.PI_E2E_GUARDED_URL!, process.env.PI_E2E_TOKEN!],
  );

  expect(status.ok).toBe(true);
  expect(status.text).toContain("guarded workspace");
});

/**
 * Diagrams inside the widget.
 *
 * The suite could only ever assert the empty state before this: no transcript,
 * so no diagram, so no overlay, so nothing ever opened one inside a Shadow DOM.
 * The enlarge overlay portalled itself to `document.body`, which is the wrong
 * side of the shadow boundary — the widget's stylesheet is adopted by the shadow
 * root, and a node outside it is styled by nothing at all. Measured in the
 * browser, that overlay came out `position: static`, `z-index: auto`,
 * transparent, and stacked below the widget with half of it off-screen.
 */
test.describe("diagrams in the widget", () => {
  /** Reads the overlay wherever it ended up, and says which tree that was. */
  const readOverlay = (page: Page, testId: string) =>
    page.evaluate((id) => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const inShadow = shadow.querySelector(`[data-testid="${id}"]`);
      const overlay = inShadow ?? document.querySelector(`[data-testid="${id}"]`);
      if (!overlay) return null;
      const style = getComputedStyle(overlay);
      const box = overlay.getBoundingClientRect();
      const widget = document.querySelector("#widget")!.getBoundingClientRect();
      return {
        tree: inShadow ? "shadow" : "document",
        position: style.position,
        zIndex: style.zIndex,
        transparent: style.backgroundColor === "rgba(0, 0, 0, 0)",
        // Covering the viewport is the whole job; below the widget is the bug.
        coversViewport: box.top <= widget.top && box.height >= innerHeight - 1,
      };
    }, testId);

  test("the structured exchange enlarges over the widget, not under it", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    // The card opens expanded, so the enlarge control is already there. Named by
    // its aria-label: the Mermaid diagram above it is captioned "⤢ enlarge" too.
    await page.getByRole("button", { name: /Show graph view at full size/ }).first().click();

    const overlay = await readOverlay(page, "structured-enlarged");
    expect(overlay).toEqual({
      // Portalled inside the shadow tree, where the widget's own styling reaches
      tree: "shadow",
      position: "fixed",
      zIndex: "100",
      transparent: false,
      coversViewport: true,
    });
  });

  test("a Mermaid diagram can be enlarged too", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    // Rendering is debounced, and the control only exists once there is an SVG
    const diagram = page.locator("#widget").locator("svg[id^='mermaid-']").first();
    await expect(diagram).toBeVisible();

    // Polled rather than read straight after `toBeVisible`: mermaid renders
    // asynchronously, so a diagram can be visible and not yet laid out — and
    // `boundingBox()` answers null for the moment in between. Read as a fact, that
    // is a null-dereference in CI and three green runs locally.
    await expect.poll(async () => (await diagram.boundingBox())?.width ?? 0).toBeGreaterThan(0);
    const inlineWidth = (await diagram.boundingBox())!.width;

    await page.getByRole("button", { name: /Show diagram at full size/ }).click();

    await expect(page.getByRole("dialog", { name: /diagram, full size/i })).toBeVisible();
    expect(await readOverlay(page, "mermaid-enlarged")).toEqual({
      tree: "shadow",
      position: "fixed",
      zIndex: "100",
      transparent: false,
      coversViewport: true,
    });

    // Bigger, which is the entire point. Mermaid writes width="100%" and no
    // intrinsic size, so an overlay that shrink-wraps its content renders the
    // diagram *smaller* than the chat column it was supposed to escape.
    const enlargedWidth = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const overlay = shadow.querySelector('[data-testid="mermaid-enlarged"]')!;
      return overlay.querySelector("svg")!.getBoundingClientRect().width;
    });
    expect(enlargedWidth).toBeGreaterThanOrEqual(inlineWidth);
  });

  test("a graph too wide for the column is drawn down it, and the reader can turn it back", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    // Named by content rather than by position: the transcript carries several
    // structured documents and the order they arrive in is not this test's business.
    const document = page.getByTestId("structured-document").filter({ hasText: "HTTP branding request" }).first();
    await expect(document).toBeVisible();
    const control = document.getByTestId("diagram-orientation");
    // Nine boxes in a chain: too wide to read across the reading column, so it
    // arrives turned without anyone asking — and the control offers the way back,
    // because a button names its action.
    await expect(control).toHaveText(/landscape/);

    const shape = async () => {
      const box = await document.locator("svg[aria-label^='Graph of']").first().boundingBox();
      return { width: box?.width ?? 0, height: box?.height ?? 0 };
    };
    await expect.poll(async () => (await shape()).width).toBeGreaterThan(0);
    const down = await shape();
    expect(down.height).toBeGreaterThan(down.width);

    await control.click();
    await expect(control).toHaveText(/portrait/);
    await expect.poll(async () => (await shape()).width).toBeGreaterThan(down.width);
    const across = await shape();
    expect(across.width).toBeGreaterThan(across.height);
  });

  test("a Mermaid diagram too wide to read is turned, says so, and keeps its source", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    const diagram = page.locator("#widget").locator("svg[id^='mermaid-']").first();
    await expect(diagram).toBeVisible();
    // Mermaid renders asynchronously, so a diagram can be visible and not yet laid
    // out; and this one is laid out twice, the second time to fit.
    await expect.poll(async () => (await diagram.boundingBox())?.width ?? 0).toBeGreaterThan(0);

    const block = page.locator("#widget").getByTestId("mermaid-turned");
    await expect(block).toHaveText(/the source asks for landscape/);
    const control = page.locator("#widget").getByTestId("mermaid-orientation");
    await expect(control).toHaveText(/landscape/);

    // The rewritten source went to mermaid and nowhere else.
    await page.locator("#widget").getByTitle("Show code").first().click();
    await expect(page.locator("#widget").locator("pre").first()).toContainText("graph LR");

    await page.locator("#widget").getByTitle("Show diagram").first().click();
    await control.click();
    await expect(control).toHaveText(/portrait/);
    // Turned back by hand, it is no longer drawn against its source, so the note goes.
    await expect(block).toHaveCount(0);
  });

  test("Escape closes an overlay opened inside the widget", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    await page.getByRole("button", { name: /Show graph view at full size/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  /**
   * A table is the one kind made of HTML text, and text inherits.
   *
   * Inherited properties are not blocked by a shadow boundary — they are
   * overridden by whatever the tree declares for itself, and the app declares
   * its own on its root element. An overlay portalled past that root is a
   * sibling of it, so it inherited from the host element instead, and this host
   * paints `* { color: red }`. Every cell of an enlarged table came out red.
   * Diagrams never showed it: SVG text carries an explicit `fill`.
   */
  test("an enlarged table is painted by the widget, not by the host page", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    await page.getByRole("button", { name: /Show table view at full size/ }).first().click();
    await expect(page.getByRole("dialog", { name: /table view, full size/i })).toBeVisible();

    const painted = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const overlay = shadow.querySelector('[data-testid="structured-enlarged"]')!;
      const appRoot = shadow.querySelector("#root")!;
      const cell = overlay.querySelector("td")!;
      return {
        insideTheAppRoot: appRoot.contains(overlay),
        siblingOfTheAppRoot: overlay.parentNode === shadow,
        overlayColour: getComputedStyle(overlay).color,
        cellColour: getComputedStyle(cell).color,
        hostColour: getComputedStyle(document.querySelector("#widget")!).color,
        cellText: cell.textContent,
      };
    });

    // The host really is painting red, or this test proves nothing
    expect(painted.hostColour).toBe("rgb(255, 0, 0)");
    expect(painted.insideTheAppRoot).toBe(true);
    expect(painted.siblingOfTheAppRoot).toBe(false);
    expect(painted.overlayColour).not.toBe("rgb(255, 0, 0)");
    expect(painted.cellColour).not.toBe("rgb(255, 0, 0)");
    expect(painted.cellText).toContain("REQ-001");
  });

  /**
   * Column sizing, which only a browser can answer: jsdom has no layout, so the
   * width a column actually ends up with is not a thing a unit test can see.
   */
  test("a reader can size a column, and the rules run both ways", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    const rules = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const cell = [...shadow.querySelectorAll("td")].find((element) => element.textContent?.includes("REQ-001"))!;
      const style = getComputedStyle(cell);
      return { left: style.borderLeftWidth, bottom: style.borderBottomWidth };
    });
    // A row rule alone leaves seven columns of prose running together
    expect(rules.left).not.toBe("0px");
    expect(rules.bottom).not.toBe("0px");

    // Grabbed deep in the table, not at the header: a column boundary is a line
    // the whole height of it, and that is where a reader reading row ten reaches.
    //
    // Through a locator rather than coordinates read in an earlier evaluate: the
    // transcript above this table is still growing, so a box measured one call
    // ago describes where the grip *was* — the press landed on the conversation
    // container and the drag asserted against a table nobody had touched.
    const table = page.locator("table").filter({ hasText: "REQ-001" }).first();
    const handle = table.locator("tbody tr").last().locator("td").nth(1).locator('[aria-hidden="true"]');
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    const before = Math.round((await table.locator("th").nth(1).boundingBox())!.width);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = Math.round((await table.locator("th").nth(1).boundingBox())!.width);

    // The whole drag, not the first few pixels of it: pointer capture on the
    // divider died on the first re-render and a 150-pixel gesture arrived as 30.
    expect(after - before).toBeGreaterThanOrEqual(140);
  });

  /**
   * A row's role, which only a browser can settle: the tints are Tailwind classes
   * resolved by the cascade, and jsdom resolves no cascade at all — a unit test
   * can see which class was asked for, never which colour arrived, and least of
   * all whether the host page's own stylesheet got there first.
   */
  test("a row's declared role is painted by the widget, and can be switched off", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    const painted = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const table = [...shadow.querySelectorAll("table")].find((element) =>
        element.textContent?.includes("REQ-005"),
      )!;
      const rows = [...table.querySelectorAll("tbody tr")] as HTMLElement[];
      return rows.map((row) => {
        const style = getComputedStyle(row);
        return {
          role: row.dataset.rowRole,
          background: style.backgroundColor,
          decoration: getComputedStyle(row.querySelector("td")!).textDecorationLine,
        };
      });
    });

    expect(painted.map((row) => row.role)).toEqual(["added", "changed", "removed", "context"]);
    // Four roles, four grounds: two that resolved to the same colour would leave a
    // reader unable to tell an addition from a deletion
    expect(new Set(painted.map((row) => row.background)).size).toBe(4);
    // and none of them transparent, which is what an unresolved class looks like
    expect(painted.every((row) => row.background !== "rgba(0, 0, 0, 0)")).toBe(true);
    expect(painted[2]!.decoration).toContain("line-through");

    // The key is the filter, as it is for a diagram — on the document this test is
    // about, named by its content rather than by its position among the others.
    const roled = page.getByTestId("structured-document").filter({ hasText: "REQ-005" });
    await roled.getByTestId("table-role-key").getByRole("button", { name: "removed" }).click();

    const afterHiding = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const table = [...shadow.querySelectorAll("table")].find((element) =>
        element.textContent?.includes("REQ-005"),
      )!;
      return [...table.querySelectorAll("tbody tr")].map((row) => (row as HTMLElement).dataset.rowRole);
    });
    expect(afterHiding).toEqual(["added", "changed", "context"]);
    await expect(page.getByTestId("structured-filtered").last()).toContainText("removed");
  });

  /**
   * The two file exports, taken as files.
   *
   * A unit test can check the text a function returns; only a browser can say
   * whether the widget actually hands a file over — the download is a blob URL, an
   * anchor click and a browser that has to accept both, none of which jsdom has.
   * The workbook is checked for being a workbook: a zip whose first entry names the
   * relationships every spreadsheet application looks for before it opens anything.
   */
  test("a table leaves the widget as a file, in both formats", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    // The document that reports roles, named by a requirement only it carries.
    const roled = page.getByTestId("structured-document").filter({ hasText: "REQ-005" });
    const csvDownload = page.waitForEvent("download");
    await roled.getByRole("button", { name: /download CSV/ }).click();
    const csv = await csvDownload;
    const csvText = await (await csv.createReadStream()).toArray();
    const text = Buffer.concat(csvText).toString("utf8");

    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    expect(text.split("\r\n")[0]).toBe("\ufeffID,Requirement,Status,change");
    // The role travels as a value, since the colour that states it cannot
    expect(text).toContain(",added");
    expect(text).toContain(",removed");
    // Prose with a comma in it stays one field
    expect(text).toContain('"The system shall log every actuation, with a monotonic timestamp.",draft,added');

    const xlsxDownload = page.waitForEvent("download");
    await roled.getByRole("button", { name: /download XLSX/ }).click();
    const xlsx = await xlsxDownload;
    const bytes = Buffer.concat(await (await xlsx.createReadStream()).toArray());

    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    // "PK": a zip, which is what a workbook is — carrying the three entries a
    // spreadsheet application looks for before it will open one without repairing it
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const entries = bytes.toString("latin1");
    expect(entries).toContain("[Content_Types].xml");
    expect(entries).toContain("xl/workbook.xml");
    expect(entries).toContain("xl/worksheets/sheet1.xml");
  });

  test("a narrowed table exports what it shows, and says so before it does", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    const roled = page.getByTestId("structured-document").filter({ hasText: "REQ-005" });
    await roled.getByTestId("table-role-key").getByRole("button", { name: "removed" }).click();
    await expect(roled.getByTestId("table-export-narrowed")).toContainText("1 rows fewer");

    const download = page.waitForEvent("download");
    await roled.getByRole("button", { name: /download CSV/ }).click();
    const text = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString("utf8");

    expect(text).toContain("REQ-005");
    expect(text).not.toContain("REQ-003");
  });

  test("a table reaches the widget at all, rows and cell kinds intact", async ({ page }) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    const table = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const tables = [...shadow.querySelectorAll("table")];
      const requirements = tables.find((element) => element.textContent?.includes("REQ-001"));
      if (!requirements) return null;
      const lastRow = [...requirements.querySelectorAll("tbody tr")].at(-1)!;
      return {
        columns: [...requirements.querySelectorAll("thead th")].map((cell) => cell.textContent),
        rows: requirements.querySelectorAll("tbody tr").length,
        // string, number, boolean and null all reach a cell; none may be dropped
        lastRow: [...lastRow.querySelectorAll("td")].map((cell) => cell.textContent),
      };
    });

    expect(table).not.toBeNull();
    expect(table!.columns).toEqual(["ID", "Requirement", "Status", "Safety"]);
    expect(table!.rows).toBe(4);
    expect(table!.lastRow[0]).toBe("REQ-004");
    expect(table!.lastRow[3]).toBe("\u2014"); // null reads as an em dash, not as "null"
  });
});

/**
 * Where the theme comes from when the host does not set it on every mount.
 *
 * Both cases below were unreachable while the host page named a theme in its
 * own source: `branding.defaultTheme` was never consulted, and a stored pick
 * could quietly outrank the host's option with nothing to catch it.
 */
test.describe("the theme a deployment configured", () => {
  test("a host that names no theme gets the server's branding.defaultTheme", async ({ page }) => {
    await openHost(page, withDiagrams());
    await expect(page.getByTitle("connected")).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => (document.querySelector("#widget") as HTMLElement).dataset.theme))
      .toBe("light");
  });

  test("the theme the host asked for at mount beats one this browser remembered", async ({ page }) => {
    // A visitor who once clicked ☾ on this origin. Before, that single click
    // outranked `mount(el, { theme: "light" })` for good: the host could not
    // give its widget the theme its own page was designed around.
    await openHost(page, withDiagrams());
    await page.evaluate(() => localStorage.setItem("pi-outpost:theme", "dark"));

    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => (document.querySelector("#widget") as HTMLElement).dataset.theme))
      .toBe("light");
    // Still remembered, so the reader's own pick survives a host that says nothing
    expect(await page.evaluate(() => localStorage.getItem("pi-outpost:theme"))).toBe("dark");
  });

  test("a stored pick still wins over branding when the host names nothing", async ({ page }) => {
    await openHost(page, withDiagrams());
    await page.evaluate(() => localStorage.setItem("pi-outpost:theme", "dark"));

    await openHost(page, withDiagrams());
    await expect(page.getByTitle("connected")).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => (document.querySelector("#widget") as HTMLElement).dataset.theme))
      .toBe("dark");
  });
});

/**
 * Containers, in the widget rather than in jsdom.
 *
 * The unit suites can assert the geometry; only the browser can say that the
 * boxes are actually drawn behind a real layout, at a real size, inside the
 * shadow root — and that a container's header spans the columns it should after
 * the view has reordered them.
 */
test.describe("containers in a structured exchange", () => {
  const openTranscript = async (page: Page) => {
    await openHost(page, { ...withDiagrams(), theme: "light" });
    await expect(page.getByTitle("connected")).toBeVisible();
  };

  test("draws every declared container, including the one nothing joins", async ({ page }) => {
    await openTranscript(page);

    const drawn = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      return [...shadow.querySelectorAll("[data-container]")].map((g) => g.getAttribute("data-container"));
    });

    // Graph: three, one of them empty. Sequence: two, after reordering.
    expect(drawn).toEqual(["electrical", "control", "hydraulic", "electrical", "control"]);
    await expect(page.getByText("Hydraulic system").first()).toBeVisible();
  });

  test("lays a graph's members inside their own enclosure", async ({ page }) => {
    await openTranscript(page);

    const placement = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const svg = [...shadow.querySelectorAll('svg[aria-label^="Graph"]')].find(
        (candidate) => candidate.querySelector("[data-container]") !== null,
      )!;
      const boxOf = (selector: string) => {
        const rect = svg.querySelector(selector)!.querySelector("rect")!;
        const read = (name: string) => Number(rect.getAttribute(name));
        return { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
      };
      const within = (inner: ReturnType<typeof boxOf>, outer: ReturnType<typeof boxOf>) =>
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height;
      const electrical = boxOf('[data-container="electrical"]');
      return {
        battery: within(boxOf('[data-element-id="battery"]'), electrical),
        alternator: within(boxOf('[data-element-id="alternator"]'), electrical),
        driverIsOutside: !within(boxOf('[data-element-id="driver"]'), electrical),
      };
    });

    expect(placement).toEqual({ battery: true, alternator: true, driverIsOutside: true });
  });

  test("orders sequence columns so each container gets one header", async ({ page }) => {
    await openTranscript(page);

    const sequence = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const svg = shadow.querySelector('svg[aria-label^="Sequence"]')!;
      const columns = [...svg.querySelectorAll("[data-element-id]")]
        .map((g) => ({ id: g.getAttribute("data-element-id"), x: Number(g.querySelector("rect")!.getAttribute("x")) }))
        .sort((a, b) => a.x - b.x)
        .map((column) => column.id);
      const headers = [...svg.querySelectorAll("[data-container]")].map((g) => {
        const rect = g.querySelector("rect")!;
        return {
          id: g.getAttribute("data-container"),
          x: Number(rect.getAttribute("x")),
          right: Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")),
        };
      });
      return { columns, headers };
    });

    // Declared battery(E), ecu(C), alternator(E), dash(C) — drawn regrouped
    expect(sequence.columns).toEqual(["battery", "alternator", "ecu", "dash"]);
    expect(sequence.headers.map((header) => header.id)).toEqual(["electrical", "control"]);
    // The electrical header sits entirely left of the control one: they span
    // adjacent, non-overlapping runs of columns.
    expect(sequence.headers[0]!.right).toBeLessThanOrEqual(sequence.headers[1]!.x);
  });

  test("a diagram with containers still enlarges into the shadow root", async ({ page }) => {
    await openTranscript(page);

    await page
      .locator("#widget")
      .getByRole("button", { name: /Show graph view at full size/ })
      .nth(1)
      .click();

    const overlay = await page.evaluate(() => {
      const shadow = document.querySelector("#widget")!.shadowRoot!;
      const dialog = shadow.querySelector('[data-testid="structured-enlarged"]');
      if (!dialog) return null;
      return {
        position: getComputedStyle(dialog).position,
        containers: dialog.querySelectorAll("[data-container]").length,
      };
    });

    expect(overlay).toEqual({ position: "fixed", containers: 3 });
  });
});

/**
 * Autocomplete, driven the way a reader drives it.
 *
 * The composer's menus are dismissed by a pointer press outside them, and inside
 * a shadow root a `document`-level listener is handed the widget's host element
 * instead of whatever was really pressed — so "outside" used to mean everywhere,
 * and the press that chose a suggestion closed the list instead of taking it.
 */
test.describe("composer autocomplete inside the widget", () => {
  test("Tab takes the highlighted file into the message", async ({ page }) => {
    const box = page.getByRole("textbox", { name: /message pi/i });
    await box.click();
    await box.pressSequentially("look at @read");
    await expect(page.getByRole("button", { name: "readme.md" })).toBeVisible();

    await box.press("Tab");
    await expect(box).toHaveValue("look at @readme.md ");
    await expect(page.getByRole("button", { name: "readme.md" })).toHaveCount(0);
  });

  test("clicking a suggestion takes it too", async ({ page }) => {
    const box = page.getByRole("textbox", { name: /message pi/i });
    await box.click();
    await box.pressSequentially("look at @read");
    await page.getByRole("button", { name: "readme.md" }).click();
    await expect(box).toHaveValue("look at @readme.md ");
  });

  test("Tab takes the highlighted command into the message", async ({ page }) => {
    const box = page.getByRole("textbox", { name: /message pi/i });
    await box.click();
    await box.pressSequentially("/gre");
    await expect(page.getByRole("button", { name: /\/greet/ })).toBeVisible();

    await box.press("Tab");
    await expect(box).toHaveValue("/greet ");
  });

  test("clicking back into the message leaves the list open", async ({ page }) => {
    const box = page.getByRole("textbox", { name: /message pi/i });
    await box.click();
    await box.pressSequentially("look at @read");
    await expect(page.getByRole("button", { name: "readme.md" })).toBeVisible();

    // Retargeting made this press read as "outside", so putting the caret back
    // where you were typing dismissed the very list you were typing towards.
    await box.click();
    await expect(page.getByRole("button", { name: "readme.md" })).toBeVisible();
  });

  test("the caret stays in the message after a pick", async ({ page }) => {
    const box = page.getByRole("textbox", { name: /message pi/i });
    await box.click();
    await box.pressSequentially("@read");
    await expect(page.getByRole("button", { name: "readme.md" })).toBeVisible();
    await box.press("Tab");
    await box.pressSequentially("please");
    await expect(box).toHaveValue("@readme.md please");
  });
});

// ---------------------------------------------------------------------------
// Installability belongs to the standalone interface, never to a host page.
//
// The widget mounts into someone else's document. Which app that document is,
// and whether it can be installed, is that application's decision — and a
// manifest the widget added would answer it for them.
// ---------------------------------------------------------------------------
test("the widget makes no installability claim on the host page", async ({ page }) => {
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();

  const claims = await page.evaluate(() => ({
    manifestLinks: document.querySelectorAll('link[rel="manifest"]').length,
    themeColorMetas: document.querySelectorAll('meta[name="theme-color"]').length,
    title: document.title,
    iconLinks: document.querySelectorAll('link[rel~="icon"]').length,
    insideShadow: (document.querySelector("#widget")!.shadowRoot!.querySelectorAll('link[rel="manifest"]')).length,
  }));

  // The host page here declares no manifest of its own, so any of these being
  // non-zero would mean the widget had made the page into pi-outpost.
  expect(claims).toEqual({ manifestLinks: 0, themeColorMetas: 0, title: "embed host page", iconLinks: 0, insideShadow: 0 });
});

test("a host that already owns install metadata keeps exactly what it declared", async ({ page }) => {
  const url = new URL(process.env.PI_E2E_HOST_URL!);
  url.searchParams.set("server", process.env.PI_E2E_SERVER_URL!);
  url.searchParams.set("theme", "light");
  url.searchParams.set("hostMeta", "1");
  await page.goto(url.toString());
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();

  const host = await page.evaluate(() => ({
    title: document.title,
    manifests: [...document.querySelectorAll('link[rel="manifest"]')].map((l) => l.getAttribute("href")),
    themeColors: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")),
    icons: [...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.getAttribute("href")),
  }));

  // Not "no manifest" but "the host's own, untouched": the failure this catches
  // is a widget that replaces or removes what it found, which a page with no
  // metadata of its own cannot show.
  expect(host).toEqual({
    title: "host app",
    manifests: ["/host-app.webmanifest"],
    themeColors: ["#00aa55"],
    icons: ["/host-app-icon.png"],
  });
});

// ---------------------------------------------------------------------------
// The embed workspace-control policy, one server per mode.
//
// The policy is loaded server configuration, so there is no way to see what a
// deployment presents without running a server configured that way — which is
// exactly what the unit suites cannot do.
// ---------------------------------------------------------------------------
test.describe("embed workspace controls", () => {
  const projectButton = /^Project:/;
  const rootButton = /^Sandbox root/;

  test("settings mode offers no header control, and still reaches the root through Settings", async ({ page }) => {
    await openHost(page, { theme: "light" });
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();

    await expect(page.getByTitle(projectButton)).toHaveCount(0);
    await expect(page.getByRole("button", { name: rootButton })).toHaveCount(0);

    // The compatibility the default promises: the sandbox is still editable, in
    // the one place it has always been.
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "Browse for sandbox root" })).toBeVisible();
  });

  test("root mode replaces the one sandbox root without opening a project", async ({ page }) => {
    await openHost(page, { server: process.env.PI_E2E_EMBED_ROOT_URL!, theme: "light" });
    const control = page.getByRole("button", { name: rootButton });
    await expect(control).toBeVisible();
    const workspace = process.env.PI_E2E_EMBED_ROOT_WORKSPACE!;
    await expect(control).toHaveAttribute("aria-label", `Sandbox root: ${workspace}`);

    await control.click();
    await page.getByRole("button", { name: "inner/" }).click();
    await expect(page.getByTestId("picker-path")).toHaveValue(`${workspace}/inner`);
    await page.getByRole("button", { name: "Use this directory" }).click();

    // The root moved and the picker closed on the server's answer, not on the
    // click — and no second project appeared beside it.
    await expect(page.getByRole("button", { name: rootButton })).toHaveAttribute(
      "aria-label",
      `Sandbox root: ${workspace}/inner`,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("server-path-picker")).toHaveCount(0);
    await expect(page.getByTitle(projectButton)).toHaveCount(0);
  });

  test("projects mode opens the selector and switches between open projects", async ({ page }) => {
    await openHost(page, { server: process.env.PI_E2E_EMBED_PROJECTS_URL!, theme: "light" });
    const selector = page.getByTitle(projectButton);
    await expect(selector).toBeVisible();
    await expect(page.getByRole("button", { name: rootButton })).toHaveCount(0);

    await selector.click();
    const second = process.env.PI_E2E_EMBED_PROJECTS_SECOND!;
    await page.getByRole("menuitem").filter({ hasText: second }).click();

    await expect(page.getByTitle(projectButton)).toHaveAttribute(
      "title",
      new RegExp(`^Project: ${second.split("/").at(-1)!}`),
      { timeout: 20_000 },
    );
  });

  test("a workspace lock still suppresses the controls projects mode would offer", async ({ page }) => {
    await openHost(page, { server: process.env.PI_E2E_EMBED_LOCKED_URL!, theme: "light" });
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();

    // The policy chooses among authorized controls; the lock decides what is
    // authorized, and a presentation setting may never argue with it.
    await expect(page.getByTitle(projectButton)).toHaveCount(0);
    await expect(page.getByRole("button", { name: rootButton })).toHaveCount(0);
  });
});
