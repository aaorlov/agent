import { SSEEventType, StatusCode, FinishReason } from "@/common/enums";

export type SSEEvent =
  // 1. Lifecycle & Identity
  | { type: SSEEventType.Session; threadId: string }
  | { type: SSEEventType.Status; message: string; code?: StatusCode }

  // 2. Content Streaming (Vercel AI SDK Standard)
  | { type: SSEEventType.TextDelta; content: string }
  | { type: SSEEventType.TextEnd; metadata?: Record<string, unknown> }

  // 3. Tool Orchestration (The "Cursor" Core)
  | { type: SSEEventType.ToolCall; toolCallId: string; toolName: string; args: unknown }
  | { type: SSEEventType.ToolResult; toolCallId: string; result: unknown }

  // 4. Human-in-the-Loop (LangGraph Interrupts)
  | { type: SSEEventType.ApprovalRequested; toolCallId: string; toolName: string; args: unknown }

  // 5. Termination
  | { type: SSEEventType.Error; message: string; code?: string }
  | { type: SSEEventType.Finish; finishReason: FinishReason };

/** Normalize interrupt value from the graph into tool-call shape (toolCallId, toolName, args). */
export function normalizeInterruptToToolCall(value: unknown): {
  toolCallId: string;
  toolName: string;
  args: unknown;
} {
  if (value !== null && typeof value === "object" && "toolName" in value) {
    const v = value as { toolName?: string; toolCallId?: string; args?: unknown; input?: unknown };
    return {
      toolCallId: typeof v.toolCallId === "string" ? v.toolCallId : crypto.randomUUID(),
      toolName: typeof v.toolName === "string" ? v.toolName : "approve_action",
      args: v.args ?? v.input ?? value,
    };
  }
  return {
    toolCallId: crypto.randomUUID(),
    toolName: "approve_action",
    args: value,
  };
}
