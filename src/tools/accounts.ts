import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YnabClient } from "../ynab/client.js";
import { budgetIdSchema } from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { jsonToolResult, READ_ONLY, withYnabErrorHandling } from "./helpers.js";

export function registerAccountTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_accounts",
    {
      title: "List YNAB accounts",
      description:
        "List all accounts (checking, savings, credit card, etc.) in a budget, with balances in milliunits.",
      inputSchema: { budget_id: budgetIdSchema },
      annotations: READ_ONLY,
    },
    async ({ budget_id }: { budget_id: string }) =>
      withYnabErrorHandling(async () => {
        const accounts = await ynab.listAccounts(budget_id);
        const summary = accounts
          .filter((a) => !a.deleted)
          .map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            on_budget: a.on_budget,
            closed: a.closed,
            balance: milliunitsBrand.parse(a.balance),
            balance_formatted: a.balance_formatted,
          }));
        return jsonToolResult(summary);
      }),
  );

  server.registerTool(
    "ynab_get_account",
    {
      title: "Get a YNAB account",
      description: "Get a single account by id, with balances in milliunits.",
      inputSchema: {
        budget_id: budgetIdSchema,
        account_id: z.string().min(1).describe("YNAB account id"),
      },
      annotations: READ_ONLY,
    },
    async ({ budget_id, account_id }: { budget_id: string; account_id: string }) =>
      withYnabErrorHandling(async () => {
        const a = await ynab.getAccount(budget_id, account_id);
        return jsonToolResult({
          id: a.id,
          name: a.name,
          type: a.type,
          on_budget: a.on_budget,
          closed: a.closed,
          balance: milliunitsBrand.parse(a.balance),
          balance_formatted: a.balance_formatted,
        });
      }),
  );
}
