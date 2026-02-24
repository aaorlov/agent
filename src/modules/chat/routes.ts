import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { ChatRequestSchema } from "./schemas";
import { SSEEventType } from "@/common/enums";
import { validationError } from "@/common/utils";
import { streamChatEvents, newThreadId } from "./sse";
import { sseEventToMessage } from "./utils";


const chat = new Hono();

/** POST /chat — start or continue a conversation. Returns SSE: session, status, text-delta, text-end, tool-call, approval-requested, tool-result, finish, error. */
chat.post(
  "/",
  zValidator("json", ChatRequestSchema, (result, c) => {
    if (!result.success) return validationError(result, c);
  }),
  async (c) => {
    const body = c.req.valid("json");
    const message =
      typeof body.message === "string"
        ? body.message
        : body.messages?.filter((m) => m.role === "user").pop()?.parts?.find((p) => p.type === "text");
    const text =
      typeof message === "string" ? message : message && "text" in message ? (message as { text: string }).text : "";
    const threadId = body.thread_id ?? body.sessionId ?? newThreadId();

    return streamSSE(c, async (stream) => {
      const isNewThread = !body.thread_id && !body.sessionId;
      if (isNewThread) {
        await stream.writeSSE({
          event: SSEEventType.Session,
          data: JSON.stringify({ type: SSEEventType.Session, threadId }),
        });
      }

      for await (const ev of streamChatEvents({ type: "message", text, threadId })) {
        if (c.req.raw.signal.aborted) break;
        await stream.writeSSE(sseEventToMessage(ev));
      }
    });
  }
);

/** POST /chat/approve — approve tool execution (after approval-requested). Optional body.toolCallId to correlate tool-result. Returns SSE: status, text-delta, text-end, tool-result, finish, error. */
chat.post(
  "/approve",
  zValidator("json", ChatRequestSchema, (result, c) => {
    if (!result.success) return validationError(result, c);
  }),
  async (c) => {
    const { thread_id, payload, toolCallId } = c.req.valid("json");
    return streamSSE(c, async (stream) => {
      for await (const ev of streamChatEvents({ type: "approve", threadId: thread_id, payload, toolCallId })) {
        if (c.req.raw.signal.aborted) break;
        await stream.writeSSE(sseEventToMessage(ev));
      }
    });
  }
);

/** POST /chat/reject — cancel tool execution. Optional body.toolCallId to correlate tool-result. Returns SSE: status, text-delta, text-end, tool-result, finish, error. */
chat.post(
  "/reject",
  zValidator("json", ChatRequestSchema, (result, c) => {
    if (!result.success) return validationError(result, c);
  }),
  async (c) => {
    const { thread_id, toolCallId } = c.req.valid("json");
    return streamSSE(c, async (stream) => {
      for await (const ev of streamChatEvents({ type: "reject", threadId: thread_id, toolCallId })) {
        if (c.req.raw.signal.aborted) break;
        await stream.writeSSE(sseEventToMessage(ev));
      }
    });
  }
);


export { chat };
