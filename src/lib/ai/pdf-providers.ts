import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getAnthropicApiKey, getGeminiApiKey } from "../env";

export enum PdfExtractionModel {
  GEMINI_2_5_FLASH = "gemini-2.5-flash",
  CLAUDE_SONNET_4_6 = "claude-sonnet-4-6",
}

export function getGoogleProvider() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }

  return createGoogleGenerativeAI({ apiKey });
}

export function getAnthropicProvider() {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  return createAnthropic({ apiKey });
}

export function getPdfExtractionModel(tier: "flash" | "claude") {
  if (tier === "flash") {
    return getGoogleProvider()(PdfExtractionModel.GEMINI_2_5_FLASH);
  }

  return getAnthropicProvider()(PdfExtractionModel.CLAUDE_SONNET_4_6);
}

export function getPdfExtractionModelName(tier: "flash" | "claude"): string {
  return tier === "flash"
    ? PdfExtractionModel.GEMINI_2_5_FLASH
    : PdfExtractionModel.CLAUDE_SONNET_4_6;
}
