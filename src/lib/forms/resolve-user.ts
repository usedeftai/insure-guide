import { createAdminClient } from "../supabase";

export async function resolveUserId(input: {
  userId?: string;
  phoneNumber?: string;
}): Promise<string> {
  if (input.userId) return input.userId;

  if (!input.phoneNumber) {
    throw new Error("Could not resolve user identity");
  }

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("phone_number", input.phoneNumber)
    .maybeSingle();

  if (profile?.id) return profile.id;

  const { data: newProfile, error } = await supabase
    .from("user_profiles")
    .insert({ phone_number: input.phoneNumber })
    .select("id")
    .single();

  if (error || !newProfile) {
    throw new Error("Failed to create user profile");
  }

  return newProfile.id;
}
