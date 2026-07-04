import { createAdminClient } from "../supabase";
import { createComponentLogger } from "../logger";

const log = createComponentLogger("db");

export async function saveConversationHistory({
  userId,
  phoneNumber,
  sessionId,
  source,
  transcript,
  summary,
}: {
  userId?: string;
  phoneNumber?: string;
  sessionId: string;
  source: "vapi" | "elevenlabs";
  transcript: unknown;
  summary: string;
}) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("conversation_history")
    .upsert(
      {
        user_id: userId ?? null,
        phone_number: phoneNumber ?? null,
        session_id: sessionId,
        source,
        transcript,
        summary,
      },
      { onConflict: "session_id" }
    )
    .select();

  if (error) {
    log.error("failed to save conversation history", {
      error: error.message,
      sessionId,
      userId,
      phoneNumber,
    });
    throw error;
  }

  return data;
}
