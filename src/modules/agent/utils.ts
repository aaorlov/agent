import { Command } from "@langchain/langgraph";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";

import { MessageRole } from "./enums";
import type { AgentMessage, AgentRunInput } from "./types";

export const toLC = (msg: AgentMessage): BaseMessage => {
  switch (msg.role) {
    case MessageRole.Human:
      return new HumanMessage({ content: msg.content });
    case MessageRole.System:
      return new SystemMessage({ content: msg.content });
    case MessageRole.Assistant:
      return new AIMessage({
        content: msg.content,
        tool_calls: msg.toolCalls?.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          args: tc.args,
        })),
      });
    case MessageRole.Tool:
      return new ToolMessage({
        content: typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result),
        tool_call_id: msg.toolCallId,
        name: msg.toolName,
      });
  }
}
  
export const toAgentInput = (input: AgentRunInput) => {
  if(input.resume) {
    return new Command({ resume: input.resume });
  }
  return {
    messages: input.messages,
    status: null,
    pendingTools: [],
  }
}