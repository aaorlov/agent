import {
  StateGraph,
  MemorySaver,
  END,
  START,
} from "@langchain/langgraph";
import { AgentStateAnnotation, AgentState } from "./state";
import { AgentRunInput, AgentStreamEvent } from "./types";
import { callModel } from "./nodes";
import { toAgentInput } from "./utils";
import { StreamMode } from "./enums";

const checkpointer = new MemorySaver();

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("call_model", callModel)
  .addEdge(START, "call_model")
  .addEdge("call_model", END);

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

export async function* streamAgent(
  input: AgentRunInput,
  options: { signal?: AbortSignal }
): AsyncGenerator<AgentStreamEvent> {
  const streamOptions = {
    configurable: { thread_id: input.threadId },
    signal: options.signal,
    streamMode: [StreamMode.Updates, StreamMode.Custom] as (StreamMode)[],
  };

  const agentInput = toAgentInput(input);
  const stream = await agentGraph.stream(
    agentInput as Parameters<AgentGraph["stream"]>[0],
    streamOptions,
  )

  for await (const [mode, data] of stream) {
    yield { mode, data}
  }
}
