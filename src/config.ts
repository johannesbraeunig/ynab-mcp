import { z } from "zod";

const configSchema = z.object({
  accessToken: z.string().min(1, "YNAB_ACCESS_TOKEN is required"),
  apiBaseUrl: z.string().url().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse({
    accessToken: env.YNAB_ACCESS_TOKEN,
    ...(env.YNAB_API_BASE_URL !== undefined && { apiBaseUrl: env.YNAB_API_BASE_URL }),
  });

  if (!result.success) {
    // stderr only: stdout is reserved for MCP JSON-RPC framing over stdio.
    console.error(
      "Invalid configuration: YNAB_ACCESS_TOKEN environment variable is missing or empty.",
    );
    process.exit(1);
  }

  return result.data;
}
