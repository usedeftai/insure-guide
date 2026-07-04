import { generateText } from "ai";
import { getFastModel, GroqModel } from "../ai";
import { createComponentLogger, logError } from "../logger";

const log = createComponentLogger("summarize");
const SUMMARIZE_MODEL = GroqModel.LLAMA_3_1_8B_INSTANT;

/**
 * Summarizes a conversation transcript for long-term memory storage.
 */
export async function summarizeConversation(transcriptJson: unknown): Promise<string> {
  const startedAt = Date.now();

  try {
    const transcriptString = JSON.stringify(transcriptJson, null, 2);

    log.info("conversation summary started", {
      model: SUMMARIZE_MODEL,
      transcriptLength: transcriptString.length,
    });

    const { text } = await generateText({
      model: getFastModel(),
      temperature: 0.3,
      maxOutputTokens: 512,
      prompt: `Summarize the following conversation transcript between an AI insurance navigator and a user.
Focus on:
1. What the user's situation or goal is.
2. Any key information provided by the user (immigration status, DC residency, etc.).
3. Next steps or advice given by the AI.

TRANSCRIPT:
${transcriptString}

SUMMARY:`,
    });

    log.info("conversation summary succeeded", {
      model: SUMMARIZE_MODEL,
      summaryLength: text.trim().length,
      durationMs: Date.now() - startedAt,
    });

    return text.trim();
  } catch (error) {
    logError(log, "conversation summary failed", error, {
      model: SUMMARIZE_MODEL,
      durationMs: Date.now() - startedAt,
    });
    return "Summary generation failed.";
  }
}
