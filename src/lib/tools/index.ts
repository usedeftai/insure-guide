import { createFillFieldTool } from "./form-fill";
import { createFormSearchTool } from "./form-search";
import { createRagLookupTool } from "./question-answering";
import type { ToolRuntimeContext } from "./context";

export function createAgentTools(context: ToolRuntimeContext = {}) {
  return {
    rag_lookup: createRagLookupTool(),
    fillField: createFillFieldTool(context),
    searchForm: createFormSearchTool(),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
