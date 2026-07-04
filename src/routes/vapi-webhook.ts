import type { Context } from "hono";
import { getEnv } from "../lib/env";
import { summarizeConversation } from "../lib/ai/summarize";
import { saveConversationHistory } from "../lib/db/conversation";
import {
  findOrCreateUserProfileByPhone,
  formatProfileForPrompt,
  getUserProfileById,
} from "../lib/db/user";
import { getLongTermMemory } from "../lib/memory/conversation-memory";
import { createComponentLogger, logError } from "../lib/logger";

const log = createComponentLogger("vapi-webhook");

interface VapiMessage {
  type: string;
  call?: {
    id?: string;
    customer?: { number?: string };
    phoneNumber?: { number?: string };
  };
  customer?: { number?: string; metadata?: { user_id?: string } };
  user_data?: { user_id?: string };
  artifact?: {
    messages?: Array<{ role: string; content?: string; message?: string }>;
  };
}

interface VapiPayload {
  message?: VapiMessage;
}

function extractPhone(message: VapiMessage): string | undefined {
  return (
    message.customer?.number ??
    message.call?.customer?.number ??
    message.call?.phoneNumber?.number
  );
}

function extractUserId(message: VapiMessage): string | undefined {
  return message.user_data?.user_id ?? message.customer?.metadata?.user_id;
}

export async function handleVapiWebhook(c: Context) {
  const payload = await c.req.json<VapiPayload>();
  const message = payload.message;

  if (!message) {
    return c.json({ error: "Invalid VAPI payload" }, 400);
  }

  const phoneNumber = extractPhone(message);
  let userId = extractUserId(message);
  const callId = message.call?.id;

  switch (message.type) {
    case "assistant-request": {
      let contextString = "No profile data available yet.";

      if (phoneNumber) {
        try {
          const profile = await findOrCreateUserProfileByPhone(phoneNumber);
          userId = profile.id;
          const longTerm = await getLongTermMemory({
            userId: profile.id,
            phoneNumber,
          });
          contextString = `${formatProfileForPrompt(profile)}

LONG-TERM MEMORY:
${longTerm}`;
        } catch (err) {
          logError(log, "assistant-request profile lookup failed", err, {
            phoneNumber,
            userId,
          });
        }
      } else if (userId) {
        const profile = await getUserProfileById(userId);
        const longTerm = await getLongTermMemory({ userId });
        contextString = `${formatProfileForPrompt(profile)}

LONG-TERM MEMORY:
${longTerm}`;
      }

      const assistantId = getEnv().VAPI_ASSISTANT_ID ?? "5f629cec-1e52-4fa8-b720-3ce22b5a6601";

      return c.json({
        assistantId,
        assistantOverrides: {
          variableValues: {
            previous_history: contextString,
            user_id: userId ?? "",
            phone_number: phoneNumber ?? "",
          },
        },
      });
    }

    case "end-of-call-report": {
      const transcriptMessages = (message.artifact?.messages ?? [])
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role,
          message: msg.message ?? msg.content ?? "",
        }));

      if (!userId && phoneNumber) {
        const profile = await findOrCreateUserProfileByPhone(phoneNumber);
        userId = profile.id;
      }

      if (!userId || !callId) {
        log.warn("end-of-call-report missing identity or call id", {
          userId,
          phoneNumber,
          callId,
        });
        return c.json({ error: "Missing identity or call id" }, 400);
      }

      const summary = await summarizeConversation(transcriptMessages);

      await saveConversationHistory({
        userId,
        phoneNumber,
        sessionId: callId,
        source: "vapi",
        transcript: transcriptMessages,
        summary,
      });

      return c.json({ status: "success", callId, summarized: true });
    }

    default:
      return c.json({ status: "ignored", type: message.type });
  }
}
