# Form field extraction

This document describes how the backend turns an uploaded PDF government form into a structured, fillable template — and how user answers are written back into the original PDF.

## Overview

The pipeline is **greenfield**: it does not use the legacy DC Medicaid schema (`dc-medicaid-schema.ts`) or the web app's PDF generators (`apps/web/lib/forms/*`). Each form is analyzed independently from its PDF.

```
Upload PDF
    │
    ▼
┌─────────────────┐
│  AcroForm scan  │  pdf-parse.ts — deterministic widget positions via pdf-lib
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Metadata pass   │  AI pass 1 — what fields exist, types, grouped options
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Placement pass  │  AI pass 2 — page + bbox per field or per option
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Annotate       │  Merge AI + AcroForm, validate completeness
└────────┬────────┘
         │
         ▼
   forms.form_fields (JSONB)
   form-templates bucket (original PDF)
         │
         ▼ (user fills via API)
┌─────────────────┐
│  Render         │  Hybrid AcroForm fill + bbox text/check overlays
└────────┬────────┘
         │
         ▼
   form-pdfs bucket (filled PDF)
```

## Design decisions

### Why a two-pass AI extraction?

**Metadata** (semantic) and **placement** (spatial) are separated on purpose:

| Pass | Question answered | Output |
|------|-------------------|--------|
| Metadata | What logical fields does this form have? | `field_key`, `label`, `description`, `required`, `field_type`, `options` |
| Placement | Where on the page is each fill area? | `page`, `bbox`, or `option_placements[]` |

Splitting the work improves structured output quality. The metadata model can focus on grouping related widgets (e.g. three language checkboxes → one `preferred_language` field) without also reasoning about PDF coordinates. The placement model receives the finalized field list and only locates geometry.

Both passes use Vercel AI SDK `generateObject` with Zod schemas so responses are validated before entering the pipeline.

### Why group radio/checkbox options into one field?

Government forms often render each checkbox as a separate visual widget. Treating each widget as its own field would:

- Explode field counts on large forms (200+ pseudo-fields)
- Break the value contract (users pick options, not individual widgets)
- Make progress tracking and validation harder

Instead, **one logical field** owns an `options[]` array. Each option gets its own placement and optional AcroForm mapping during annotation.

**Wrong:** three fields `language_english`, `language_spanish`, `language_amharic`

**Correct:** one field `preferred_language` with three options

Prompts in `pdf-extract-prompts.ts` use chain-of-thought steps, few-shot examples, and a self-verification step to enforce this.

### Why extract only applicant-fillable fields?

Government PDFs often contain large **agency** or **official use** sections (caseworker ID, date received, eligibility determination, worker signature) alongside applicant sections. The pipeline is built for **end users filling their own application**, not for agency back-office processing.

The metadata prompt filters by audience before grouping:

| Include | Exclude |
|---------|---------|
| Applicant / household / authorized rep information | "For Official Use Only", "Agency Use", "Worker Use" sections |
| Self-reported demographics, income, program choices | Caseworker name, ID, signature, supervisor approval |
| Applicant signature and date signed | Date received/processed, assigned case number, routing codes |
| Contact info the applicant provides | Eligibility decisions and verification outcomes filled by staff |

Mixed pages are split using section headings and column labels — only the applicant portion is extracted. This keeps field counts manageable and avoids collecting values the voice agent or web UI should never ask for.

### Why hybrid AcroForm + overlay rendering?

PDFs vary widely:

- Some have proper AcroForm fields (`pdf-lib` can fill them natively)
- Many government PDFs are flat or have misaligned AcroForm metadata

The pipeline scans AcroForm widgets (`pdf-parse.ts`) and tries to match each AI bbox to a widget by page + overlap. At render time:

1. **Try AcroForm first** — `setText`, `check()`, `select()` on matched widgets
2. **Fall back to overlay** — draw text or an "X" mark at the stored bbox

This maximizes fill accuracy without requiring every PDF to have perfect AcroForm structure.

### Why Gemini first, Claude as fallback?

| Tier | Model | Role |
|------|-------|------|
| Primary | `gemini-2.5-flash` | Fast, cost-effective; handles most forms |
| Fallback | `claude-sonnet-4-6` | Escalation when quality heuristics fail |

Escalation is automatic and logged. Claude is not called on every ingest — only when Flash output looks incomplete.

Configured in `src/lib/ai/pdf-providers.ts`. These models are separate from the Groq/Gemini setup used elsewhere in the repo (e.g. live voice chat).

### Why store fields as JSONB, not a normalized schema?

`forms.form_fields` is a JSONB array of `AnnotatedField` objects. No per-field database migration is needed when the annotation shape evolves (e.g. adding `field_type` and `options`). Templates are self-contained documents keyed by `form_id`.

### Why `annotation_status`?

Ingest runs the full pipeline **before** writing anything to Supabase. Only successful annotations are persisted with `annotation_status: ready`. Failed validation or thrown errors return `422` / `500` with no database row and no stored PDF.

| Status | Meaning |
|--------|---------|
| `ready` | Validation passed; form and template PDF are stored; submissions allowed |
| `failed` | Used internally during validation only — never persisted |
| `pending` | Reserved; not used by the current ingest flow |

If the DB insert or PDF upload fails after validation, a rollback deletes the partial row and storage object.

---

## Field schema

Defined in `src/lib/forms/field-schema.ts`.

### Field types

| `field_type` | User input | Stored value in `field_values` |
|--------------|------------|--------------------------------|
| `text` | Free text | Plain string |
| `date` | Date | Plain string |
| `signature` | Signature / printed name | Plain string |
| `radio` | Exactly one choice | Single string matching `options[].value` |
| `checkbox` | Zero or more choices | JSON array string, e.g. `["english","spanish"]` |

### AnnotatedField shape

```json
{
  "field_key": "preferred_language",
  "label": "Preferred Language",
  "description": "Select all languages you are comfortable speaking.",
  "required": true,
  "field_type": "checkbox",
  "options": [
    {
      "value": "english",
      "label": "English",
      "page": 1,
      "bbox": { "x": 72, "y": 600, "width": 12, "height": 12 },
      "pdf_field_name": "Language_English"
    }
  ],
  "page": 1,
  "bbox": { "x": 72, "y": 580, "width": 12, "height": 32 }
}
```

- **`field_key`** — Stable snake_case identifier used in API payloads and `field_values`
- **`options`** — Required for `radio` / `checkbox` (minimum 2). Placement pass enriches each option with `page`, `bbox`, and optional `pdf_field_name`
- **`bbox` (field level)** — Union of option bboxes for choice fields; used for UI overlays and fallback rendering
- **`pdf_field_name`** — Matched AcroForm widget name when overlap heuristics find one (≥30% bbox overlap on the same page)

### Validation rules

**At extraction (Zod):**
- `radio` / `checkbox` → `options.length >= 2`
- `text` / `date` / `signature` → `options` must be absent

**At annotation (`validateAnnotation`):**
- Every field must pass `isAnnotatedFieldComplete` (metadata + valid placement)
- Choice fields must have ≥2 options, each with a valid bbox

**At submission (`validateFieldValue`):**
- Radio values must be one of `options[].value`
- Checkbox values must parse to an array whose entries are all valid option values

---

## Pipeline modules

### `ingest.ts` — orchestrator

Runs the full chain:

1. `scanAcroFormFields(pdfBytes)`
2. `extractFieldMetadataFromPdf(pdfBytes)`
3. `extractFieldPlacementsFromPdf(pdfBytes, metadataFields)`
4. `buildAnnotatedFields(metadata, placements, acroFields)`
5. `validateAnnotation(fields)`

Logs `fieldCount`, `groupedFieldCount`, `fieldTypes`, `optionCount`, `acroFormMappedCount`, and which AI tier was used.

### `pdf-extract.ts` — AI extraction

Two independent tiered calls, each starting with Gemini Flash:

**Metadata escalation** triggers when any of:

| Check | Threshold |
|-------|-----------|
| No fields extracted | Always escalate |
| Incomplete metadata | `< 70%` of fields pass `isMetadataComplete` |
| Choice fields missing options | `< 70%` of radio/checkbox fields have ≥2 options |
| Ungrouped choice heuristic | Score `> 0` (see below) |

**Placement escalation** triggers when `< 70%` of metadata fields have valid placements for their type.

Escalation logs include `triggeredBy`, `metadataCompletePct`, `choiceOptionsPct`, and heuristic breakdown.

**Ungrouped choice heuristic** detects likely split checkbox/radio groups among choice fields only. It flags:

- Choice fields with fewer than 2 options
- Label-prefix clusters where 3+ choice fields share the same first word **and** at least 2 lack proper options

It intentionally does **not** scan all field types — large forms have many unrelated fields sharing prefixes like "Applicant" or "Household", which previously caused false escalations.

### `pdf-extract-prompts.ts` — prompt engineering

Prompt patterns used:

| Pattern | Application |
|---------|-------------|
| Structured outputs | `generateObject` + Zod schemas |
| System + user split | System = role/constraints; user = PDF + task |
| Chain-of-thought | 5 explicit steps before metadata output (scan → filter audience → cluster → assign → verify) |
| Few-shot | Language checkbox and gender radio grouping; applicant vs agency exclusion examples |
| Self-verification | Confirm no choice group was split and no agency/official fields remain |

### `annotate.ts` — merge and match

For **text / date / signature** fields:
- Copy placement `page` + `bbox`
- Match field bbox to best AcroForm widget on the same page

For **radio / checkbox** fields:
- Merge `option_placements[]` into `options[]`
- Match each option bbox to AcroForm individually
- Set field-level `bbox` = `unionBbox(option bboxes)`

### `pdf-render.ts` — fill PDF

Per field type:

| Type | Render strategy |
|------|-----------------|
| `text`, `date`, `signature` | AcroForm `setText` or text overlay at bbox |
| `radio` | AcroForm `select(value)` or check mark on matching option bbox |
| `checkbox` | Parse JSON array; check each selected option via AcroForm or overlay |

After filling, the form is flattened when possible.

### `submission-service.ts` — user data

- Submissions store answers in `form_submissions.field_values` (`Record<string, string>`)
- `setFieldValues` validates keys and choice values before merge
- `getProgress` uses `isFieldValueFilled` (empty checkbox array counts as unfilled)
- `validateComplete` ensures all `required` fields are filled before render

### `storage.ts` — Supabase buckets

| Bucket | Path | Content |
|--------|------|---------|
| `form-templates` | `{formId}/original.pdf` | Uploaded template |
| `form-pdfs` | `{submissionId}/filled.pdf` | Rendered output |

---

## HTTP API

Base path: `/api/forms` (see `src/routes/forms.ts`).

### Ingest a template

```
POST /api/forms/ingest
Content-Type: multipart/form-data

form_name: string
pdf: file
```

Creates a `forms` row and uploads the template PDF **only when annotation succeeds**. The pipeline runs in memory first; nothing is written on failure.

Response includes `annotation_status` (always `ready` on success), `source` (`flash` | `claude`), and annotated `form_fields`.

On validation failure returns `422`:

```json
{ "error": "Form annotation failed", "failure_reason": "..." }
```

### Get template

```
GET /api/forms/:id
```

Returns `form_name`, `form_fields`, `template_pdf_path`, `annotation_status`.

### Submissions

```
POST   /api/forms/:id/submissions              — create (requires user_id or phone_number)
GET    /api/forms/:id/submissions/:submissionId — progress + field_values
PATCH  /api/forms/:id/submissions/:submissionId — update values
POST   /api/forms/:id/submissions/:submissionId/render — fill PDF when complete
```

**PATCH body** (either format):

```json
{ "field_values": { "applicant_name": "Maria Garcia", "preferred_language": "[\"english\",\"spanish\"]" } }
```

```json
{ "field_key": "gender", "value": "female" }
```

Invalid radio/checkbox values return `400`.

**Render** requires all required fields filled. Returns `filled_pdf_url` and render stats (`acroformFieldCount`, `overlayFieldCount`).

---

## Database

Relevant tables (see `supabase/migrations/`):

**`forms`**
- `form_fields` — JSONB array of `AnnotatedField`
- `template_pdf_path` — storage path in `form-templates`
- `annotation_status` — `pending` | `ready` | `failed`

**`form_submissions`**
- `field_values` — JSONB map of `field_key → string`
- `status` — `draft` | `complete`
- `filled_pdf_path` — storage path in `form-pdfs`

---

## Environment variables

| Variable | Required for | Notes |
|----------|--------------|-------|
| `GEMINI_API_KEY` | Ingest (primary) | Also accepts `GOOGLE_GENERATIVE_AI_API_KEY` |
| `ANTHROPIC_API_KEY` | Ingest (fallback) | Only needed when escalation triggers |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage + DB | Same Supabase project as web app |

---

## Observability

Structured Winston logs use component names:

| Component | Events |
|-----------|--------|
| `forms` | Ingest/render request lifecycle |
| `pdf-parse` | AcroForm scan |
| `pdf-extract` | Metadata/placement passes, escalation reasons |
| `annotate` | Field merge, AcroForm mapping counts |
| `pdf-render` | AcroForm vs overlay fill counts |
| `submissions` | Submission CRUD |

When debugging escalation, search logs for `metadata extraction escalating to claude` and inspect `triggeredBy`.

---

## Out of scope

The following are intentionally **not** part of this pipeline:

- `dc-medicaid-schema.ts` — legacy hard-coded field list for a specific form
- `apps/web/lib/forms/*` — client-side PDF generation utilities
- Normalized `form_fields` relational tables — fields live in JSONB

---

## File reference

```
src/lib/forms/
├── field-schema.ts       # Types, Zod schemas, validation helpers
├── pdf-extract-prompts.ts # AI prompts
├── pdf-extract.ts        # Metadata + placement AI passes
├── pdf-parse.ts          # AcroForm scanner
├── annotate.ts           # Merge AI output + AcroForm
├── ingest.ts             # Pipeline orchestrator
├── pdf-render.ts         # Fill template PDF
├── submission-service.ts # Submission CRUD + validation
└── storage.ts            # Supabase storage helpers

src/lib/ai/pdf-providers.ts  # Model tier configuration
src/routes/forms.ts          # HTTP routes
```
