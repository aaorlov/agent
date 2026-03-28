import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, BaseMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { AgentState } from "./state";
import { AgentResume } from "./types";
import { AgentStatusPhase, MessageRole, ToolAction } from "./enums";
import { env } from "@/config";
import { toLC } from "./utils";

const llm = new ChatAnthropic({
  model: env.ANTROPIC_MODEL,
  apiKey: env.ANTROPIC_API_KEY,
});

export async function callModel(
  state: AgentState
): Promise<Partial<AgentState>> {
  const messages: BaseMessage[] = [];

  if (state.systemPrompt) {
    messages.push(new SystemMessage({ content: state.systemPrompt }));
  }

  for (const m of state.messages) {
    messages.push(toLC(m));
  }

  const response = await llm.invoke(messages);
  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return {
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Assistant,
        content,
      },
    ],
  };
}

/**
 * Stub: creates an assistant message with a tool call that requires approval.
 * Replace with real LLM + tool-binding logic.
 */
export async function executeTool(
  state: AgentState
): Promise<Partial<AgentState>> {
  const toolCallId = crypto.randomUUID();
  const toolName = "example_approval_tool";
  const args = { message: "Executing tool" };

  return {
    status: AgentStatusPhase.Executing,
    pendingTools: [{ toolCallId, toolName, args, requiresApproval: true }],
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Assistant,
        content: "",
        toolCalls: [{ toolCallId, toolName, args, requiresApproval: true }],
      },
    ],
  };
}

/**
 * Interrupt for human approval, then append a ToolMessage with the resolution.
 */
export async function requestApproval(
  state: AgentState
): Promise<Partial<AgentState>> {
  const pending = state.pendingTools;
  if (!pending.length) {
    return { status: null, pendingTools: [] };
  }

  const tool = pending[0];
  const resumeValue = interrupt({
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    args: tool.args,
  }) as AgentResume | undefined;

  return {
    status: AgentStatusPhase.ToolResult,
    pendingTools: [],
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Tool,
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        result: resumeValue?.modifiedArgs ?? {},
        action: resumeValue?.action ?? ToolAction.Approved,
      },
    ],
  };
}

export async function respond(
  state: AgentState
): Promise<Partial<AgentState>> {
  return {
    status: null,
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Assistant,
        content: "Response based on conversation and tool results.",
      },
    ],
  };
}
