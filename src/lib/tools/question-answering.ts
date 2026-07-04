import { tool } from "ai";
import { z } from "zod";
import { executeRagLookup } from "./rag-lookup";

export function createRagLookupTool() {
  return tool({
    description:
      "Search the InsureGuide knowledge base for verified healthcare program and policy information. " +
      "Use whenever the user asks about Medicaid, Medicare, DC Alliance, eligibility, or immigration-safe enrollment.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The user's natural-language question to search against the knowledge base."),
      match_count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum number of document chunks to return. Defaults to 5."),
      state: z
        .string()
        .optional()
        .describe("Optional US state filter, e.g. dc."),
    }),
    execute: executeRagLookup,
  });
}
