import {
  StateGraph,
  MemorySaver,
  Command,
  END,
  START,
} from "@langchain/langgraph";
import { AIMessageChunk } from "@langchain/core/messages";
import { AgentStateAnnotation, AgentState } from "./state";
import { AgentRunInput, AgentStreamEvent } from "./types";
import {
  callModel,
  executeTool,
  requestApproval,
  respond,
} from "./nodes";

const checkpointer = new MemorySaver();

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("call_model", callModel)
  .addNode("execute_tool", executeTool)
  .addNode("request_approval", requestApproval)
  .addNode("respond", respond)
  .addEdge(START, "call_model")
  .addEdge("call_model", "execute_tool")
  .addEdge("execute_tool", "request_approval")
  .addEdge("request_approval", "respond")
  .addEdge("respond", END);

export const agentGraph = workflow.compile({ checkpointer });

export type AgentGraph = typeof agentGraph;

export async function getThreadState(
  threadId: string
): Promise<{ values: Partial<AgentState> }> {
  const config = { configurable: { thread_id: threadId } };
  try {
    const snapshot = await agentGraph.getState(config);
    return { values: snapshot.values ?? {} };
  } catch {
    return { values: {} };
  }
}

export function toGraphInput(
  input: AgentRunInput
): Record<string, unknown> | Command {
  if (input.resume) {
    return new Command({ resume: input.resume });
  }
  return {
    messages: input.messages,
    status: null,
    pendingTools: [],
  };
}

export async function* streamAgent(
  input: AgentRunInput,
  options: { signal?: AbortSignal }
): AsyncGenerator<AgentStreamEvent> {
  const streamOptions = {
    configurable: { thread_id: input.threadId },
    signal: options.signal,
    streamMode: ["updates", "messages"] as ("updates" | "messages")[],
  };

  const graphInput = toGraphInput(input);
  const stream = await agentGraph.stream(graphInput, streamOptions);

  for await (const [mode, data] of stream) {
    if (mode === "messages") {
      yield {
        mode: "messages" as const,
        data: data as [AIMessageChunk, { langgraph_node: string }],
      };
    } else {
      yield {
        mode: "updates" as const,
        data: data as Record<string, Partial<AgentState>>,
      };
    }
  }
}
