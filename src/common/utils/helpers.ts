import type { Context } from "hono";

export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/** Format Zod validation result into a 400 JSON response. Use in zValidator callback when result.success is false. */
export const validationError = <T>(
  result: { success: false; error: { issues: T[] } },
  c: Context
): Response => c.json({ error: "Invalid Request", issues: result.error.issues }, 400);