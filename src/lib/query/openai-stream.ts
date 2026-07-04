import type { ModelMessage } from "ai";

export interface OpenAIChatMessage {
  role: string;
  content?: string | unknown;
}

export interface QueryRequestBody {
  messages?: OpenAIChatMessage[];
  stream?: boolean;
  session_id?: string;
  user_id?: string;
  phone_number?: string;
  call?: {
    id?: string;
    customer?: {
      number?: string;
      metadata?: { user_id?: string };
    };
  };
  metadata?: {
    user_id?: string;
    phone_number?: string;
    session_id?: string;
  };
}

export function parseOpenAIMessages(messages: OpenAIChatMessage[]): ModelMessage[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content:
        typeof message.content === "string"
          ? message.content
          : message.content != null
            ? JSON.stringify(message.content)
            : "",
    }));
}

export function extractQueryIdentity(body: QueryRequestBody): {
  sessionId?: string;
  userId?: string;
  phoneNumber?: string;
} {
  return {
    sessionId:
      body.call?.id ??
      body.session_id ??
      body.metadata?.session_id,
    userId:
      body.user_id ??
      body.metadata?.user_id ??
      body.call?.customer?.metadata?.user_id,
    phoneNumber:
      body.phone_number ??
      body.metadata?.phone_number ??
      body.call?.customer?.number,
  };
}

export function createOpenAIStreamResponse(
  textStream: AsyncIterable<string>,
  model: string
): Response {
  const encoder = new TextEncoder();
  const completionId = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of textStream) {
          const payload = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
          };
          controller.enqueue(
            //encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            encoder.encode(`${chunk}`)
          );
        }

        const finishPayload = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(finishPayload)}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
