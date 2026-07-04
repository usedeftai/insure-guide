import { createGroq } from "@ai-sdk/groq";
import { getGroqApiKey } from "./env";

export enum GroqModel {
  LLAMA_3_3_70B = "llama-3.3-70b-versatile",
  LLAMA_3_1_8B_INSTANT = "llama-3.1-8b-instant",
}

let groqProvider: ReturnType<typeof createGroq> | null = null;

function getGroqProvider() {
  if (!groqProvider) {
    const apiKey = getGroqApiKey();
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set");
    }
    groqProvider = createGroq({ apiKey });
  }
  return groqProvider;
}

/** Primary live voice model — lowest latency with strong tool calling. */
export function getModel(modelName: GroqModel = GroqModel.LLAMA_3_3_70B) {
  return getGroqProvider()(modelName);
}

/** Cheap fast model for summarization / compaction. */
export function getFastModel() {
  return getModel(GroqModel.LLAMA_3_1_8B_INSTANT);
}
