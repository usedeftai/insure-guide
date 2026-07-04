import { Hono } from "hono";
import { getPdfExtractionModelName } from "../lib/ai/pdf-providers";
import type { AnnotatedField } from "../lib/forms/field-schema";
import { ingestAndAnnotatePdf } from "../lib/forms/ingest";
import { renderFilledPdf } from "../lib/forms/pdf-render";
import {
  createSubmission,
  getFormTemplate,
  getProgress,
  getSubmission,
  markSubmissionComplete,
  setFieldValues,
  validateComplete,
} from "../lib/forms/submission-service";
import {
  downloadTemplatePdf,
  getFilledPdfPublicUrl,
  rollbackIngestForm,
  uploadFilledPdf,
  uploadTemplatePdf,
} from "../lib/forms/storage";
import { createComponentLogger, logError, serializeError } from "../lib/logger";
import { createAdminClient } from "../lib/supabase";

export const formRoutes = new Hono();
const log = createComponentLogger("forms");

async function readPdfFromFormData(body: Record<string, unknown>): Promise<Uint8Array> {
  const pdf = body.pdf;

  if (!pdf) {
    throw new Error("Missing required field: pdf");
  }

  if (pdf instanceof File) {
    return new Uint8Array(await pdf.arrayBuffer());
  }

  if (pdf instanceof Blob) {
    return new Uint8Array(await pdf.arrayBuffer());
  }

  throw new Error("Invalid pdf field: expected a file upload");
}

function parseIdentity(body: Record<string, unknown>) {
  const userId = typeof body.user_id === "string" ? body.user_id : undefined;
  const phoneNumber =
    typeof body.phone_number === "string" ? body.phone_number : undefined;
  return { userId, phoneNumber };
}

formRoutes.post("/ingest", async (c) => {
  const requestStartedAt = Date.now();
  let formId: string | undefined;

  try {
    const body = await c.req.parseBody();
    const formName = body.form_name;

    if (typeof formName !== "string" || !formName.trim()) {
      return c.json({ error: "Missing or invalid 'form_name' parameter" }, 400);
    }

    const pdfBytes = await readPdfFromFormData(body);

    log.info("ingest request received", {
      formName: formName.trim(),
      pdfSizeBytes: pdfBytes.length,
      primaryModel: getPdfExtractionModelName("flash"),
      fallbackModel: getPdfExtractionModelName("claude"),
    });

    const ingestResult = await ingestAndAnnotatePdf(pdfBytes);

    if (ingestResult.annotationStatus !== "ready") {
      log.warn("ingest rejected — annotation validation failed", {
        failureReason: ingestResult.failureReason,
        fieldCount: ingestResult.fields.length,
        source: ingestResult.source,
        durationMs: Date.now() - requestStartedAt,
      });

      return c.json(
        {
          error: "Form annotation failed",
          failure_reason: ingestResult.failureReason ?? "Validation failed",
        },
        422
      );
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();

    const { data: pendingForm, error: insertError } = await supabase
      .from("forms")
      .insert({
        form_name: formName.trim(),
        form_fields: ingestResult.fields,
        annotation_status: "ready",
        last_updated_at: now,
      })
      .select("id")
      .single();

    if (insertError || !pendingForm) {
      return c.json({ error: insertError?.message ?? "Failed to create form" }, 500);
    }

    formId = pendingForm.id;

    const templatePdfPath = await uploadTemplatePdf(pendingForm.id, pdfBytes);

    const { data: form, error: updateError } = await supabase
      .from("forms")
      .update({
        template_pdf_path: templatePdfPath,
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", pendingForm.id)
      .select("id, form_name, form_fields, template_pdf_path, annotation_status, last_updated_at")
      .single();

    if (updateError || !form) {
      throw new Error(updateError?.message ?? "Failed to save template PDF path");
    }

    log.info("ingest completed", {
      formId,
      annotationStatus: ingestResult.annotationStatus,
      fieldCount: ingestResult.fields.length,
      source: ingestResult.source,
      acroFormFieldCount: ingestResult.acroFormFieldCount,
      acroFormMappedCount: ingestResult.acroFormMappedCount,
      durationMs: Date.now() - requestStartedAt,
    });

    return c.json({
      id: form.id,
      form_name: form.form_name,
      form_fields: form.form_fields,
      template_pdf_path: form.template_pdf_path,
      annotation_status: form.annotation_status,
      source: ingestResult.source,
    });
  } catch (err) {
    if (formId) {
      try {
        await rollbackIngestForm(formId);
        log.warn("ingest rollback completed", { formId });
      } catch (rollbackErr) {
        logError(log, "ingest rollback failed", rollbackErr, { formId });
      }
    }

    return handleFormError(c, err, "ingest", requestStartedAt);
  }
});

formRoutes.get("/:id", async (c) => {
  try {
    const form = await getFormTemplate(c.req.param("id"));
    return c.json(form);
  } catch (err) {
    return handleFormError(c, err, "get-form");
  }
});

formRoutes.post("/:id/submissions", async (c) => {
  try {
    const formId = c.req.param("id");
    const body = await c.req.json<Record<string, unknown>>();
    const identity = parseIdentity(body);

    await getFormTemplate(formId);
    const submission = await createSubmission(formId, identity);

    return c.json(submission, 201);
  } catch (err) {
    return handleFormError(c, err, "create-submission");
  }
});

formRoutes.get("/:id/submissions/:submissionId", async (c) => {
  try {
    const formId = c.req.param("id");
    const submissionId = c.req.param("submissionId");

    const progress = await getProgress(formId, submissionId);
    return c.json(progress);
  } catch (err) {
    return handleFormError(c, err, "get-submission");
  }
});

formRoutes.patch("/:id/submissions/:submissionId", async (c) => {
  try {
    const formId = c.req.param("id");
    const submissionId = c.req.param("submissionId");
    const body = await c.req.json<Record<string, unknown>>();

    const fieldValues = body.field_values as Record<string, string> | undefined;
    const singleKey = typeof body.field_key === "string" ? body.field_key : undefined;
    const singleValue = typeof body.value === "string" ? body.value : undefined;

    let updates: Record<string, string> = {};

    if (fieldValues && typeof fieldValues === "object") {
      updates = fieldValues;
    } else if (singleKey && singleValue !== undefined) {
      updates = { [singleKey]: singleValue };
    } else {
      return c.json(
        { error: "Provide field_values object or field_key + value" },
        400
      );
    }

    const submission = await setFieldValues(formId, submissionId, updates);
    const progress = await getProgress(formId, submissionId);

    return c.json({ submission, progress });
  } catch (err) {
    return handleFormError(c, err, "patch-submission");
  }
});

formRoutes.post("/:id/submissions/:submissionId/render", async (c) => {
  const requestStartedAt = Date.now();

  try {
    const formId = c.req.param("id");
    const submissionId = c.req.param("submissionId");

    const validation = await validateComplete(formId, submissionId);
    if (!validation.ok) {
      return c.json(
        { error: "Missing required fields", missing: (validation as { missing: string[] }).missing },
        400
      );
    }

    const form = await getFormTemplate(formId);
    if (!form.template_pdf_path) {
      return c.json({ error: "Form template PDF not found" }, 404);
    }

    const submission = await getSubmission(formId, submissionId);
    const templateBytes = await downloadTemplatePdf(form.template_pdf_path);
    const fields = form.form_fields as AnnotatedField[];
    const values = (submission.field_values as Record<string, string>) ?? {};

    const { pdfBytes, stats } = await renderFilledPdf(templateBytes, fields, values);
    const filledPdfPath = await uploadFilledPdf(submissionId, pdfBytes);
    const filledPdfUrl = getFilledPdfPublicUrl(filledPdfPath);

    const updated = await markSubmissionComplete(formId, submissionId, filledPdfPath);

    log.info("render completed", {
      formId,
      submissionId,
      acroformFieldCount: stats.acroformFieldCount,
      overlayFieldCount: stats.overlayFieldCount,
      durationMs: Date.now() - requestStartedAt,
    });

    return c.json({
      submission: updated,
      filled_pdf_path: filledPdfPath,
      filled_pdf_url: filledPdfUrl,
      render_stats: stats,
    });
  } catch (err) {
    return handleFormError(c, err, "render", requestStartedAt);
  }
});

function handleFormError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
  operation: string,
  requestStartedAt?: number
) {
  const details = serializeError(err);
  const message = err instanceof Error ? err.message : "Unknown error";

  logError(log, `${operation} failed`, err, {
    durationMs: requestStartedAt ? Date.now() - requestStartedAt : undefined,
    primaryModel: getPdfExtractionModelName("flash"),
    fallbackModel: getPdfExtractionModelName("claude"),
  });

  if (message.includes("Missing required field") || message.includes("Invalid pdf")) {
    return c.json({ error: message }, 400);
  }

  if (message.includes("not found")) {
    return c.json({ error: message }, 404);
  }

  if (
    message.includes("GEMINI_API_KEY") ||
    message.includes("ANTHROPIC_API_KEY")
  ) {
    return c.json({ error: message }, 503);
  }

  if (message.includes("not ready")) {
    return c.json({ error: message }, 409);
  }

  const clientError: Record<string, unknown> = { error: message };
  if (details.statusCode !== undefined && details.statusCode !== null) {
    clientError.statusCode = details.statusCode;
  }
  if (details.responseBody) {
    clientError.details = details.responseBody;
  }

  return c.json(clientError, 500);
}
