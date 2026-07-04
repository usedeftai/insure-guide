import {
  DC_MEDICAID_SCHEMA,
  FORM_FIELD_MAP,
  getEmptyFields,
  getFilledFields,
  getRequiredFieldIds,
  mapProfileToFormData,
} from "./dc-medicaid-schema";
import { resolveUserId } from "./resolve-user";
import { createAdminClient } from "../supabase";

export interface FillFieldInput {
  userId?: string;
  phoneNumber?: string;
  formId: string;
  fieldId: string;
  value: string;
}

export interface FormSessionInput {
  userId?: string;
  phoneNumber?: string;
  formId: string;
}

export async function fillFormField(input: FillFieldInput) {
  if (!FORM_FIELD_MAP[input.fieldId]) {
    return { result: `unknown_field:${input.fieldId}` as const };
  }

  const targetUserId = await resolveUserId({
    userId: input.userId,
    phoneNumber: input.phoneNumber,
  });

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("form_sessions")
    .select("form_data")
    .eq("user_id", targetUserId)
    .eq("form_id", input.formId)
    .maybeSingle();

  const existing = (row?.form_data as Record<string, string> | null) ?? {};
  const updated = { ...existing, [input.fieldId]: input.value };

  const { error } = await supabase.from("form_sessions").upsert(
    {
      user_id: targetUserId,
      form_id: input.formId,
      form_data: updated,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,form_id" }
  );

  if (error) {
    throw new Error(error.message);
  }

  return { result: "ok" as const };
}

export async function getFormProgress(input: FormSessionInput) {
  const targetUserId = await resolveUserId({
    userId: input.userId,
    phoneNumber: input.phoneNumber,
  });

  const supabase = createAdminClient();
  const { data: sessionRow } = await supabase
    .from("form_sessions")
    .select("form_data")
    .eq("user_id", targetUserId)
    .eq("form_id", input.formId)
    .maybeSingle();

  let formData = (sessionRow?.form_data as Record<string, string> | null) ?? {};

  if (!sessionRow) {
    const { data: profileRow } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", targetUserId)
      .maybeSingle();

    if (profileRow) {
      formData = mapProfileToFormData(profileRow);

      if (Object.keys(formData).length > 0) {
        await supabase.from("form_sessions").upsert(
          {
            user_id: targetUserId,
            form_id: input.formId,
            form_data: formData,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,form_id" }
        );
      }
    }
  }

  const total = DC_MEDICAID_SCHEMA.flatMap((section) => section.fields).length;
  const filled = getFilledFields(DC_MEDICAID_SCHEMA, formData);
  const empty = getEmptyFields(DC_MEDICAID_SCHEMA, formData);

  return { filled, empty, total };
}

export async function completeForm(input: FormSessionInput) {
  const targetUserId = await resolveUserId({
    userId: input.userId,
    phoneNumber: input.phoneNumber,
  });

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("form_sessions")
    .select("form_data")
    .eq("user_id", targetUserId)
    .eq("form_id", input.formId)
    .maybeSingle();

  const formData = (row?.form_data as Record<string, string> | null) ?? {};
  const requiredIds = getRequiredFieldIds(DC_MEDICAID_SCHEMA);
  const filled = getFilledFields(DC_MEDICAID_SCHEMA, formData);
  const missingRequired = requiredIds.filter((id) => !filled.includes(id));

  if (missingRequired.length > 0) {
    return { result: `missing: ${missingRequired.join(", ")}` as const };
  }

  const { error } = await supabase.from("form_sessions").upsert(
    {
      user_id: targetUserId,
      form_id: input.formId,
      completed: true,
      updated_at: new Date().toISOString(),
      form_title: "DC Medicaid Combined Application",
      phone_number: input.phoneNumber ?? null,
    },
    { onConflict: "user_id,form_id" }
  );

  if (error) {
    throw new Error(error.message);
  }

  return { result: "completed" as const };
}
