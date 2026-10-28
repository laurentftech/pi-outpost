/**
 * The on-demand tools are registered deferred, and the agent finds them with Pi's own
 * `tool_search`. These run the real search — its BM25 ranker over the real definitions,
 * name, description and schema — because a description that stops saying "Excel" is a
 * tool the agent can no longer find, and nothing else would notice.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createToolSearchExtension } from "@earendil-works/pi-coding-agent";
import { DEFERRED_TOOLS, deferOnDemandTools, DOCUMENT_TOOLS, TOOL_SEARCH_TOOL } from "../src/documentTools.ts";
import { createPiOutpostTools } from "../src/piOutpostTools.ts";
import { PROJECT_MODEL_TOOL } from "../src/projectModelTool.ts";

type Registered = { name: string; description: string; parameters: unknown; exposure?: string };
type SearchTool = { execute: (id: string, input: { query: string; limit?: number }) => Promise<{ details: { loaded: string[] } }> };

/** Every tool the RPC child registers, deferred as it registers them, behind a real `tool_search`. */
async function search(): Promise<(query: string) => Promise<string[]>> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "deferred-tools-"));
  const maxBytes = { pdf: 1e6, docx: 1e6, xlsx: 1e6, pptx: 1e6, mail: 1e6, structuredExchange: 1e6 };
  const tools = deferOnDemandTools(await createPiOutpostTools({ cwd, maxBytes } as never)) as unknown as Registered[];
  return async (query) => {
    let active: string[] = [];
    let searchTool: SearchTool | undefined;
    const pi = {
      registerTool: (tool: SearchTool) => {
        searchTool = tool;
      },
      getActiveTools: () => active,
      setActiveTools: (names: string[]) => {
        active = names;
      },
      getAllTools: () => tools.map((tool) => ({ ...tool, exposure: tool.exposure ?? "direct" })),
    };
    createToolSearchExtension()(pi as never);
    // The default limit: what the agent gets when it does not set one.
    const result = await searchTool!.execute("search", { query });
    return result.details.loaded;
  };
}

describe("deferOnDemandTools", () => {
  test("defers exactly the on-demand tools, and leaves every other definition as it was", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "deferred-tools-"));
    const maxBytes = { pdf: 1e6, docx: 1e6, xlsx: 1e6, pptx: 1e6, mail: 1e6, structuredExchange: 1e6 };
    const tools = await createPiOutpostTools({ cwd, maxBytes } as never);
    const deferred = deferOnDemandTools(tools) as unknown as Registered[];
    for (const tool of deferred) {
      if (DEFERRED_TOOLS.includes(tool.name)) assert.equal(tool.exposure, "deferred", `${tool.name} is deferred`);
      else assert.equal(tool.exposure, undefined, `${tool.name} keeps its own exposure`);
    }
    assert.ok(DEFERRED_TOOLS.includes(PROJECT_MODEL_TOOL));
    for (const tool of DOCUMENT_TOOLS) assert.ok(DEFERRED_TOOLS.includes(tool));
    assert.equal(TOOL_SEARCH_TOOL, "tool_search");
  });
});

describe("A user's words find each kind", () => {
  for (const [query, expected] of [
    ["Excel", "xlsx_extract"],
    ["Word document", "docx_extract"],
    ["PowerPoint", "pptx_extract"],
    ["PDF", "pdf_extract"],
    ["Outlook email", "mail_extract"],
    ["read an Excel spreadsheet", "xlsx_extract"],
    ["project model", "present_project_model"],
  ] as const) {
    test(`"${query}" loads ${expected}`, async () => {
      const loaded = await (await search())(query);
      assert.ok(loaded.includes(expected), `"${query}" loaded ${JSON.stringify(loaded)}`);
    });
  }
});
