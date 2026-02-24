import {
  StateGraph,
  END,
  START,
  interrupt,
  Command,
  MemorySaver,
} from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import type { ChatMessage, UIMessage } from "@/modules/chat/schemas.js";
import { AgentNode } from "@/common/enums";

export { Command, MemorySaver };

/** Context may include pendingToolCalls when the agent is waiting for user approval */
export interface AgentContext extends Record<string, unknown> {
  uiMessages?: UIMessage[];
  pendingToolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>;
}

export interface AgentState {
  messages: BaseMessage[];
  sessionId: string;
  context?: AgentContext;
}

// Simple agent node - replace with your actual agent logic
// To request user approval (Cursor-style), return { context: { pendingToolCalls: [{ toolCallId, toolName, input }] } } and the route will stream them and pause.
async function agentNode(state: AgentState): Promise<Partial<AgentState>> {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  // This is a placeholder - replace with your actual LLM/agent logic
  // For example, you might use OpenAI, Anthropic, or another provider
  const response = `I received your message: "${lastMessage.content}". This is a placeholder response. Please integrate your actual LLM provider here.`;

  return {
    messages: [...messages, new AIMessage(response)],
  };
}

// Create the LangGraph workflow
export function createAgentGraph() {
  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: {
        reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
      sessionId: {
        reducer: (x: string, y: string) => y || x,
        default: () => crypto.randomUUID(),
      },
      context: {
        reducer: (x: Record<string, unknown> | undefined, y: Record<string, unknown> | undefined) => 
          y ? { ...(x || {}), ...y } : x,
        default: () => ({}),
      },
    },
  });

  workflow.addNode(AgentNode.Agent as "agent", agentNode);
  workflow.addEdge(START, AgentNode.Agent as "agent");
  workflow.addEdge(AgentNode.Agent as "agent", END);

  return workflow.compile();
}

const APPROVAL_WAIT_MS = 60_000;

/** Interruptible graph: Plan -> Propose (interrupt) -> Apply. Use with checkpointer + thread_id. */
export function createInterruptibleGraph(checkpointer: InstanceType<typeof MemorySaver>) {
  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: {
        reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
      sessionId: {
        reducer: (x: string, y: string) => y || x,
        default: () => crypto.randomUUID(),
      },
      context: {
        reducer: (x: Record<string, unknown> | undefined, y: Record<string, unknown> | undefined) =>
          y ? { ...(x || {}), ...y } : x,
        default: () => ({}),
      },
    },
  });

  async function planNode(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    return {
      messages: [
        ...state.messages,
        new AIMessage(`I will edit the file based on: "${lastMessage.content}"`),
      ],
      context: { ...state.context, plan: "edit_file" },
    };
  }

  async function proposeNode(state: AgentState): Promise<Partial<AgentState>> {
    const approved = interrupt({
      question: "Approve this change?",
      diff: "(placeholder diff - replace with real proposal)",
    }) as { approved?: boolean } | boolean;
    const ok = typeof approved === "object" && approved !== null && "approved" in approved
      ? (approved as { approved: boolean }).approved
      : Boolean(approved);
    return {
      messages: [
        ...state.messages,
        new AIMessage(ok ? "Applying changes..." : "Change cancelled."),
      ],
      context: { ...state.context, approved: ok },
    };
  }

  async function applyNode(state: AgentState): Promise<Partial<AgentState>> {
    const approved = (state.context?.approved as boolean) ?? false;
    return {
      messages: [
        ...state.messages,
        new AIMessage(approved ? "Done. Changes applied." : "No changes made."),
      ],
    };
  }

  workflow.addNode(AgentNode.Plan as "plan", planNode);
  workflow.addNode(AgentNode.Propose as "propose", proposeNode);
  workflow.addNode(AgentNode.Apply as "apply", applyNode);
  workflow.addEdge(START, AgentNode.Plan as "plan");
  workflow.addEdge(AgentNode.Plan as "plan", AgentNode.Propose as "propose");
  workflow.addEdge(AgentNode.Propose as "propose", AgentNode.Apply as "apply");
  workflow.addEdge(AgentNode.Apply as "apply", END);

  return workflow.compile({ checkpointer });
}

export { APPROVAL_WAIT_MS };

/** Payload for processMessage: supports full conversation for approval continuation */
export type ProcessMessagePayload = ChatMessage & { messages?: UIMessage[] };

// Process a chat message through the agent
export async function processMessage(
  graph: ReturnType<typeof createAgentGraph>,
  payload: ProcessMessagePayload
): Promise<AsyncIterable<Partial<AgentState>>> {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const humanMessage = new HumanMessage(payload.message);

  const context: AgentContext = { ...(payload.context as AgentContext | undefined) };
  if (payload.messages?.length) context.uiMessages = payload.messages;

  const initialState: AgentState = {
    messages: [humanMessage],
    sessionId,
    context,
  };

  return graph.stream(initialState);
}
