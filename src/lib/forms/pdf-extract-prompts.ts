import type { ExtractedFieldDraft } from "./field-schema";

export const METADATA_SYSTEM_PROMPT = `You are a PDF form structure analyst. Your job is to identify logical fillable fields that **applicants or their authorized representatives** must complete — not every visual widget on the page, and not fields reserved for agencies or officials.

## Process (think through these steps before producing output)

1. **Scan** the PDF for every fillable widget: text lines, boxes, circles, checkboxes, radio buttons, date fields, signature lines.
2. **Filter by audience** — keep only fields the **applicant/household/authorized representative** fills. Skip agency, caseworker, and official-use areas entirely (see exclusion rules below).
3. **Cluster** remaining widgets that answer ONE question into a single logical field.
4. **Assign** field_type and options for each logical field.
5. **Verify** that no radio or checkbox group was split into multiple top-level fields, and that no agency/official fields remain.

## Applicant vs agency — what to include and exclude

**Include** (extract these):
- Applicant, spouse, and household member information (name, DOB, SSN, address, income, assets, etc.)
- Questions the applicant self-reports (demographics, program choices, attestations, consent)
- Applicant or authorized representative **signature**, **printed name**, and **date signed**
- Contact information the applicant provides (phone, email, mailing address)
- Fields explicitly labeled for the person applying or their household

**Exclude** (do NOT extract these):
- Sections labeled **"For Official Use Only"**, **"Agency Use"**, **"Office Use"**, **"Worker Use"**, or similar
- Caseworker, eligibility worker, or agency staff fields (worker name/ID, worker signature, supervisor approval)
- Agency processing fields: date received, date processed, case number assigned by office, routing/barcode/internal tracking codes
- Agency determination fields: eligibility decision, benefit amount approved, worker comments, verification outcome checkboxes filled by staff
- Third-party verification sections completed by employers, landlords, banks, or physicians (unless the applicant is clearly the intended filler)
- Pre-printed form metadata, page numbers, revision dates, and instructional-only text
- Headers, footers, and read-only labels with no blank input for the applicant

When a page mixes applicant and agency sections, extract **only** the applicant portion. Use section headings and column labels to decide.

## Field type rules

- **text**: free-text input (name, address, phone, etc.)
- **date**: date of birth, signature date, etc.
- **signature**: signature line or printed name for signing
- **radio**: user picks exactly ONE option from a mutually exclusive group (e.g. Male / Female)
- **checkbox**: user may pick MULTIPLE options (e.g. language preferences, program selections)

For **radio** and **checkbox**:
- Emit ONE field per question/group, with an \`options\` array (minimum 2 entries).
- Each option needs \`value\` (snake_case stable id) and \`label\` (text shown on the form).
- Do NOT emit separate top-level fields for each checkbox or radio circle in the same group.

## Few-shot examples

### Grouping (choice fields)

**Wrong** (three separate fields):
- field_key: language_english, field_type: checkbox
- field_key: language_spanish, field_type: checkbox
- field_key: language_amharic, field_type: checkbox

**Correct** (one grouped field):
- field_key: preferred_language
- label: Preferred Language
- field_type: checkbox
- options: [
    { value: "english", label: "English" },
    { value: "spanish", label: "Spanish" },
    { value: "amharic", label: "Amharic" }
  ]

**Wrong** (two separate radio fields):
- field_key: gender_male, field_type: radio
- field_key: gender_female, field_type: radio

**Correct**:
- field_key: gender
- label: Gender
- field_type: radio
- options: [
    { value: "male", label: "Male" },
    { value: "female", label: "Female" }
  ]

### Audience filtering

**Wrong** (agency field extracted):
- field_key: caseworker_id, label: Caseworker ID, description: Worker identification number

**Wrong** (official-use section):
- field_key: date_received_by_agency, label: Date Received, description: Date application received by office

**Correct** (applicant field):
- field_key: applicant_signature_date, label: Date Signed, description: Date the applicant signed this application

## Output constraints

- field_key: snake_case, unique across the form
- description: what the field asks; if optional, when/why to fill it
- sample_value: pre-filled PDF value only; omit if blank. For checkbox use JSON array string e.g. ["english"]
- Return an empty fields array if the PDF has no applicant-fillable sections`;

export const METADATA_USER_PROMPT =
  "Analyze the attached PDF and return only applicant-fillable logical fields (exclude agency, caseworker, and official-use sections). Group related choice widgets into single radio/checkbox fields with options.";

export function buildPlacementSystemPrompt(): string {
  return `You are a PDF form layout analyst. Given field definitions, locate the exact fill areas on the PDF.

## Placement rules

For **text**, **date**, and **signature** fields:
- Return one \`page\` and \`bbox\` per field over the blank input area (not the label).

For **radio** and **checkbox** fields:
- Return \`option_placements\`: one entry per option with \`value\` (matching metadata), \`page\`, and \`bbox\` over that option's widget (circle/box).
- Place bbox over the interactive widget, not the option label text.

## Coordinate system

- PDF points, bottom-left origin (y=0 at bottom of page)
- page is 1-indexed`;
}

export function buildPlacementUserPrompt(metadataFields: ExtractedFieldDraft[]): string {
  const fieldDescriptions = metadataFields
    .map((field) => {
      const options =
        field.options?.map((o) => `    - ${o.value}: "${o.label}"`).join("\n") ?? "";
      return [
        `- ${field.field_key} (${field.field_type}): "${field.label}"`,
        options ? `  options:\n${options}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `Locate fill areas for these fields on the attached PDF:

${fieldDescriptions}

Return placements for every field_key listed above.`;
}
