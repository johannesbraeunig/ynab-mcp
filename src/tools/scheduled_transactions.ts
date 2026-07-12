import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YnabClient } from "../ynab/client.js";
import { budgetIdSchema } from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { jsonToolResult, READ_ONLY, withYnabErrorHandling } from "./helpers.js";

export function registerScheduledTransactionTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_scheduled_transactions",
    {
      title: "List YNAB scheduled transactions",
      description:
        "List all upcoming scheduled (future-dated, recurring) transactions in a budget.",
      inputSchema: { budget_id: budgetIdSchema },
      annotations: READ_ONLY,
    },
    async ({ budget_id }: { budget_id: string }) =>
      withYnabErrorHandling(async () => {
        const scheduled = await ynab.listScheduledTransactions(budget_id);
        const summary = scheduled
          .filter((s) => !s.deleted)
          .map((s) => ({
            id: s.id,
            date_next: s.date_next,
            frequency: s.frequency,
            amount: milliunitsBrand.parse(s.amount),
            amount_formatted: s.amount_formatted,
            payee_name: s.payee_name,
            category_name: s.category_name,
            account_name: s.account_name,
            memo: s.memo,
          }));
        return jsonToolResult(summary);
      }),
  );
}
