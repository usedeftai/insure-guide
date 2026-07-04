import { createFillFieldTool } from "./form-fill";
import { createRagLookupTool } from "./question-answering";
import type { ToolRuntimeContext } from "./context";

export function createAgentTools(context: ToolRuntimeContext = {}) {
  return {
    rag_lookup: createRagLookupTool(),
    fillField: createFillFieldTool(context),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
