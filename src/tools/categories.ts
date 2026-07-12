import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YnabClient } from "../ynab/client.js";
import {
  budgetIdSchema,
  lastKnowledgeOfServerSchema,
  milliunitsSchema,
  monthSchema,
} from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { CREATES, jsonToolResult, READ_ONLY, UPDATES, withYnabErrorHandling } from "./helpers.js";

function categorySummary(c: {
  id: string;
  category_group_id: string;
  category_group_name?: string;
  name: string;
  hidden: boolean;
  note?: string;
  budgeted: number;
  activity: number;
  balance: number;
}) {
  return {
    id: c.id,
    category_group_id: c.category_group_id,
    category_group_name: c.category_group_name,
    name: c.name,
    hidden: c.hidden,
    note: c.note,
    budgeted: milliunitsBrand.parse(c.budgeted),
    activity: milliunitsBrand.parse(c.activity),
    balance: milliunitsBrand.parse(c.balance),
  };
}

export function registerCategoryTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_categories",
    {
      title: "List YNAB categories",
      description:
        "List all category groups and categories in a budget, with budgeted/activity/balance figures (in milliunits) for the current month.",
      inputSchema: {
        budget_id: budgetIdSchema,
        last_knowledge_of_server: lastKnowledgeOfServerSchema.optional(),
      },
      annotations: READ_ONLY,
    },
    async ({
      budget_id,
      last_knowledge_of_server,
    }: {
      budget_id: string;
      last_knowledge_of_server?: number | undefined;
    }) =>
      withYnabErrorHandling(async () => {
        const { items, serverKnowledge } = await ynab.listCategories(
          budget_id,
          last_knowledge_of_server,
        );
        const summary = items
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
        return jsonToolResult({ category_groups: summary, server_knowledge: serverKnowledge });
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

  server.registerTool(
    "ynab_create_category_group",
    {
      title: "Create a YNAB category group",
      description: "Create a new category group in a budget.",
      inputSchema: {
        budget_id: budgetIdSchema,
        name: z.string().min(1).describe("Name for the new category group"),
      },
      annotations: CREATES,
    },
    async ({ budget_id, name }: { budget_id: string; name: string }) =>
      withYnabErrorHandling(async () => {
        const g = await ynab.createCategoryGroup(budget_id, name);
        return jsonToolResult({ id: g.id, name: g.name, hidden: g.hidden });
      }),
  );

  server.registerTool(
    "ynab_update_category_group",
    {
      title: "Update a YNAB category group",
      description: "Rename an existing category group.",
      inputSchema: {
        budget_id: budgetIdSchema,
        category_group_id: z.string().min(1).describe("YNAB category group id"),
        name: z.string().min(1).describe("New name for the category group"),
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      category_group_id,
      name,
    }: {
      budget_id: string;
      category_group_id: string;
      name: string;
    }) =>
      withYnabErrorHandling(async () => {
        const g = await ynab.updateCategoryGroup(budget_id, category_group_id, name);
        return jsonToolResult({ id: g.id, name: g.name, hidden: g.hidden });
      }),
  );

  server.registerTool(
    "ynab_create_category",
    {
      title: "Create a YNAB category",
      description: "Create a new category within an existing category group.",
      inputSchema: {
        budget_id: budgetIdSchema,
        category_group_id: z
          .string()
          .min(1)
          .describe("YNAB category group id the new category belongs to"),
        name: z.string().min(1).describe("Name for the new category"),
        note: z.string().optional().describe("Optional note for the category"),
      },
      annotations: CREATES,
    },
    async ({
      budget_id,
      category_group_id,
      name,
      note,
    }: {
      budget_id: string;
      category_group_id: string;
      name: string;
      note?: string | undefined;
    }) =>
      withYnabErrorHandling(async () => {
        const c = await ynab.createCategory(budget_id, {
          categoryGroupId: category_group_id,
          name,
          ...(note !== undefined && { note }),
        });
        return jsonToolResult(categorySummary(c));
      }),
  );

  server.registerTool(
    "ynab_update_category",
    {
      title: "Update a YNAB category",
      description:
        "Update a category's name, note, and/or which category group it belongs to. Only the fields provided are changed. To change the budgeted (assigned) amount for a specific month, use ynab_assign_budgeted_amount instead.",
      inputSchema: {
        budget_id: budgetIdSchema,
        category_id: z.string().min(1).describe("YNAB category id"),
        name: z.string().min(1).optional().describe("New name for the category"),
        note: z.string().optional().describe("New note for the category"),
        category_group_id: z
          .string()
          .min(1)
          .optional()
          .describe("Move the category to this category group id"),
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      category_id,
      name,
      note,
      category_group_id,
    }: {
      budget_id: string;
      category_id: string;
      name?: string | undefined;
      note?: string | undefined;
      category_group_id?: string | undefined;
    }) =>
      withYnabErrorHandling(async () => {
        const c = await ynab.updateCategory(budget_id, category_id, {
          ...(name !== undefined && { name }),
          ...(note !== undefined && { note }),
          ...(category_group_id !== undefined && { categoryGroupId: category_group_id }),
        });
        return jsonToolResult(categorySummary(c));
      }),
  );

  server.registerTool(
    "ynab_assign_budgeted_amount",
    {
      title: "Assign a budgeted amount to a YNAB category",
      description:
        'Set the budgeted (assigned) amount for a category in a specific month — the "assign money" action. Amount is in milliunits and replaces the existing budgeted amount for that month, it does not add to it.',
      inputSchema: {
        budget_id: budgetIdSchema,
        month: monthSchema,
        category_id: z.string().min(1).describe("YNAB category id"),
        budgeted: milliunitsSchema.describe(
          "The new budgeted (assigned) amount for this category and month, in milliunits",
        ),
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      month,
      category_id,
      budgeted,
    }: {
      budget_id: string;
      month: string;
      category_id: string;
      budgeted: number;
    }) =>
      withYnabErrorHandling(async () => {
        const c = await ynab.assignBudgetedAmount(budget_id, month, category_id, budgeted);
        return jsonToolResult(categorySummary(c));
      }),
  );
}
