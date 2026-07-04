import { generateObject } from "ai";
import {
  getPdfExtractionModel,
  getPdfExtractionModelName,
} from "../ai/pdf-providers";
import {
  metadataExtractionSchema,
  placementExtractionSchema,
  CHOICE_FIELD_TYPES,
  type ExtractedFieldDraft,
  type FieldPlacementDraft,
  isMetadataComplete,
  isFieldPlacementValid,
} from "./field-schema";
import {
  METADATA_SYSTEM_PROMPT,
  METADATA_USER_PROMPT,
  buildPlacementSystemPrompt,
  buildPlacementUserPrompt,
} from "./pdf-extract-prompts";
import { createComponentLogger, logError } from "../logger";

export type ExtractionSource = "flash" | "claude";

export interface MetadataEscalationReason {
  incompleteMetadataRatio: number;
  choiceOptionsRatio: number;
  ungroupedHeuristic: number;
  withoutOptionsCount: number;
  suspectLabelPrefixGroups: number;
  triggeredBy: string[];
}

const log = createComponentLogger("pdf-extract");

function countChoiceFieldsWithOptions(fields: ExtractedFieldDraft[]): number {
  return fields.filter(
    (f) =>
      CHOICE_FIELD_TYPES.includes(f.field_type) &&
      f.options &&
      f.options.length >= 2
  ).length;
}

function analyzeUngroupedChoiceHeuristic(fields: ExtractedFieldDraft[]): {
  score: number;
  withoutOptionsCount: number;
  suspectLabelPrefixGroups: number;
} {
  const choiceFields = fields.filter((f) => CHOICE_FIELD_TYPES.includes(f.field_type));
  const withoutOptionsCount = choiceFields.filter(
    (f) => !f.options || f.options.length < 2
  ).length;

  // Only flag label-prefix clusters among choice fields that still look ungrouped.
  const prefixToFields = new Map<string, ExtractedFieldDraft[]>();
  for (const field of choiceFields) {
    const base = field.label.toLowerCase().split(/[:\s]/)[0];
    const group = prefixToFields.get(base) ?? [];
    group.push(field);
    prefixToFields.set(base, group);
  }

  let suspectLabelPrefixGroups = 0;
  for (const group of prefixToFields.values()) {
    if (group.length <= 2) continue;
    const ungroupedInGroup = group.filter((f) => !f.options || f.options.length < 2);
    if (ungroupedInGroup.length >= 2) {
      suspectLabelPrefixGroups++;
    }
  }

  return {
    score: withoutOptionsCount + suspectLabelPrefixGroups,
    withoutOptionsCount,
    suspectLabelPrefixGroups,
  };
}

function getMetadataEscalationReason(
  fields: ExtractedFieldDraft[]
): MetadataEscalationReason {
  const triggeredBy: string[] = [];
  const complete = fields.filter(isMetadataComplete).length;
  const incompleteMetadataRatio =
    fields.length === 0 ? 1 : 1 - complete / fields.length;

  if (fields.length === 0) {
    triggeredBy.push("no_fields_extracted");
  } else if (complete / fields.length < 0.7) {
    triggeredBy.push("incomplete_metadata_below_70pct");
  }

  const choiceFields = fields.filter((f) => CHOICE_FIELD_TYPES.includes(f.field_type));
  const withOptions = countChoiceFieldsWithOptions(fields);
  const choiceOptionsRatio =
    choiceFields.length === 0 ? 1 : withOptions / choiceFields.length;

  if (choiceFields.length > 0 && choiceOptionsRatio < 0.7) {
    triggeredBy.push("choice_fields_missing_options_below_70pct");
  }

  const { score: ungroupedHeuristic, withoutOptionsCount, suspectLabelPrefixGroups } =
    analyzeUngroupedChoiceHeuristic(fields);

  if (ungroupedHeuristic > 0) {
    triggeredBy.push("ungrouped_choice_heuristic");
  }

  return {
    incompleteMetadataRatio,
    choiceOptionsRatio,
    ungroupedHeuristic,
    withoutOptionsCount,
    suspectLabelPrefixGroups,
    triggeredBy,
  };
}

function shouldEscalateMetadata(fields: ExtractedFieldDraft[]): boolean {
  return getMetadataEscalationReason(fields).triggeredBy.length > 0;
}

function shouldEscalatePlacements(
  metadataFields: ExtractedFieldDraft[],
  placements: FieldPlacementDraft[]
): boolean {
  if (metadataFields.length === 0) return false;

  const placementByKey = new Map(placements.map((p) => [p.field_key, p]));
  const valid = metadataFields.filter((field) => {
    const placement = placementByKey.get(field.field_key);
    return placement && isFieldPlacementValid(placement, field.field_type);
  });

  return valid.length / metadataFields.length < 0.7;
}

async function runMetadataTier(
  pdfBytes: Uint8Array,
  tier: ExtractionSource
): Promise<ExtractedFieldDraft[]> {
  const model = getPdfExtractionModelName(tier);
  const startedAt = Date.now();

  log.info("metadata extraction started", { model, tier });

  try {
    const { object } = await generateObject({
      model: getPdfExtractionModel(tier),
      schema: metadataExtractionSchema,
      messages: [
        { role: "system", content: METADATA_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: METADATA_USER_PROMPT },
            { type: "file", data: pdfBytes, mediaType: "application/pdf" },
          ],
        },
      ],
      temperature: 0.1,
    });

    const groupedFieldCount = object.fields.filter(
      (f) => f.options && f.options.length >= 2
    ).length;

    log.info("metadata extraction succeeded", {
      model,
      tier,
      fieldCount: object.fields.length,
      groupedFieldCount,
      choiceFieldCount: object.fields.filter((f) =>
        CHOICE_FIELD_TYPES.includes(f.field_type)
      ).length,
      durationMs: Date.now() - startedAt,
    });

    return object.fields;
  } catch (error) {
    logError(log, "metadata extraction failed", error, {
      model,
      tier,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

async function runPlacementTier(
  pdfBytes: Uint8Array,
  metadataFields: ExtractedFieldDraft[],
  tier: ExtractionSource
): Promise<FieldPlacementDraft[]> {
  const model = getPdfExtractionModelName(tier);
  const startedAt = Date.now();

  log.info("placement extraction started", {
    model,
    tier,
    fieldCount: metadataFields.length,
  });

  try {
    const { object } = await generateObject({
      model: getPdfExtractionModel(tier),
      schema: placementExtractionSchema,
      messages: [
        { role: "system", content: buildPlacementSystemPrompt() },
        {
          role: "user",
          content: [
            { type: "text", text: buildPlacementUserPrompt(metadataFields) },
            { type: "file", data: pdfBytes, mediaType: "application/pdf" },
          ],
        },
      ],
      temperature: 0.1,
    });

    log.info("placement extraction succeeded", {
      model,
      tier,
      placementCount: object.placements.length,
      durationMs: Date.now() - startedAt,
    });

    return object.placements;
  } catch (error) {
    logError(log, "placement extraction failed", error, {
      model,
      tier,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function extractFieldMetadataFromPdf(
  pdfBytes: Uint8Array
): Promise<{ fields: ExtractedFieldDraft[]; source: ExtractionSource }> {
  const flashFields = await runMetadataTier(pdfBytes, "flash");

  if (!shouldEscalateMetadata(flashFields)) {
    return { fields: flashFields, source: "flash" };
  }

  const escalation = getMetadataEscalationReason(flashFields);

  log.warn("metadata extraction escalating to claude", {
    fromModel: getPdfExtractionModelName("flash"),
    toModel: getPdfExtractionModelName("claude"),
    flashFieldCount: flashFields.length,
    metadataCompletePct: Math.round((1 - escalation.incompleteMetadataRatio) * 100),
    choiceOptionsPct: Math.round(escalation.choiceOptionsRatio * 100),
    triggeredBy: escalation.triggeredBy,
    ungroupedHeuristic: escalation.ungroupedHeuristic,
    withoutOptionsCount: escalation.withoutOptionsCount,
    suspectLabelPrefixGroups: escalation.suspectLabelPrefixGroups,
  });

  const claudeFields = await runMetadataTier(pdfBytes, "claude");
  return { fields: claudeFields, source: "claude" };
}

export async function extractFieldPlacementsFromPdf(
  pdfBytes: Uint8Array,
  metadataFields: ExtractedFieldDraft[]
): Promise<{ placements: FieldPlacementDraft[]; source: ExtractionSource }> {
  if (metadataFields.length === 0) {
    return { placements: [], source: "flash" };
  }

  const flashPlacements = await runPlacementTier(pdfBytes, metadataFields, "flash");

  if (!shouldEscalatePlacements(metadataFields, flashPlacements)) {
    return { placements: flashPlacements, source: "flash" };
  }

  log.warn("placement extraction escalating to claude", {
    fromModel: getPdfExtractionModelName("flash"),
    toModel: getPdfExtractionModelName("claude"),
    flashPlacementCount: flashPlacements.length,
  });

  const claudePlacements = await runPlacementTier(pdfBytes, metadataFields, "claude");
  return { placements: claudePlacements, source: "claude" };
}
