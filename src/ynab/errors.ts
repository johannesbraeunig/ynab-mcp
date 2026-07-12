import { z } from "zod";

/**
 * The `ynab` SDK throws the raw parsed error body on non-2xx responses:
 * `{ error: { id, name, detail } }`, where `id` mirrors the HTTP status code
 * as a string. See node_modules/ynab/dist/runtime.js: `throw await response.json()`.
 */
const ynabErrorBodySchema = z.object({
  error: z.object({
    id: z.string(),
    name: z.string(),
    detail: z.string(),
  }),
});

export class YnabToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "YnabToolError";
  }
}

export function mapYnabError(err: unknown): YnabToolError {
  const parsed = ynabErrorBodySchema.safeParse(err);
  if (parsed.success) {
    const { id, detail } = parsed.data.error;
    switch (id) {
      case "401":
        return new YnabToolError(
          "YNAB access token is invalid or expired. Check the YNAB_ACCESS_TOKEN environment variable.",
          id,
          false,
        );
      case "403":
        return new YnabToolError(detail, id, false);
      case "404":
        return new YnabToolError(
          "No budget/account/category/transaction found with that id.",
          id,
          false,
        );
      case "429":
        return new YnabToolError(
          "YNAB API rate limit reached (200 requests/hour per token). Try again later.",
          id,
          true,
        );
      default:
        return new YnabToolError(detail, id, false);
    }
  }

  if (err instanceof Error) {
    return new YnabToolError(`Network or unexpected error: ${err.message}`, "network_error", true);
  }

  return new YnabToolError("Unknown error contacting the YNAB API.", "unknown_error", true);
}
