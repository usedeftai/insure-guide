import { createAdminClient } from "../supabase";

export async function findOrCreateUserProfileByPhone(phone: string) {
  const supabase = createAdminClient();

  const { data: initialProfile, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("phone_number", phone)
    .maybeSingle();

  if (error) throw error;

  if (initialProfile) return initialProfile;

  const { data: newProfile, error: insertError } = await supabase
    .from("user_profiles")
    .insert({ phone_number: phone })
    .select()
    .single();

  if (insertError) throw insertError;
  return newProfile;
}

export async function getUserProfileById(userId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateUserProfileAdmin(
  userId: string,
  profile: Record<string, unknown>
) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .update(profile)
    .eq("id", userId)
    .select();

  if (error) throw error;
  return data;
}

export function formatProfileForPrompt(profile: Record<string, unknown> | null): string {
  if (!profile) return "No profile data available yet.";

  const fields = Object.entries(profile).map(([key, value]) => {
    const label = key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    const displayValue =
      value === null || value === undefined || value === "" ? "Not yet known" : value;
    return `${label}: ${displayValue}`;
  });

  return `USER PROFILE:\n${fields.join("\n")}`;
}
