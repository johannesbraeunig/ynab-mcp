import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { mapYnabError } from "../ynab/errors.js";

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const CREATES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const UPDATES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function jsonToolResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorToolResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

export async function withYnabErrorHandling(
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return errorToolResult(mapYnabError(err).message);
  }
}
