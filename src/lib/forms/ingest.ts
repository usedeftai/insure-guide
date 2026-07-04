import {
  buildAnnotatedFields,
  validateAnnotation,
  type AnnotationBuildResult,
} from "./annotate";
import { scanAcroFormFields } from "./pdf-parse";
import {
  extractFieldMetadataFromPdf,
  extractFieldPlacementsFromPdf,
  type ExtractionSource,
} from "./pdf-extract";
import { createComponentLogger } from "../logger";

const log = createComponentLogger("ingest");

export interface IngestPdfResult {
  fields: AnnotationBuildResult["fields"];
  annotationStatus: AnnotationBuildResult["status"];
  failureReason?: string;
  source: ExtractionSource;
  acroFormFieldCount: number;
  acroFormMappedCount: number;
}

export async function ingestAndAnnotatePdf(
  pdfBytes: Uint8Array,
  formId?: string
): Promise<IngestPdfResult> {
  const startedAt = Date.now();

  const acroFields = await scanAcroFormFields(pdfBytes);

  const { fields: metadataFields, source: metadataSource } =
    await extractFieldMetadataFromPdf(pdfBytes);

  const { placements, source: placementSource } = await extractFieldPlacementsFromPdf(
    pdfBytes,
    metadataFields
  );

  const source: ExtractionSource =
    metadataSource === "claude" || placementSource === "claude" ? "claude" : "flash";

  const buildResult = buildAnnotatedFields(metadataFields, placements, acroFields);
  const validation = validateAnnotation(buildResult.fields);

  const groupedFieldCount = buildResult.fields.filter(
    (f) => f.options && f.options.length >= 2
  ).length;

  log.info("ingest annotation completed", {
    formId,
    source,
    metadataSource,
    placementSource,
    acroFormFieldCount: acroFields.length,
    acroFormMappedCount: buildResult.acroFormMappedCount,
    fieldCount: buildResult.fields.length,
    groupedFieldCount,
    fieldTypes: buildResult.fields.reduce(
      (acc, f) => {
        acc[f.field_type] = (acc[f.field_type] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    optionCount: buildResult.fields.reduce(
      (sum, f) => sum + (f.options?.length ?? 0),
      0
    ),
    annotationStatus: validation.status,
    durationMs: Date.now() - startedAt,
  });

  return {
    fields: buildResult.fields,
    annotationStatus: validation.status,
    failureReason: validation.reason,
    source,
    acroFormFieldCount: acroFields.length,
    acroFormMappedCount: buildResult.acroFormMappedCount,
  };
}
