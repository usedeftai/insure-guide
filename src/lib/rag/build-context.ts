import type { SearchResult } from "./retrieve";
import { ModelMessage } from "ai";

/**
 * Formats search results into a context string for the LLM prompt.
 */
export function buildContext(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No specific policy information found for this query.";
  }

  return results
    .map((res, i) => {
      const metadata = `[Source: ${res.program?.join(", ") || "General"} | Type: ${res.content_type}]`;
      return `CHUNK ${i + 1} ${metadata}\n${res.content}`;
    })
    .join("\n\n---\n\n");
}

export function convertTranscriptToModelMessages(
  transcript: Array<{ role: string; message: string }>
): ModelMessage[] {
  return transcript.map(({ role, message }) => ({
    role: role === "bot" ? "assistant" : "user",
    content: message,
  }));
}
