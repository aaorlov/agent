import { ToolAction } from "@/modules/agent/enums";
import { SSEEventType, FinishReason } from "./enums";

export type SSEEvent =
  | { type: SSEEventType.Session; threadId: string }
  | { type: SSEEventType.TextDelta; content: string; id: string }
  | { type: SSEEventType.TextEnd; content: string; id: string }
  | {
      type: SSEEventType.ToolCall;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      messageId: string;
    }
  | {
      type: SSEEventType.ToolResult;
      id: string;
      toolCallId: string;
      toolName: string;
      action: ToolAction;
      result: unknown;
      createdAt: string;
      error?: string;
    }
  | {
      type: SSEEventType.ApprovalRequired;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      description: string;
    }
  | {
      type: SSEEventType.ContextRetrieved;
      documents: Array<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
        score?: number;
      }>;
    }
  | { type: SSEEventType.Error; message: string; code?: string }
  | {
      type: SSEEventType.Finish;
      finishReason: FinishReason;
      usage?: { promptTokens: number; completionTokens: number };
    };
