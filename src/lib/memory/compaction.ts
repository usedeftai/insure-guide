import { generateText, pruneMessages, type ModelMessage } from "ai";
import { getFastModel, GroqModel } from "../ai";
import { createComponentLogger, logError } from "../logger";
import {
  getSessionCompactionState,
  persistCompactionState,
} from "./conversation-memory";

const log = createComponentLogger("compaction");
const COMPACTION_MODEL = GroqModel.LLAMA_3_1_8B_INSTANT;

/** ~70% of a conservative in-context budget for llama-3.3 70b. */
const TOKEN_BUDGET = 90_000;
const COMPACTION_THRESHOLD = Math.floor(TOKEN_BUDGET * 0.75);
const RECENT_TURNS_TO_KEEP = 16;

function estimateTokens(messages: ModelMessage[]): number {
  const text = JSON.stringify(messages);
  return Math.ceil(text.length / 4);
}

async function summarizeMessages(messages: ModelMessage[]): Promise<string> {
  const startedAt = Date.now();
  const transcript = messages
    .map((m) => {
      const content =
        typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content);
      return `${m.role.toUpperCase()}: ${content}`;
    })
    .join("\n");

  log.info("compaction summary started", {
    model: COMPACTION_MODEL,
    messageCount: messages.length,
  });

  try {
    const { text } = await generateText({
      model: getFastModel(),
      temperature: 0.2,
      maxOutputTokens: 512,
      prompt: `Summarize this conversation segment for an insurance navigator assistant.
Preserve user facts (immigration status, income, form fields, programs discussed) and open tasks.

CONVERSATION:
${transcript}

SUMMARY:`,
    });

    log.info("compaction summary succeeded", {
      model: COMPACTION_MODEL,
      messageCount: messages.length,
      summaryLength: text.trim().length,
      durationMs: Date.now() - startedAt,
    });

    return text.trim();
  } catch (error) {
    logError(log, "compaction summary failed", error, {
      model: COMPACTION_MODEL,
      messageCount: messages.length,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export interface CompactionInput {
  sessionId?: string;
  baseSystem: string;
  messages: ModelMessage[];
}

export interface CompactionResult {
  system: string;
  messages: ModelMessage[];
}

export async function applyCompaction({
  sessionId,
  baseSystem,
  messages,
}: CompactionInput): Promise<CompactionResult> {
  let runningSummary: string | null = null;
  let compactedUpTo = 0;

  if (sessionId) {
    const state = await getSessionCompactionState(sessionId);
    runningSummary = state.runningSummary;
    compactedUpTo = state.compactedUpTo;
  }

  let system = baseSystem;
  if (runningSummary) {
    system += `\n\nRECENT SESSION SUMMARY (compacted earlier turns):\n${runningSummary}`;
  }

  let pruned = pruneMessages({
    messages,
    reasoning: "all",
    toolCalls: "before-last-3-messages",
    emptyMessages: "remove",
  });

  if (estimateTokens(pruned) <= COMPACTION_THRESHOLD) {
    return { system, messages: pruned };
  }

  if (pruned.length <= RECENT_TURNS_TO_KEEP) {
    return { system, messages: pruned };
  }

  const toSummarize = pruned.slice(0, -RECENT_TURNS_TO_KEEP);
  const recent = pruned.slice(-RECENT_TURNS_TO_KEEP);
  const newSummary = await summarizeMessages(toSummarize);

  const mergedSummary = runningSummary
    ? `${runningSummary}\n\n${newSummary}`
    : newSummary;

  if (sessionId) {
    const newCompactedUpTo = compactedUpTo + toSummarize.length;
    await persistCompactionState(sessionId, mergedSummary, newCompactedUpTo);
  }

  system += `\n\nRECENT SESSION SUMMARY (compacted earlier turns):\n${mergedSummary}`;

  return { system, messages: recent };
}

export function createPrepareStep(sessionId: string | undefined, baseSystem: string) {
  return async ({ messages }: { messages: ModelMessage[] }) => {
    const result = await applyCompaction({
      sessionId,
      baseSystem,
      messages,
    });

    return {
      system: result.system,
      messages: result.messages,
    };
  };
}
