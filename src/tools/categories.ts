import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

  server.registerTool(
    "ynab_get_category",
    {
      title: "Get a YNAB category",
      description:
        "Get a single category by id, including budgeted/activity/balance and goal figures (in milliunits) for the current month.",
      inputSchema: {
        budget_id: budgetIdSchema,
        category_id: z.string().min(1).describe("YNAB category id"),
      },
      annotations: READ_ONLY,
    },
    async ({ budget_id, category_id }: { budget_id: string; category_id: string }) =>
      withYnabErrorHandling(async () => {
        const c = await ynab.getCategory(budget_id, category_id);
        return jsonToolResult({
          id: c.id,
          category_group_id: c.category_group_id,
          category_group_name: c.category_group_name,
          name: c.name,
          hidden: c.hidden,
          note: c.note,
          budgeted: milliunitsBrand.parse(c.budgeted),
          activity: milliunitsBrand.parse(c.activity),
          balance: milliunitsBrand.parse(c.balance),
          goal_type: c.goal_type,
          goal_target:
            c.goal_target !== undefined ? milliunitsBrand.parse(c.goal_target) : undefined,
          goal_target_month: c.goal_target_month,
          goal_percentage_complete: c.goal_percentage_complete,
        });
      }),
  );
}
