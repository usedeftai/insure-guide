import { tool } from "ai";
import { z } from "zod";
import { fillFormField } from "../forms/service";
import { FORM_FIELD_MAP } from "../forms/dc-medicaid-schema";
import { DEFAULT_FORM_ID, type ToolRuntimeContext } from "./context";

const formFieldIds = Object.keys(FORM_FIELD_MAP) as [string, ...string[]];

export function createFillFieldTool(context: ToolRuntimeContext = {}) {
  const defaultFormId = context.formId ?? DEFAULT_FORM_ID;

  return tool({
    description:
      "Write a single DC Medicaid form field value when the user verbally provides it. " +
      "Call once per field. Dates as YYYY-MM-DD, phone as (XXX) XXX-XXXX, yes/no radios as yes or no.",
    inputSchema: z.object({
      field_id: z.enum(formFieldIds).describe("The form field identifier to update."),
      value: z.string().describe("Normalized field value."),
      form_id: z
        .string()
        .default(defaultFormId)
        .describe('Form identifier. Always "dc-medicaid" for this app.'),
      user_id: z.string().optional().describe("User UUID when available."),
      phone_number: z
        .string()
        .optional()
        .describe("Caller phone number when user_id is unavailable."),
    }),
    execute: async ({ field_id, value, form_id, user_id, phone_number }) => {
      return fillFormField({
        fieldId: field_id,
        value,
        formId: form_id,
        userId: user_id ?? context.userId,
        phoneNumber: phone_number ?? context.phoneNumber,
      });
    },
  });
}
