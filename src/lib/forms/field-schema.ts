import { z } from "zod";

export const fieldTypeSchema = z.enum([
  "text",
  "checkbox",
  "radio",
  "date",
  "signature",
]);

export type FieldType = z.infer<typeof fieldTypeSchema>;

export const CHOICE_FIELD_TYPES: FieldType[] = ["radio", "checkbox"];

export const bboxSchema = z.object({
  x: z.number().describe("Left edge in PDF points, bottom-left origin"),
  y: z.number().describe("Bottom edge in PDF points, bottom-left origin"),
  width: z.number().positive(),
  height: z.number().positive(),
});

export type Bbox = z.infer<typeof bboxSchema>;

export const fieldOptionDraftSchema = z.object({
  value: z
    .string()
    .describe("Stable snake_case id for this choice, e.g. english"),
  label: z.string().describe("Display label as shown on the form"),
});

export type FieldOptionDraft = z.infer<typeof fieldOptionDraftSchema>;

export const fieldOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  page: z.number().int().positive().optional(),
  bbox: bboxSchema.optional(),
  pdf_field_name: z.string().optional(),
});

export type FieldOption = z.infer<typeof fieldOptionSchema>;

/** AI metadata pass — semantic field definition including type and options */
export interface ExtractedFieldDraft {
  field_key: string;
  label: string;
  description: string;
  required: boolean;
  field_type: FieldType;
  options?: FieldOptionDraft[];
  sample_value?: string;
}

export const extractedFieldDraftSchema = z
  .object({
    field_key: z
      .string()
      .describe("Short snake_case identifier derived from the field label"),
    label: z.string().describe("Human-readable field label as shown on the form"),
    description: z
      .string()
      .describe(
        "What the field is asking for. If not required, explain when or why to fill it."
      ),
    required: z.boolean().describe("Whether the form marks this field as required"),
    field_type: fieldTypeSchema.describe(
      "Input type: text, radio, checkbox, date, or signature"
    ),
    options: z
      .array(fieldOptionDraftSchema)
      .optional()
      .describe(
        "Required for radio/checkbox: list of choices. Radio allows one; checkbox allows multiple."
      ),
    sample_value: z
      .string()
      .optional()
      .describe(
        "Pre-filled value from PDF. Radio: one option value. Checkbox: JSON array string."
      ),
  })
  .superRefine((field, ctx) => {
    if (CHOICE_FIELD_TYPES.includes(field.field_type)) {
      if (!field.options || field.options.length < 2) {
        ctx.addIssue({
          code: "custom",
          message: `${field.field_type} fields must have at least 2 options`,
          path: ["options"],
        });
      }
    } else if (field.options && field.options.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `options must not be set for field_type ${field.field_type}`,
        path: ["options"],
      });
    }
  });

export const metadataExtractionSchema = z.object({
  fields: z.array(extractedFieldDraftSchema),
});

/** Placement for a single option within a radio/checkbox group */
export interface OptionPlacementDraft {
  value: string;
  page: number;
  bbox: Bbox;
}

export const optionPlacementDraftSchema = z.object({
  value: z.string().describe("Must match options[].value from metadata"),
  page: z.number().int().positive(),
  bbox: bboxSchema,
});

/** AI placement pass — per-field or per-option bboxes */
export interface FieldPlacementDraft {
  field_key: string;
  page?: number;
  bbox?: Bbox;
  option_placements?: OptionPlacementDraft[];
}

export const fieldPlacementDraftSchema = z.object({
  field_key: z.string(),
  page: z.number().int().positive().optional(),
  bbox: bboxSchema.optional(),
  option_placements: z.array(optionPlacementDraftSchema).optional(),
});

export const placementExtractionSchema = z.object({
  placements: z.array(fieldPlacementDraftSchema),
});

/** Final annotated template field */
export interface AnnotatedField {
  field_key: string;
  label: string;
  description: string;
  required: boolean;
  field_type: FieldType;
  options?: FieldOption[];
  page: number;
  bbox: Bbox;
  pdf_field_name?: string;
  sample_value?: string;
}

export const annotatedFieldSchema = z.object({
  field_key: z.string(),
  label: z.string(),
  description: z.string(),
  required: z.boolean(),
  field_type: fieldTypeSchema,
  options: z.array(fieldOptionSchema).optional(),
  page: z.number().int().positive(),
  bbox: bboxSchema,
  pdf_field_name: z.string().optional(),
  sample_value: z.string().optional(),
});

export function isMetadataComplete(field: ExtractedFieldDraft): boolean {
  if (
    field.field_key.trim().length === 0 ||
    field.label.trim().length === 0 ||
    field.description.trim().length === 0
  ) {
    return false;
  }

  if (CHOICE_FIELD_TYPES.includes(field.field_type)) {
    return Boolean(field.options && field.options.length >= 2);
  }

  return true;
}

export function isOptionPlacementValid(placement: OptionPlacementDraft): boolean {
  return (
    placement.value.trim().length > 0 &&
    placement.page > 0 &&
    placement.bbox.width > 0 &&
    placement.bbox.height > 0
  );
}

export function isFieldPlacementValid(
  placement: FieldPlacementDraft,
  fieldType: FieldType
): boolean {
  if (CHOICE_FIELD_TYPES.includes(fieldType)) {
    return Boolean(
      placement.option_placements &&
        placement.option_placements.length > 0 &&
        placement.option_placements.every(isOptionPlacementValid)
    );
  }

  return Boolean(
    placement.page &&
      placement.page > 0 &&
      placement.bbox &&
      placement.bbox.width > 0 &&
      placement.bbox.height > 0
  );
}

export function unionBbox(boxes: Bbox[]): Bbox {
  if (boxes.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function isAnnotatedFieldComplete(field: AnnotatedField): boolean {
  if (!isMetadataComplete(field)) return false;

  if (CHOICE_FIELD_TYPES.includes(field.field_type)) {
    if (!field.options || field.options.length < 2) return false;
    return field.options.every(
      (opt) => opt.page && opt.page > 0 && opt.bbox && opt.bbox.width > 0 && opt.bbox.height > 0
    );
  }

  return field.page > 0 && field.bbox.width > 0 && field.bbox.height > 0;
}

export function parseCheckboxValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
    } catch {
      // fall through to comma split
    }
  }

  return trimmed.split(",").map((v) => v.trim()).filter(Boolean);
}

export function validateFieldValue(field: AnnotatedField, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;

  if (field.field_type === "radio") {
    const allowed = new Set(field.options?.map((o) => o.value) ?? []);
    if (!allowed.has(trimmed)) {
      throw new Error(
        `Invalid value for radio field ${field.field_key}: must be one of ${[...allowed].join(", ")}`
      );
    }
    return;
  }

  if (field.field_type === "checkbox") {
    const selected = parseCheckboxValue(trimmed);
    const allowed = new Set(field.options?.map((o) => o.value) ?? []);
    for (const item of selected) {
      if (!allowed.has(item)) {
        throw new Error(
          `Invalid checkbox option "${item}" for field ${field.field_key}`
        );
      }
    }
  }
}

export function isFieldValueFilled(field: AnnotatedField, value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  if (field.field_type === "checkbox") {
    return parseCheckboxValue(trimmed).length > 0;
  }

  return true;
}

export type AnnotationStatus = "pending" | "ready" | "failed";

export type SubmissionStatus = "draft" | "complete";
