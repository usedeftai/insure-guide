// DC Medicaid / IMA Combined Application — 24-field form schema
// mapProfileToFormData uses the real Supabase user_profiles row shape

export type FormFieldType =
  | "text"
  | "date"
  | "tel"
  | "number"
  | "select"
  | "radio"
  | "textarea";

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  profileKey?: string;    // dot-path into the profile row (supports "eligibility_profile.foo")
  defaultValue?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
}

export interface FormSection {
  id: string;
  title: string;
  fields: FormField[];
}

export type FormData = Record<string, string>;

export const DC_MEDICAID_SCHEMA: FormSection[] = [
  {
    id: "applicant_info",
    title: "Applicant Information",
    fields: [
      {
        id: "first_name",
        label: "First Name",
        type: "text",
        required: true,
        profileKey: "first_name",
        placeholder: "First name",
      },
      {
        id: "last_name",
        label: "Last Name",
        type: "text",
        required: true,
        profileKey: "last_name",
        placeholder: "Last name",
      },
      {
        id: "date_of_birth",
        label: "Date of Birth",
        type: "date",
        required: true,
        profileKey: "date_of_birth",
        hint: "MM/DD/YYYY",
      },
      {
        id: "ssn_or_itin",
        label: "SSN / ITIN",
        type: "text",
        required: false,
        placeholder: "Optional",
        hint: "Optional: does not affect eligibility",
      },
      {
        id: "phone_number",
        label: "Phone Number",
        type: "tel",
        required: true,
        profileKey: "phone_number",
        placeholder: "(202) 000-0000",
      },
      {
        id: "email",
        label: "Email Address",
        type: "text",
        required: false,
        placeholder: "Optional",
      },
      {
        id: "preferred_language",
        label: "Preferred Language",
        type: "select",
        required: true,
        profileKey: "language",
        options: [
          { value: "en", label: "English" },
          { value: "es", label: "Spanish / Español" },
          { value: "am", label: "Amharic / አማርኛ" },
          { value: "zh", label: "Chinese / 中文" },
          { value: "vi", label: "Vietnamese / Tiếng Việt" },
          { value: "ko", label: "Korean / 한국어" },
          { value: "fr", label: "French / Français" },
          { value: "pt", label: "Portuguese / Português" },
        ],
      },
    ],
  },
  {
    id: "residence",
    title: "Residence",
    fields: [
      {
        id: "street_address",
        label: "Street Address",
        type: "text",
        required: true,
        profileKey: "street_address",
        placeholder: "123 Main St NW",
      },
      {
        id: "city",
        label: "City",
        type: "text",
        required: true,
        profileKey: "city",  // resolved in mapProfileToFormData
        defaultValue: "Washington",
        placeholder: "Washington",
      },
      {
        id: "state",
        label: "State",
        type: "text",
        required: true,
        profileKey: "state",  // resolved in mapProfileToFormData
        defaultValue: "dc",
        placeholder: "dc",
      },
      {
        id: "zip_code",
        label: "ZIP Code",
        type: "text",
        required: true,
        profileKey: "zip_code",
        placeholder: "20001",
      },
    ],
  },
  {
    id: "household_income",
    title: "Household & Income",
    fields: [
      {
        id: "household_size",
        label: "Household Size",
        type: "number",
        required: false,
        profileKey: "household_size",
        placeholder: "e.g. 3",
      },
      {
        id: "monthly_income",
        label: "Monthly Household Income ($)",
        type: "number",
        required: true,
        placeholder: "e.g. 2000",
        hint: "Total household income before taxes",
      },
      {
        id: "income_source",
        label: "Primary Income Source",
        type: "select",
        required: true,
        profileKey: "primary_income_source",
        options: [
          { value: "employment", label: "Employment / wages" },
          { value: "self_employment", label: "Self-employment" },
          { value: "cash", label: "Cash / informal work" },
          { value: "social_security", label: "Social Security" },
          { value: "unemployment", label: "Unemployment benefits" },
          { value: "none", label: "No income" },
          { value: "other", label: "Other" },
        ],
      },
      {
        id: "employer_name",
        label: "Employer Name",
        type: "text",
        required: false,
        placeholder: "Optional",
      },
    ],
  },
  {
    id: "immigration_eligibility",
    title: "Immigration & Eligibility",
    fields: [
      {
        id: "immigration_status",
        label: "Immigration Status",
        type: "select",
        required: false,
        profileKey: "immigration_status",
        options: [
          { value: "lpr_over5", label: "Lawful Permanent Resident (5+ years)" },
          { value: "lpr_under5", label: "Lawful Permanent Resident (< 5 years)" },
          { value: "tps", label: "Temporary Protected Status (TPS)" },
          { value: "daca", label: "DACA" },
          { value: "asylee", label: "Asylee / Refugee" },
          { value: "refugee", label: "Refugee" },
          { value: "visa_holder", label: "Visa Holder" },
          { value: "undocumented", label: "Undocumented" },
          { value: "parolee_cnhv", label: "Humanitarian Parolee (CNHV)" },
        ],
      },
      {
        id: "dc_resident",
        label: "DC Resident",
        type: "radio",
        required: false,
        profileKey: "dc_resident",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
      {
        id: "currently_insured",
        label: "Do you currently have health insurance?",
        type: "radio",
        required: true,
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
      {
        id: "has_medicare",
        label: "Do you have Medicare?",
        type: "radio",
        required: true,
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
      {
        id: "pregnant",
        label: "Are you currently pregnant?",
        type: "radio",
        required: false,
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "na", label: "Not applicable" },
        ],
      },
    ],
  },
  {
    id: "program_signature",
    title: "Program & Signature",
    fields: [
      {
        id: "applying_for",
        label: "Applying For",
        type: "select",
        required: true,
        profileKey: "matched_programs",  // resolved in mapProfileToFormData
        options: [
          { value: "dc_alliance", label: "DC Healthcare Alliance" },
          { value: "medicaid", label: "DC Medicaid" },
          { value: "healthy_dc", label: "Healthy DC Plan" },
          { value: "emergency_medicaid", label: "Emergency Medicaid" },
          { value: "marketplace", label: "ACA Marketplace / DC Health Link" },
        ],
      },
      {
        id: "signature_name",
        label: "Signature (Full Legal Name)",
        type: "text",
        required: true,
        placeholder: "Type your full legal name",
      },
      {
        id: "signature_date",
        label: "Signature Date",
        type: "date",
        required: true,
        defaultValue: new Date().toISOString().slice(0, 10),
      },
    ],
  },
];

// Flat lookup by field ID
export const FORM_FIELD_MAP: Record<string, FormField> = Object.fromEntries(
  DC_MEDICAID_SCHEMA.flatMap((s) => s.fields).map((f) => [f.id, f])
);

// ---------------------------------------------------------------------------
// Profile → FormData mapping
// ---------------------------------------------------------------------------

// Matches the shape returned by getUserProfile() in apps/web/lib/db/service.ts
interface UserProfileRow {
  id?: string;
  language?: string | null;
  immigration_status?: string | null;
  age?: number | null;
  household_size?: number | null;
  income_pct_fpl?: number | null;
  state?: string | null;
  city?: string | null;
  matched_programs?: string[] | null;
  eligibility_profile?: Record<string, unknown> | null;
  onboarding_complete?: boolean | null;
  phone_number?: string | null;
  // PII columns added in migration 0016
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  street_address?: string | null;
  zip_code?: string | null;
  primary_income_source?: string | null;
}

function resolveProfileValue(profile: UserProfileRow, key: string): string {
  if (key.startsWith("eligibility_profile.")) {
    const sub = key.slice("eligibility_profile.".length);
    const val = (profile.eligibility_profile as Record<string, unknown> | null)?.[sub];
    return val != null ? String(val) : "";
  }
  switch (key) {
    case "first_name":
      return profile.first_name ?? "";
    case "last_name":
      return profile.last_name ?? "";
    case "date_of_birth":
      return profile.date_of_birth ?? "";
    case "street_address":
      return profile.street_address ?? "";
    case "zip_code":
      return profile.zip_code ?? "";
    case "primary_income_source":
      return profile.primary_income_source ?? "";
    case "phone_number":
      return profile.phone_number ?? "";
    case "household_size":
      return profile.household_size != null ? String(profile.household_size) : "";
    case "language":
      return profile.language ?? "en";
    case "immigration_status":
      return profile.immigration_status ?? "";
    case "state":
      return profile.state == null ? "" : profile.state;
    case "matched_programs":
      return profile.matched_programs?.[0] ?? "";
    default:
      return "";
  }
}

export function mapProfileToFormData(profile: UserProfileRow): FormData {
  const data: FormData = {};

  for (const section of DC_MEDICAID_SCHEMA) {
    for (const field of section.fields) {
      let value = "";

      // 1. Handle manual overrides for inconsistent field IDs or complex mappings
      if (field.id === "monthly_income") {
        value = resolveProfileValue(profile, "eligibility_profile.income_monthly");
      } else if (["currently_insured", "has_medicare", "pregnant"].includes(field.id)) {
        const raw = resolveProfileValue(profile, `eligibility_profile.${field.id}`);
        // Map boolean strings from quiz to "yes"/"no" for radio fields
        if (raw === "true") value = "yes";
        else if (raw === "false") value = "no";
        else value = raw;
      } else if (field.profileKey) {
        // 2. Handle standard profileKey mappings
        if (field.id === "dc_resident") {
          value = resolveProfileValue(profile, "dc_resident");
        } else if (field.id === "city") {
          value = profile.city ? profile.city : "";
        } else if (field.id === "state") {
          value = profile.state ? profile.state : "";
        } else {
          value = resolveProfileValue(profile, field.profileKey);
        }
      } else if (field.defaultValue) {
        // 3. Fallback to schema default
        value = field.defaultValue;
      }

      if (value) data[field.id] = value;
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getRequiredFieldIds(schema: FormSection[] = DC_MEDICAID_SCHEMA): string[] {
  return schema.flatMap((s) => s.fields).filter((f) => f.required).map((f) => f.id);
}

export function getEmptyFields(
  schema: FormSection[] = DC_MEDICAID_SCHEMA,
  data: FormData
): string[] {
  return schema
    .flatMap((s) => s.fields)
    .filter((f) => !data[f.id] || data[f.id].trim() === "")
    .map((f) => f.id);
}

export function getFilledFields(
  schema: FormSection[] = DC_MEDICAID_SCHEMA,
  data: FormData
): string[] {
  return schema
    .flatMap((s) => s.fields)
    .filter((f) => data[f.id] && data[f.id].trim() !== "")
    .map((f) => f.id);
}
