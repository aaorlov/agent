import type { SSEStreamingApi } from "hono/streaming";
import { streamAgent, MessageRole, AgentStatusPhase } from "@/modules/agent";
import type {
  AgentState,
  AgentRunInput,
  AgentMessage,
  AssistantMessage,
  ToolMessage,
} from "@/modules/agent";

import type { ChatRequest } from "./schemas";
import { ChatRequestType } from "./schemas";
import type { SSEEvent } from "./events.js";
import { SSEEventType, FinishReason } from "./events";
import { sseEventToMessage } from "./utils";

// ---------------------------------------------------------------------------
// Request → AgentRunInput
// ---------------------------------------------------------------------------

async function toAgentInput(
  threadId: string,
  body: ChatRequest
): Promise<AgentRunInput> {
  if (body.type === ChatRequestType.ToolAction) {
    return {
      threadId,
      messages: [],
      resume: {
        toolCallId: body.toolCallId,
        action: body.action,
        modifiedArgs: body.modifiedArgs,
      },
    };
  }

  const humanMessage: AgentMessage = {
    id: crypto.randomUUID(),
    role: MessageRole.Human,
    content: body.content,
  };

  return { threadId, messages: [humanMessage] };
}

// ---------------------------------------------------------------------------
// Agent state chunk → SSE events
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<AgentStatusPhase, string> = {
  [AgentStatusPhase.Planning]: "Planning",
  [AgentStatusPhase.Thinking]: "Thinking",
  [AgentStatusPhase.Executing]: "Executing tool",
  [AgentStatusPhase.ToolResult]: "Tool result",
};

function* chunkToSSEEvents(
  chunk: Record<string, Partial<AgentState>>,
  options?: { textStreamedNodes?: Set<string> }
): Generator<SSEEvent> {
  for (const [nodeName, u] of Object.entries(chunk)) {
    if (!u || typeof u !== "object") continue;

    const textAlreadyStreamed = options?.textStreamedNodes?.has(nodeName);

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

          if (!textAlreadyStreamed && am.content) {
            yield {
              type: SSEEventType.TextDelta,
              messageId: am.id,
              content: am.content,
            };
          }

          if (am.content || textAlreadyStreamed) {
            yield { type: SSEEventType.TextEnd, messageId: am.id };
          }
        }

        if (msg.role === MessageRole.Tool) {
          const tm = msg as ToolMessage;
          yield {
            type: SSEEventType.ToolResult,
            toolCallId: tm.toolCallId,
            toolName: tm.toolName,
            action: tm.action,
            result: tm.result,
            error: tm.error,
          };
        }
      }
    }
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
    const textStreamedNodes = new Set<string>();

    for await (const event of streamAgent(input, { signal })) {
      if (event.mode === "messages") {
        const [chunk, meta] = event.data;
        const text = typeof chunk.content === "string" ? chunk.content : "";
        if (text) {
          textStreamedNodes.add(meta.langgraph_node);
          yield { type: SSEEventType.TextDelta, content: text };
        }
      } else {
        for (const ev of chunkToSSEEvents(event.data, { textStreamedNodes })) {
          if (ev.type === SSEEventType.ApprovalRequired)
            hadApprovalRequest = true;
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
