import { tool } from "ai";
import { z } from "zod";
import { createAdminClient } from "../supabase";

export function createFormSearchTool() {
  return tool({
    description:
      "Search Supabase for a form by name and return its metadata (id, fields, status) " +
      "so the agent can look up or confirm which form to work with.",
    inputSchema: z.object({
      form_name: z.string().describe("The name of the form to search for."),
    }),
    execute: async ({ form_name }) => {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("forms")
        .select("id, form_name, form_fields, annotation_status, last_updated_at")
        .ilike("form_name", `%${form_name}%`);

      if (error) throw error;

      if (!data || data.length === 0) {
        return { found: false, forms: [] };
      }

      return { found: true, forms: data };
    },
  });
}
