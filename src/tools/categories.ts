import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YnabClient } from "../ynab/client.js";
import { budgetIdSchema } from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { jsonToolResult, READ_ONLY, withYnabErrorHandling } from "./helpers.js";

export function registerCategoryTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_categories",
    {
      title: "List YNAB categories",
      description:
        "List all category groups and categories in a budget, with budgeted/activity/balance figures (in milliunits) for the current month.",
      inputSchema: { budget_id: budgetIdSchema },
      annotations: READ_ONLY,
    },
    async ({ budget_id }: { budget_id: string }) =>
      withYnabErrorHandling(async () => {
        const groups = await ynab.listCategories(budget_id);
        const summary = groups
          .filter((g) => !g.deleted)
          .map((g) => ({
            id: g.id,
            name: g.name,
            hidden: g.hidden,
            categories: g.categories
              .filter((c) => !c.deleted)
              .map((c) => ({
                id: c.id,
                name: c.name,
                hidden: c.hidden,
                budgeted: milliunitsBrand.parse(c.budgeted),
                activity: milliunitsBrand.parse(c.activity),
                balance: milliunitsBrand.parse(c.balance),
              })),
          }));
        return jsonToolResult(summary);
      }),
  );
}
