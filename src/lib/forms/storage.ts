import { createAdminClient } from "../supabase";

const TEMPLATE_BUCKET = "form-templates";
const FILLED_BUCKET = "form-pdfs";

export function templateStoragePath(formId: string): string {
  return `${formId}/original.pdf`;
}

export function filledStoragePath(submissionId: string): string {
  return `${submissionId}/filled.pdf`;
}

export async function uploadTemplatePdf(
  formId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const supabase = createAdminClient();
  const path = templateStoragePath(formId);

  const { error } = await supabase.storage
    .from(TEMPLATE_BUCKET)
    .upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload template PDF: ${error.message}`);
  }

  return path;
}

export async function downloadTemplatePdf(path: string): Promise<Uint8Array> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage.from(TEMPLATE_BUCKET).download(path);

  if (error || !data) {
    throw new Error(`Failed to download template PDF: ${error?.message ?? "unknown"}`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

export async function uploadFilledPdf(
  submissionId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const supabase = createAdminClient();
  const path = filledStoragePath(submissionId);

  const { error } = await supabase.storage.from(FILLED_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to upload filled PDF: ${error.message}`);
  }

  return path;
}

export function getFilledPdfPublicUrl(path: string): string {
  const supabase = createAdminClient();
  const { data } = supabase.storage.from(FILLED_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Remove a partially persisted ingest (DB row + template PDF). Best-effort on failure paths. */
export async function rollbackIngestForm(formId: string): Promise<void> {
  const supabase = createAdminClient();
  const path = templateStoragePath(formId);

  await supabase.storage.from(TEMPLATE_BUCKET).remove([path]);
  await supabase.from("forms").delete().eq("id", formId);
}
