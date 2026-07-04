import type { ModelMessage } from "ai";
import { convertTranscriptToModelMessages } from "../rag/build-context";
import { createComponentLogger } from "../logger";
import { createAdminClient } from "../supabase";

const log = createComponentLogger("memory");

const LONG_TERM_MEMORY_LIMIT = 5;

export interface MemoryIdentity {
  userId?: string;
  phoneNumber?: string;
  excludeSessionId?: string;
}

export interface TranscriptTurn {
  role: string;
  message: string;
}

export interface ConversationRow {
  id: string;
  session_id: string;
  transcript: TranscriptTurn[] | null;
  summary: string | null;
  running_summary: string | null;
  compacted_up_to: number | null;
}

export async function getLongTermMemory(identity: MemoryIdentity): Promise<string> {
  const supabase = createAdminClient();

  let query = supabase
    .from("conversation_history")
    .select("summary, created_at, session_id")
    .not("summary", "is", null)
    .order("created_at", { ascending: false })
    .limit(LONG_TERM_MEMORY_LIMIT);

  if (identity.excludeSessionId) {
    query = query.neq("session_id", identity.excludeSessionId);
  }

  if (identity.userId) {
    query = query.eq("user_id", identity.userId);
  } else if (identity.phoneNumber) {
    query = query.eq("phone_number", identity.phoneNumber);
  } else {
    return "No prior conversations on record.";
  }

  const { data, error } = await query;
  if (error) {
    log.warn("failed to load long-term memory", { error: error.message });
    return "No prior conversations on record.";
  }

  const summaries = (data ?? [])
    .map((row) => row.summary?.trim())
    .filter(Boolean);

  if (summaries.length === 0) {
    return "No prior conversations on record.";
  }

  return summaries
    .map((summary, index) => `${index + 1}. ${summary}`)
    .join("\n");
}

export async function getSessionRow(sessionId: string): Promise<ConversationRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("conversation_history")
    .select("id, session_id, transcript, summary, running_summary, compacted_up_to")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    log.warn("failed to load session row", { error: error.message, sessionId });
    return null;
  }

  return data as ConversationRow | null;
}

export async function getActiveSessionMessages(sessionId: string): Promise<ModelMessage[]> {
  const row = await getSessionRow(sessionId);
  if (!row?.transcript?.length) return [];

  const compactedUpTo = row.compacted_up_to ?? 0;
  const recentTranscript = row.transcript.slice(compactedUpTo);
  return convertTranscriptToModelMessages(recentTranscript);
}

export async function getSessionCompactionState(sessionId: string): Promise<{
  runningSummary: string | null;
  compactedUpTo: number;
}> {
  const row = await getSessionRow(sessionId);
  return {
    runningSummary: row?.running_summary ?? null,
    compactedUpTo: row?.compacted_up_to ?? 0,
  };
}

export async function persistCompactionState(
  sessionId: string,
  runningSummary: string,
  compactedUpTo: number
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("conversation_history")
    .update({ running_summary: runningSummary, compacted_up_to: compactedUpTo })
    .eq("session_id", sessionId);

  if (error) {
    log.warn("failed to persist compaction state", { error: error.message, sessionId });
  }
}

export async function appendTurns(
  sessionId: string,
  identity: MemoryIdentity,
  turns: TranscriptTurn[]
): Promise<void> {
  if (turns.length === 0) return;

  const supabase = createAdminClient();
  const existing = await getSessionRow(sessionId);
  const merged = [...(existing?.transcript ?? []), ...turns];

  const { error } = await supabase.from("conversation_history").upsert(
    {
      session_id: sessionId,
      user_id: identity.userId ?? null,
      phone_number: identity.phoneNumber ?? null,
      source: "vapi",
      transcript: merged,
    },
    { onConflict: "session_id" }
  );

  if (error) {
    log.warn("failed to append turns", { error: error.message, sessionId });
  }
}

export async function ensureActiveSession(
  sessionId: string,
  identity: MemoryIdentity
): Promise<void> {
  const existing = await getSessionRow(sessionId);
  if (existing) return;

  const supabase = createAdminClient();
  const { error } = await supabase.from("conversation_history").insert({
    session_id: sessionId,
    user_id: identity.userId ?? null,
    phone_number: identity.phoneNumber ?? null,
    source: "vapi",
    transcript: [],
  });

  if (error && error.code !== "23505") {
    log.warn("failed to ensure active session", { error: error.message, sessionId });
  }
}
