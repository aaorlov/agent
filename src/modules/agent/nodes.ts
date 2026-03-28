import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, BaseMessage, AIMessageChunk } from "@langchain/core/messages";
import { interrupt, LangGraphRunnableConfig } from "@langchain/langgraph";
import { concat } from '@langchain/core/utils/stream';
import { AgentState } from "./state";
import { AgentResume } from "./types";
import { AgentStatusPhase, CustomEventType, MessageRole, ToolAction } from "./enums";
import { env } from "@/config";
import { toLC } from "./utils";

const llm = new ChatAnthropic({
  model: env.ANTROPIC_MODEL,
  apiKey: env.ANTROPIC_API_KEY,
});

export const callModel = async (state: AgentState, config: LangGraphRunnableConfig): Promise<Partial<AgentState>> => {
  const messages: BaseMessage[] = [];

  if (state.systemPrompt) {
    messages.push(new SystemMessage({ content: state.systemPrompt }));
  }

  for (const m of state.messages) {
    messages.push(toLC(m));
  }

  let fullMessage: AIMessageChunk | undefined;
  const llmStream = await llm.stream(messages);
  for await (const chunk of llmStream) {
    fullMessage = fullMessage ? concat(fullMessage, chunk) : chunk;

    if(chunk.content) config.writer?.({ type: CustomEventType.TextDelta, content: chunk.content, messageId: fullMessage.id });
  }

  const content = typeof fullMessage?.content === "string" ? fullMessage.content : fullMessage ? JSON.stringify(fullMessage.content) : "";
  
  return {
    messages: [
      {
        id: fullMessage?.id ?? crypto.randomUUID(),
        role: MessageRole.Assistant,
        content,
      },
    ],
  };
}

