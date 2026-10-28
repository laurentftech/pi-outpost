/**
 * An extension tool that calls `xlsx_extract` on `book.xlsx` through `ctx.executeTool()` — the way other
 * tools and codemode scripts reach a tool the model has not been shown. It reports what
 * came back, so a test can tell a result from an unknown-tool error.
 */
import { Type } from "typebox";

export default function (pi) {
  pi.registerTool({
    name: "reach_xlsx",
    label: "reach_xlsx",
    description: "Test fixture: read a workbook through another tool.",
    // No path argument: a prompt naming `book.xlsx` would publish the extractor itself, and
    // the point is to reach it while it is not declared.
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const outcome = await ctx.executeTool("xlsx_extract", { path: "book.xlsx" });
      const text = (outcome.result?.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("");
      return { content: [{ type: "text", text: `isError=${outcome.isError} ${text}` }], details: {} };
    },
  });
}
