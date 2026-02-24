/**
 * SSE chat: stream agent runs and handle approve/reject via separate endpoints.
 * Emits Cursor-style events (Vercel AI SDK–aligned): session, status, text-delta, text-end, tool-call, approval-requested, tool-result, finish, error.
 */

import { createInterruptibleGraph, Command, MemorySaver, type AgentState } from "../../agent.js";
import { HumanMessage } from "@langchain/core/messages";
import { SSEEventType, StatusCode, FinishReason } from "../../common/enums/sse.js";
import type { SSEEvent } from "./events.js";
import { normalizeInterruptToToolCall } from "./events.js";

export type { SSEEvent } from "./events.js";

const checkpointer = new MemorySaver();
const graph = createInterruptibleGraph(checkpointer);

function lastMessageText(state: AgentState): string {
  const last = state.messages?.[state.messages.length - 1];
  return last && "content" in last && typeof last.content === "string" ? last.content : "";
}

function hasInterrupt(chunk: unknown): unknown[] | null {
  const interrupt = (chunk as { __interrupt__?: unknown[] }).__interrupt__;
  return interrupt && Array.isArray(interrupt) && interrupt.length > 0 ? interrupt : null;
}

export type StreamTrigger =
  | { type: "message"; text: string; threadId: string }
  | { type: "approve"; threadId: string; payload?: unknown; toolCallId?: string }
  | { type: "reject"; threadId: string; toolCallId?: string };

export async function* streamChatEvents(trigger: StreamTrigger): AsyncGenerator<SSEEvent> {
  const config = { configurable: { thread_id: trigger.threadId } };

  try {
    if (trigger.type === "message") {
      const input: AgentState = {
        messages: [new HumanMessage(trigger.text)],
        sessionId: trigger.threadId,
        context: {},
      };
      const stream = await graph.stream(input, config);
      let lastSent = "";
      let lastState: AgentState | null = null;

      yield { type: SSEEventType.Status, message: "Planning", code: StatusCode.Thinking };

      for await (const chunk of stream) {
        const state = chunk as AgentState;
        lastState = state;
        const interrupt = hasInterrupt(chunk);

        if (interrupt) {
          const value = interrupt[0];
          const tool = normalizeInterruptToToolCall(value);
          yield { type: SSEEventType.ToolCall, toolCallId: tool.toolCallId, toolName: tool.toolName, args: tool.args };
          yield {
            type: SSEEventType.ApprovalRequested,
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            args: tool.args,
          };
          return;
        }

        const text = lastMessageText(state);
        if (text && text !== lastSent) {
          const content = lastSent ? text.slice(lastSent.length) : text;
          lastSent = text;
          if (content) yield { type: SSEEventType.TextDelta, content };
        }
      }

      yield { type: SSEEventType.TextEnd };
      yield { type: SSEEventType.Finish, finishReason: FinishReason.Stop };
      return;
    }

    if (trigger.type === "approve" || trigger.type === "reject") {
      const resumeValue =
        trigger.type === "approve" ? (trigger.payload ?? { approved: true }) : { approved: false };
      const stream = await graph.stream(new Command({ resume: resumeValue }), config);
      let lastSent = "";
      let lastState: AgentState | null = null;
      const toolCallId = trigger.toolCallId ?? "approve_action";
      const approved = trigger.type === "approve";

      yield { type: SSEEventType.Status, message: approved ? "Applying" : "Cancelling", code: StatusCode.Executing };

      for await (const chunk of stream) {
        const state = chunk as AgentState;
        lastState = state;
        const interrupt = hasInterrupt(chunk);
        if (interrupt) {
          const value = interrupt[0];
          const tool = normalizeInterruptToToolCall(value);
          yield { type: SSEEventType.ToolCall, toolCallId: tool.toolCallId, toolName: tool.toolName, args: tool.args };
          yield {
            type: SSEEventType.ApprovalRequested,
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            args: tool.args,
          };
          return;
        }

        const text = lastMessageText(state);
        if (text && text !== lastSent) {
          const content = lastSent ? text.slice(lastSent.length) : text;
          lastSent = text;
          if (content) yield { type: SSEEventType.TextDelta, content };
        }
      }

      yield { type: SSEEventType.TextEnd };
      yield {
        type: SSEEventType.ToolResult,
        toolCallId,
        result: lastState?.context ?? (approved ? { applied: true } : { applied: false }),
      };
      yield {
        type: SSEEventType.Finish,
        finishReason: approved ? FinishReason.Stop : FinishReason.Error,
      };
    }
  } catch (err) {
    yield {
      type: SSEEventType.Error,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Generate a new thread id for a new conversation. */
export function newThreadId(): string {
  return crypto.randomUUID();
}
