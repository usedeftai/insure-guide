# Backend documentation

Documentation for the BitCamp backend service (`apps/backend`).

## Forms pipeline

| Document | Description |
|----------|-------------|
| [Form field extraction](./form-field-extraction.md) | End-to-end design for ingesting PDF forms, AI extraction, annotation, submissions, and rendering |

## Related code

| Path | Role |
|------|------|
| `src/lib/forms/` | PDF ingest, extraction, annotation, render, submissions |
| `src/lib/ai/pdf-providers.ts` | Gemini + Claude model configuration |
| `src/routes/forms.ts` | HTTP API for ingest, submissions, render |

## Environment

See [`.env.example`](../.env.example) for required keys. PDF extraction needs `GEMINI_API_KEY` (primary) and `ANTHROPIC_API_KEY` (fallback escalation).
