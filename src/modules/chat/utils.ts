import type { SSEEvent } from "./sse.js";

/** Map SSEEvent (discriminated by `type`) to SSE envelope: event = type, data = full payload JSON. */
export const sseEventToMessage = (ev: SSEEvent): { event: string; data: string } => ({
  event: ev.type,
  data: JSON.stringify(ev),
});
