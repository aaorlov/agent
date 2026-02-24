import { z } from "zod";
import { Environment } from "./common";

/**
 * Load environment variables from .env file for local development only.
 * Only runs when ENV is not set or is "dev".
 */
const isDev = !process.env.ENV || process.env.ENV === "dev";

if (isDev) {
  const envFile = Bun.file(".env");
  if (await envFile.exists()) {
    const text = await envFile.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          const value = trimmed.slice(eqIndex + 1).replace(/^["']|["']$/g, "");
          // Don't override existing env vars (system/runtime takes precedence)
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  }
}

/**
 * Environment configuration schema with Zod validation
 */
const envSchema = z.object({
  ENV: z
    .enum(Environment)
    .default(Environment.DEV),
  PORT: z
    .string()
    .default("8000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive())
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables
 */
function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = parseEnv();
