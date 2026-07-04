import { createAdminClient } from "../supabase";
import {
  type AnnotatedField,
  validateFieldValue,
  isFieldValueFilled,
} from "./field-schema";
import { createComponentLogger } from "../logger";

const log = createComponentLogger("submissions");

export interface SubmissionIdentity {
  userId?: string;
  phoneNumber?: string;
}

export interface SubmissionProgress {
  filled: string[];
  empty: string[];
  required_missing: string[];
  total: number;
  status: string;
  field_values: Record<string, string>;
}

async function getFormFields(formId: string): Promise<AnnotatedField[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("forms")
    .select("form_fields, annotation_status")
    .eq("id", formId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Form not found");
  }

  if (data.annotation_status !== "ready") {
    throw new Error("Form template is not ready for submissions");
  }

  return (data.form_fields as AnnotatedField[]) ?? [];
}

async function findExistingSubmission(formId: string, identity: SubmissionIdentity) {
  const supabase = createAdminClient();
  let query = supabase.from("form_submissions").select("*").eq("form_id", formId);

  if (identity.userId) {
    query = query.eq("user_id", identity.userId);
  } else if (identity.phoneNumber) {
    query = query.eq("phone_number", identity.phoneNumber);
  } else {
    return null;
  }

  const { data } = await query.maybeSingle();
  return data;
}

export async function createSubmission(
  formId: string,
  identity: SubmissionIdentity
) {
  if (!identity.userId && !identity.phoneNumber) {
    throw new Error("user_id or phone_number is required");
  }

  const existing = await findExistingSubmission(formId, identity);
  if (existing) return existing;

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("form_submissions")
    .insert({
      form_id: formId,
      user_id: identity.userId ?? null,
      phone_number: identity.phoneNumber ?? null,
      field_values: {},
      status: "draft",
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const retry = await findExistingSubmission(formId, identity);
      if (retry) return retry;
    }
    throw new Error(error.message);
  }

  log.info("submission created", {
    formId,
    submissionId: data.id,
    userId: identity.userId,
    phoneNumber: identity.phoneNumber,
  });

  return data;
}

export async function getSubmission(formId: string, submissionId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("form_submissions")
    .select("*")
    .eq("id", submissionId)
    .eq("form_id", formId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Submission not found");
  }

  return data;
}

function fieldMap(fields: AnnotatedField[]): Map<string, AnnotatedField> {
  return new Map(fields.map((f) => [f.field_key, f]));
}

export async function setFieldValues(
  formId: string,
  submissionId: string,
  updates: Record<string, string>
) {
  const fields = await getFormFields(formId);
  const fieldsByKey = fieldMap(fields);

  for (const [key, value] of Object.entries(updates)) {
    const field = fieldsByKey.get(key);
    if (!field) {
      throw new Error(`Unknown field_key: ${key}`);
    }
    validateFieldValue(field, value);
  }

  const submission = await getSubmission(formId, submissionId);
  const merged = {
    ...(submission.field_values as Record<string, string>),
    ...updates,
  };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("form_submissions")
    .update({
      field_values: merged,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update submission");
  }

  return data;
}

export async function getProgress(
  formId: string,
  submissionId: string
): Promise<SubmissionProgress> {
  const fields = await getFormFields(formId);
  const submission = await getSubmission(formId, submissionId);
  const values = (submission.field_values as Record<string, string>) ?? {};

  const filled: string[] = [];
  const empty: string[] = [];
  const required_missing: string[] = [];

  for (const field of fields) {
    const value = values[field.field_key];
    if (isFieldValueFilled(field, value)) {
      filled.push(field.field_key);
    } else {
      empty.push(field.field_key);
      if (field.required) {
        required_missing.push(field.field_key);
      }
    }
  }

  return {
    filled,
    empty,
    required_missing,
    total: fields.length,
    status: submission.status,
    field_values: values,
  };
}

export async function validateComplete(
  formId: string,
  submissionId: string
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const progress = await getProgress(formId, submissionId);

  if (progress.required_missing.length > 0) {
    return { ok: false, missing: progress.required_missing };
  }

  return { ok: true };
}

export async function markSubmissionComplete(
  formId: string,
  submissionId: string,
  filledPdfPath: string
) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("form_submissions")
    .update({
      status: "complete",
      filled_pdf_path: filledPdfPath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
    .eq("form_id", formId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to mark submission complete");
  }

  return data;
}

export async function getFormTemplate(formId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("forms")
    .select("id, form_name, form_fields, template_pdf_path, annotation_status, last_updated_at")
    .eq("id", formId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Form not found");
  }

  return data;
}
