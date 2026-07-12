import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YnabClient } from "../ynab/client.js";
import { budgetIdSchema } from "../schemas/common.js";
import { jsonToolResult, READ_ONLY, withYnabErrorHandling } from "./helpers.js";

export function registerBudgetTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_budgets",
    {
      title: "List YNAB budgets",
      description: "List all budgets accessible to the configured YNAB access token.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      withYnabErrorHandling(async () => {
        const budgets = await ynab.listBudgets();
        const summary = budgets.map((b) => ({
          id: b.id,
          name: b.name,
          last_modified_on: b.last_modified_on,
          first_month: b.first_month,
          last_month: b.last_month,
          currency_format: b.currency_format,
        }));
        return jsonToolResult(summary);
      }),
  );

  server.registerTool(
    "ynab_get_budget",
    {
      title: "Get a YNAB budget",
      description:
        "Get an overview of one budget: metadata plus counts of accounts/categories/payees/transactions. For the actual account, category, or transaction data, use ynab_list_accounts / ynab_list_categories / ynab_list_transactions instead — this tool intentionally does not return the full embedded export (which can be very large for budgets with long history).",
      inputSchema: { budget_id: budgetIdSchema },
      annotations: READ_ONLY,
    },
    async ({ budget_id }: { budget_id: string }) =>
      withYnabErrorHandling(async () => {
        const budget = await ynab.getBudget(budget_id);
        const count = (items: { deleted: boolean }[] | undefined) =>
          (items ?? []).filter((item) => !item.deleted).length;
        return jsonToolResult({
          id: budget.id,
          name: budget.name,
          last_modified_on: budget.last_modified_on,
          first_month: budget.first_month,
          last_month: budget.last_month,
          date_format: budget.date_format,
          currency_format: budget.currency_format,
          accounts_count: count(budget.accounts),
          category_groups_count: count(budget.category_groups),
          categories_count: count(budget.categories),
          payees_count: count(budget.payees),
          months_count: count(budget.months),
          transactions_count: count(budget.transactions),
          scheduled_transactions_count: count(budget.scheduled_transactions),
        });
      }),
  );
}
