export enum ChatRequestType {
  Message = "message",
  ToolAction = "tool_action",
}

export enum SSEEventType {
  Session = "session",
  Status = "status",
  TextDelta = "text-delta",
  TextEnd = "text-end",
  ToolCall = "tool-call",
  ToolResult = "tool-result",
  ApprovalRequired = "approval-required",
  ContextRetrieved = "context-retrieved",
  Error = "error",
  Finish = "finish",
}

export enum FinishReason {
  Stop = "stop",
  Approval = "approval",
  Error = "error",
  Abort = "abort",
  MaxSteps = "max-steps",
}
