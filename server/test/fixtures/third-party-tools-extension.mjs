/**
 * Two tools an extension of the user's own might register, neither declared up front:
 * one `deferred`, which a model may load with tool_search or call by a name it remembers,
 * and one `direct` but registered inactive, which is the extension's to switch on and no
 * one else's. Each says it ran, so a test can tell a result from a refusal.
 */
import { Type } from "typebox";

export default function (pi) {
  pi.registerTool({
    name: "third_party_deferred",
    label: "third_party_deferred",
    description: "Test fixture: a deferred tool registered by another extension.",
    parameters: Type.Object({}),
    exposure: "deferred",
    async execute() {
      return { content: [{ type: "text", text: "third_party_deferred ran" }], details: {} };
    },
  });
  pi.registerTool({
    name: "third_party_switched_off",
    label: "third_party_switched_off",
    description: "Test fixture: a direct tool another extension registers inactive.",
    parameters: Type.Object({}),
    defaultActive: false,
    async execute() {
      return { content: [{ type: "text", text: "third_party_switched_off ran" }], details: {} };
    },
  });
}
