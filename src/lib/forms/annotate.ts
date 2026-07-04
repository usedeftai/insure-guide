import type { AcroFormField } from "./pdf-parse";
import {
  CHOICE_FIELD_TYPES,
  type AnnotatedField,
  type AnnotationStatus,
  type ExtractedFieldDraft,
  type FieldPlacementDraft,
  type FieldOption,
  type Bbox,
  isAnnotatedFieldComplete,
  isFieldPlacementValid,
  unionBbox,
} from "./field-schema";
import { createComponentLogger } from "../logger";

const log = createComponentLogger("annotate");

export interface AnnotationBuildResult {
  fields: AnnotatedField[];
  acroFormMappedCount: number;
  status: AnnotationStatus;
}

function bboxOverlap(a: Bbox, b: Bbox): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = xOverlap * yOverlap;
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  if (minArea <= 0) return 0;
  return intersection / minArea;
}

function findBestAcroMatch(bbox: Bbox, page: number, acroFields: AcroFormField[]): string | undefined {
  const samePage = acroFields.filter((f) => f.page === page);
  let best: AcroFormField | undefined;
  let bestScore = 0;

  for (const acro of samePage) {
    const score = bboxOverlap(bbox, acro.bbox);
    if (score > bestScore && score >= 0.3) {
      bestScore = score;
      best = acro;
    }
  }

  return best?.name;
}

function mergeOptionsWithPlacement(
  meta: ExtractedFieldDraft,
  placement: FieldPlacementDraft | undefined,
  acroFields: AcroFormField[]
): { options: FieldOption[]; acroMapped: number } {
  const draftOptions = meta.options ?? [];
  let acroMapped = 0;

  const options: FieldOption[] = draftOptions.map((draft) => {
    const optionPlacement = placement?.option_placements?.find(
      (p) => p.value === draft.value
    );

    const option: FieldOption = {
      value: draft.value,
      label: draft.label,
      page: optionPlacement?.page,
      bbox: optionPlacement?.bbox,
    };

    if (optionPlacement && option.bbox && option.page) {
      const acroName = findBestAcroMatch(option.bbox, option.page, acroFields);
      if (acroName) {
        option.pdf_field_name = acroName;
        acroMapped++;
      }
    }

    return option;
  });

  return { options, acroMapped };
}

export function buildAnnotatedFields(
  metadataFields: ExtractedFieldDraft[],
  placements: FieldPlacementDraft[],
  acroFields: AcroFormField[]
): AnnotationBuildResult {
  const placementByKey = new Map(placements.map((p) => [p.field_key, p]));
  let acroFormMappedCount = 0;

  const fields: AnnotatedField[] = metadataFields.map((meta) => {
    const placement = placementByKey.get(meta.field_key);

    if (CHOICE_FIELD_TYPES.includes(meta.field_type)) {
      const { options, acroMapped } = mergeOptionsWithPlacement(
        meta,
        placement,
        acroFields
      );
      acroFormMappedCount += acroMapped;

      const optionBboxes = options
        .map((o) => o.bbox)
        .filter((b): b is Bbox => Boolean(b));
      const fieldBbox = unionBbox(optionBboxes);
      const fieldPage = options.find((o) => o.page)?.page ?? placement?.page ?? 1;

      return {
        field_key: meta.field_key,
        label: meta.label,
        description: meta.description,
        required: meta.required,
        field_type: meta.field_type,
        options,
        sample_value: meta.sample_value,
        page: fieldPage,
        bbox: fieldBbox,
      };
    }

    const annotated: AnnotatedField = {
      field_key: meta.field_key,
      label: meta.label,
      description: meta.description,
      required: meta.required,
      field_type: meta.field_type,
      sample_value: meta.sample_value,
      page: placement?.page ?? 1,
      bbox: placement?.bbox ?? { x: 0, y: 0, width: 1, height: 1 },
    };

    if (placement && isFieldPlacementValid(placement, meta.field_type)) {
      const acroName = findBestAcroMatch(
        annotated.bbox,
        annotated.page,
        acroFields
      );
      if (acroName) {
        annotated.pdf_field_name = acroName;
        acroFormMappedCount++;
      }
    }

    return annotated;
  });

  log.info("annotated fields built", {
    metadataCount: metadataFields.length,
    placementCount: placements.length,
    acroFormFieldCount: acroFields.length,
    acroFormMappedCount,
    outputCount: fields.length,
    groupedFieldCount: fields.filter((f) => f.options && f.options.length >= 2).length,
  });

  const validation = validateAnnotation(fields);

  return {
    fields,
    acroFormMappedCount,
    status: validation.status,
  };
}

export function validateAnnotation(fields: AnnotatedField[]): {
  status: AnnotationStatus;
  reason?: string;
} {
  if (fields.length === 0) {
    return { status: "failed", reason: "No fields extracted from PDF" };
  }

  const incomplete = fields.filter((f) => !isAnnotatedFieldComplete(f));
  if (incomplete.length > 0) {
    return {
      status: "failed",
      reason: `${incomplete.length} field(s) missing complete metadata, options, or placement`,
    };
  }

  const invalidChoice = fields.filter(
    (f) =>
      CHOICE_FIELD_TYPES.includes(f.field_type) &&
      (!f.options || f.options.length < 2)
  );
  if (invalidChoice.length > 0) {
    return {
      status: "failed",
      reason: `${invalidChoice.length} radio/checkbox field(s) missing options`,
    };
  }

  return { status: "ready" };
}
