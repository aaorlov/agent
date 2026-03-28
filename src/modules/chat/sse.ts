import type { SSEStreamingApi } from "hono/streaming";
import { streamAgent, MessageRole, AgentStatusPhase } from "@/modules/agent";
import { CustomEventType } from "@/modules/agent/enums";
import type { CustomEventData } from "@/modules/agent/types";
import type {
  AgentState,
  AgentRunInput,
  AgentMessage,
  AssistantMessage
} from "@/modules/agent";

import type { ChatRequest } from "./schemas";
import { ChatRequestType } from "./schemas";
import type { SSEEvent } from "./events.js";
import { SSEEventType, FinishReason } from "./events";
import { sseEventToMessage } from "./utils";

// ---------------------------------------------------------------------------
// Request → AgentRunInput
// ---------------------------------------------------------------------------

const toAgentInput = (
  threadId: string,
  body: ChatRequest
): AgentRunInput => {
  const agentInput: AgentRunInput = {
    threadId,
    messages: [],
  };
  switch(body.type) {
    case ChatRequestType.ToolAction:
      agentInput.resume = {
        toolCallId: body.toolCallId,
        action: body.action,
        modifiedArgs: body.modifiedArgs,
      };
      break;
    case ChatRequestType.Message:
      agentInput.messages.push({
        id: crypto.randomUUID(),
        role: MessageRole.Human,
        content: body.content,
      });
      break;
    default:
      throw new Error(`Invalid chat request type: ${body}`);
  }

  return agentInput;
}

// ---------------------------------------------------------------------------
// Agent state updates → SSE events
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<AgentStatusPhase, string> = {
  [AgentStatusPhase.Planning]: "Planning",
  [AgentStatusPhase.Thinking]: "Thinking",
  [AgentStatusPhase.Executing]: "Executing tool",
  [AgentStatusPhase.ToolResult]: "Tool result",
};

function* updateAgentStateToSSEEvents(
  chunk: Record<string, Partial<AgentState>>
): Generator<SSEEvent> {
  for (const [nodeName, u] of Object.entries(chunk)) {
    if (!u || typeof u !== "object") continue;

    if (u.status) {
      yield {
        type: SSEEventType.Status,
        code: u.status,
        message: STATUS_LABELS[u.status],
      };
    }

    if (Array.isArray(u.pendingTools)) {
      for (const tool of u.pendingTools) {
        if (tool.requiresApproval) {
          yield {
            type: SSEEventType.ApprovalRequired,
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            args: tool.args,
            description: `Execute ${tool.toolName}`,
          };
        }
      }
    }

    if (Array.isArray(u.retrievedContext) && u.retrievedContext.length) {
      yield {
        type: SSEEventType.ContextRetrieved,
        documents: u.retrievedContext.map((doc) => ({
          id: doc.id,
          snippet: doc.content,
          score: doc.score,
        })),
      };
    }

    if (Array.isArray(u.messages)) {
      for (const msg of u.messages) {
        if (msg.role === MessageRole.Assistant) {
          const am = msg as AssistantMessage;

          if (am.toolCalls?.length) {
            for (const tc of am.toolCalls) {
              yield {
                type: SSEEventType.ToolCall,
                messageId: am.id,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                args: tc.args,
              };
            }
          }

          if (am.content) {
            yield {
              type: SSEEventType.TextEnd,
              messageId: am.id,
              content: am.content,
            };
          }
        }

        if (msg.role === MessageRole.Tool) {
          yield {
            type: SSEEventType.ToolResult,
            toolCallId: msg.toolCallId,
            toolName: msg.toolName,
            action: msg.action,
            result: msg.result,
            error: msg.error,
          };
        }
      }
    }
  }
}
// ---------------------------------------------------------------------------
// Custom events → SSE events
// ---------------------------------------------------------------------------
function customEventToSSEEvent(
  event: CustomEventData
): SSEEvent | null {
  switch(event.type) {
    case CustomEventType.TextDelta:
      return { type: SSEEventType.TextDelta, content: event.content, messageId: event.messageId };
    default:
      return null;
  }
}
// ---------------------------------------------------------------------------
// Public streaming generators
// ---------------------------------------------------------------------------

export async function* streamChatEvents(
  body: ChatRequest,
  threadId: string,
  signal: AbortSignal
): AsyncGenerator<SSEEvent> {
  const input = await toAgentInput(threadId, body);

  try {
    let hadApprovalRequest = false;

    for await (const event of streamAgent(input, { signal })) {
      if (event.mode === "custom") {
        const sseEvent = customEventToSSEEvent(event.data);
        console.log("custom event", sseEvent);
        if(sseEvent) yield sseEvent;
      } 
      if(event.mode === "updates") {
        for (const ev of updateAgentStateToSSEEvents(event.data)) {
          if (ev.type === SSEEventType.ApprovalRequired) hadApprovalRequest = true;
          yield ev;
        }
      }
    }

    yield {
      type: SSEEventType.Finish,
      finishReason: hadApprovalRequest
        ? FinishReason.Approval
        : FinishReason.Stop,
    };
  } catch (err) {
    yield {
      type: SSEEventType.Error,
      message: err instanceof Error ? err.message : "Unknown error",
    };
    yield { type: SSEEventType.Finish, finishReason: FinishReason.Error };
  }
}

export const handleChatStream = async (
  body: ChatRequest,
  stream: SSEStreamingApi,
  signal: AbortSignal
): Promise<void> => {
  const threadId = body.threadId || crypto.randomUUID();

  if (!body.threadId) {
    await stream.writeSSE(
      sseEventToMessage({ type: SSEEventType.Session, threadId })
    );
  }

  for await (const ev of streamChatEvents(body, threadId, signal)) {
    if (signal.aborted) {
      await stream.writeSSE(
        sseEventToMessage({
          type: SSEEventType.Finish,
          finishReason: FinishReason.Abort,
        })
      );
      break;
    }
    await stream.writeSSE(sseEventToMessage(ev));
  }
};
