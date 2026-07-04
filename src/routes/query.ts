import { stepCountIs, streamText, type ModelMessage } from "ai";
import type { Context } from "hono";
import { AGENT_SYSTEM_PROMPT } from "../lib/agents/system-prompt";
import { getModel, GroqModel } from "../lib/ai";
import { formatProfileForPrompt, getUserProfileById } from "../lib/db/user";
import { createPrepareStep } from "../lib/memory/compaction";
import {
  appendTurns,
  ensureActiveSession,
  getLongTermMemory,
  getActiveSessionMessages,
} from "../lib/memory/conversation-memory";
import { createComponentLogger, logError } from "../lib/logger";
import {
  createOpenAIStreamResponse,
  extractQueryIdentity,
  parseOpenAIMessages,
  type QueryRequestBody,
} from "../lib/query/openai-stream";
import { createAgentTools } from "../lib/tools/index";
import { DEFAULT_FORM_ID } from "../lib/tools/context";

const log = createComponentLogger("query");

function buildSystemPrompt(
  profileBlock: string,
  longTermMemory: string
): string {
  return `${AGENT_SYSTEM_PROMPT}

${profileBlock}

LONG-TERM MEMORY (summaries from prior calls):
${longTermMemory}

FORM FILL CONTEXT:
When calling fillField, use form_id "${DEFAULT_FORM_ID}" unless the user specifies otherwise.`;
}

export async function handleQuery(c: Context) {
  const modelName = GroqModel.LLAMA_3_3_70B;

  try {
    const body = await c.req.json<QueryRequestBody>();
    const identity = extractQueryIdentity(body);

    const [longTermMemory, profile] = await Promise.all([
      getLongTermMemory({
        userId: identity.userId,
        phoneNumber: identity.phoneNumber,
        excludeSessionId: identity.sessionId,
      }),
      identity.userId ? getUserProfileById(identity.userId) : Promise.resolve(null),
    ]);

    const profileBlock = formatProfileForPrompt(profile);
    const baseSystem = buildSystemPrompt(profileBlock, longTermMemory);

    let messages: ModelMessage[] = body.messages?.length
      ? parseOpenAIMessages(body.messages)
      : identity.sessionId
        ? await getActiveSessionMessages(identity.sessionId)
        : [];

    if (identity.sessionId) {
      await ensureActiveSession(identity.sessionId, identity);
    }

    const tools = createAgentTools({
      userId: identity.userId,
      phoneNumber: identity.phoneNumber,
      formId: DEFAULT_FORM_ID,
    });

    const prepareStep = createPrepareStep(identity.sessionId, baseSystem);

    log.info("query stream started", {
      model: modelName,
      sessionId: identity.sessionId,
      userId: identity.userId,
      phoneNumber: identity.phoneNumber,
      messageCount: messages.length,
      stream: body.stream !== false,
    });

    const result = streamText({
      model: getModel(modelName),
      system: baseSystem,
      messages,
      tools,
      stopWhen: stepCountIs(5),
      temperature: 0.2,
      prepareStep,
      onFinish: async ({ text }) => {
        log.info("query stream finished", {
          model: modelName,
          sessionId: identity.sessionId,
          responseLength: text.trim().length,
        });

        if (!identity.sessionId) return;

        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const userContent =
          typeof lastUser?.content === "string" ? lastUser.content : "";

        const turns = [];
        if (userContent) {
          turns.push({ role: "user", message: userContent });
        }
        if (text.trim()) {
          turns.push({ role: "bot", message: text.trim() });
        }

        await appendTurns(identity.sessionId, identity, turns);
      },
    });

    if (body.stream === false) {
      const text = await result.text;
      return c.json({
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
      });
    }

    return createOpenAIStreamResponse(result.textStream, modelName);
  } catch (error) {
    logError(log, "query stream failed", error, { model: modelName });
    return c.json({ error: "Query processing failed" }, 500);
  }
}
