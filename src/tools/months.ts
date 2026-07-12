import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YnabClient } from "../ynab/client.js";
import { budgetIdSchema, monthSchema } from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { jsonToolResult, READ_ONLY, withYnabErrorHandling } from "./helpers.js";

export function registerMonthTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_months",
    {
      title: "List YNAB budget months",
      description:
        "List summary figures (income/budgeted/activity/to_be_budgeted, in milliunits) for every month in a budget's history.",
      inputSchema: { budget_id: budgetIdSchema },
      annotations: READ_ONLY,
    },
    async ({ budget_id }: { budget_id: string }) =>
      withYnabErrorHandling(async () => {
        const months = await ynab.listMonths(budget_id);
        const summary = months
          .filter((m) => !m.deleted)
          .map((m) => ({
            month: m.month,
            income: milliunitsBrand.parse(m.income),
            budgeted: milliunitsBrand.parse(m.budgeted),
            activity: milliunitsBrand.parse(m.activity),
            to_be_budgeted: milliunitsBrand.parse(m.to_be_budgeted),
            age_of_money: m.age_of_money,
          }));
        return jsonToolResult(summary);
      }),
  );

  server.registerTool(
    "ynab_get_month",
    {
      title: "Get a YNAB budget month",
      description:
        "Get summary figures for one budget month plus every category's budgeted/activity/balance for that month (all in milliunits).",
      inputSchema: {
        budget_id: budgetIdSchema,
        month: monthSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ budget_id, month }: { budget_id: string; month: string }) =>
      withYnabErrorHandling(async () => {
        const m = await ynab.getMonth(budget_id, month);
        return jsonToolResult({
          month: m.month,
          income: milliunitsBrand.parse(m.income),
          budgeted: milliunitsBrand.parse(m.budgeted),
          activity: milliunitsBrand.parse(m.activity),
          to_be_budgeted: milliunitsBrand.parse(m.to_be_budgeted),
          age_of_money: m.age_of_money,
          categories: m.categories
            .filter((c) => !c.deleted)
            .map((c) => ({
              id: c.id,
              name: c.name,
              category_group_name: c.category_group_name,
              budgeted: milliunitsBrand.parse(c.budgeted),
              activity: milliunitsBrand.parse(c.activity),
              balance: milliunitsBrand.parse(c.balance),
            })),
        });
      }),
  );
}
