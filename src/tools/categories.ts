import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoalFrequency, YnabClient } from "../ynab/client.js";
import {
  budgetIdSchema,
  isoDateSchema,
  lastKnowledgeOfServerSchema,
  milliunitsSchema,
  monthSchema,
} from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { mapYnabError, YnabToolError } from "../ynab/errors.js";
import {
  CREATES,
  errorToolResult,
  jsonToolResult,
  READ_ONLY,
  UPDATES,
  withYnabErrorHandling,
} from "./helpers.js";

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
  goal_type?: string | null;
  goal_target?: number | null;
  goal_target_date?: string | null;
  goal_needs_whole_amount?: boolean | null;
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
    goal_type: c.goal_type ?? undefined,
    goal_target:
      c.goal_target !== undefined && c.goal_target !== null
        ? milliunitsBrand.parse(c.goal_target)
        : undefined,
    goal_target_date: c.goal_target_date ?? undefined,
    goal_needs_whole_amount: c.goal_needs_whole_amount ?? undefined,
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
            c.goal_target !== undefined && c.goal_target !== null
              ? milliunitsBrand.parse(c.goal_target)
              : undefined,
          goal_target_date: c.goal_target_date,
          goal_target_month: c.goal_target_month,
          goal_needs_whole_amount: c.goal_needs_whole_amount,
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

  const goalTargetSchema = milliunitsSchema.describe(
    "The goal target amount in milliunits. If the category has no goal yet, setting this creates a goal. The goal type itself can't be chosen through the API: YNAB picks 'NEED' for normal categories, 'MF' for Credit Card Payment categories and 'DEBT' for categories paired to a loan account. " +
      'Use goal_frequency for a recurring target ("Set aside / Refill up to X each week/month/year") or goal_target_date for "X by date" (e.g. a vacation fund).',
  );
  const goalTargetDateSchema = isoDateSchema.describe(
    'The goal target date, e.g. for a savings goal with a deadline ("save X by date"). Not supported for categories paired to a loan account; can\'t be combined with goal_frequency.',
  );
  const goalFrequencySchema = z
    .enum(["monthly", "weekly", "yearly"])
    .describe(
      "Configures a recurring 'NEED' target of goal_target repeating at this cadence, replacing any existing target. Requires goal_target; can't be combined with goal_target_date. Not supported for Credit Card Payment categories or categories paired to a loan account. Omit to leave an existing target's cadence unchanged.",
    );

  function validateGoalArgs(args: {
    goal_target?: number | null | undefined;
    goal_target_date?: string | undefined;
    goal_needs_whole_amount?: boolean | undefined;
    goal_frequency?: GoalFrequency | undefined;
  }): string | undefined {
    if (args.goal_frequency !== undefined) {
      if (args.goal_target === undefined || args.goal_target === null) {
        return "goal_frequency requires goal_target.";
      }
      if (args.goal_target_date !== undefined) {
        return "goal_frequency can't be combined with goal_target_date.";
      }
    }
    if (
      args.goal_target === null &&
      (args.goal_target_date !== undefined || args.goal_needs_whole_amount !== undefined)
    ) {
      return "goal_target: null removes the goal; don't pass other goal fields with it.";
    }
    return undefined;
  }
  const goalNeedsWholeAmountSchema = z
    .boolean()
    .describe(
      "Only applies to 'NEED' goals. true = 'Set aside another...' (needs the full amount each period); false = 'Refill up to...'",
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
        goal_target: goalTargetSchema.optional(),
        goal_target_date: goalTargetDateSchema.optional(),
        goal_needs_whole_amount: goalNeedsWholeAmountSchema.optional(),
        goal_frequency: goalFrequencySchema.optional(),
      },
      annotations: CREATES,
    },
    async ({
      budget_id,
      category_group_id,
      name,
      note,
      goal_target,
      goal_target_date,
      goal_needs_whole_amount,
      goal_frequency,
    }: {
      budget_id: string;
      category_group_id: string;
      name: string;
      note?: string | undefined;
      goal_target?: number | undefined;
      goal_target_date?: string | undefined;
      goal_needs_whole_amount?: boolean | undefined;
      goal_frequency?: GoalFrequency | undefined;
    }) => {
      const problem = validateGoalArgs({
        goal_target,
        goal_target_date,
        goal_needs_whole_amount,
        goal_frequency,
      });
      if (problem !== undefined) return errorToolResult(problem);

      return withYnabErrorHandling(async () => {
        const c = await ynab.createCategory(budget_id, {
          categoryGroupId: category_group_id,
          name,
          ...(note !== undefined && { note }),
          ...(goal_target !== undefined && { goalTarget: goal_target }),
          ...(goal_target_date !== undefined && { goalTargetDate: goal_target_date }),
          ...(goal_needs_whole_amount !== undefined && {
            goalNeedsWholeAmount: goal_needs_whole_amount,
          }),
          ...(goal_frequency !== undefined && { goalFrequency: goal_frequency }),
        });
        return jsonToolResult(categorySummary(c));
      });
    },
  );

  server.registerTool(
    "ynab_update_category",
    {
      title: "Update a YNAB category",
      description:
        "Update a category's name, note, category group, and/or goal (target). Only the fields provided are changed; pass goal_target: null to remove the category's goal. To change the budgeted (assigned) amount for a specific month, use ynab_assign_budgeted_amount or ynab_move_money instead.",
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
        goal_target: goalTargetSchema
          .nullable()
          .optional()
          .describe(
            "New goal target amount in milliunits, or null to remove the category's goal entirely. " +
              goalTargetSchema.description,
          ),
        goal_target_date: goalTargetDateSchema.optional(),
        goal_needs_whole_amount: goalNeedsWholeAmountSchema.optional(),
        goal_frequency: goalFrequencySchema.optional(),
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      category_id,
      name,
      note,
      category_group_id,
      goal_target,
      goal_target_date,
      goal_needs_whole_amount,
      goal_frequency,
    }: {
      budget_id: string;
      category_id: string;
      name?: string | undefined;
      note?: string | undefined;
      category_group_id?: string | undefined;
      goal_target?: number | null | undefined;
      goal_target_date?: string | undefined;
      goal_needs_whole_amount?: boolean | undefined;
      goal_frequency?: GoalFrequency | undefined;
    }) => {
      const problem = validateGoalArgs({
        goal_target,
        goal_target_date,
        goal_needs_whole_amount,
        goal_frequency,
      });
      if (problem !== undefined) return errorToolResult(problem);

      return withYnabErrorHandling(async () => {
        const c = await ynab.updateCategory(budget_id, category_id, {
          ...(name !== undefined && { name }),
          ...(note !== undefined && { note }),
          ...(category_group_id !== undefined && { categoryGroupId: category_group_id }),
          ...(goal_target !== undefined && { goalTarget: goal_target }),
          ...(goal_target_date !== undefined && { goalTargetDate: goal_target_date }),
          ...(goal_needs_whole_amount !== undefined && {
            goalNeedsWholeAmount: goal_needs_whole_amount,
          }),
          ...(goal_frequency !== undefined && { goalFrequency: goal_frequency }),
        });
        return jsonToolResult(categorySummary(c));
      });
    },
  );

  server.registerTool(
    "ynab_assign_budgeted_amount",
    {
      title: "Assign a budgeted amount to a YNAB category",
      description:
        'Set the budgeted (assigned) amount for a category in a specific month — the "assign money" action. Amount is in milliunits. ' +
        'With mode "set" (default) it replaces the existing budgeted amount; with mode "add" it is added to the current budgeted amount (negative to remove), e.g. to cover an overspent category without reading and recomputing first. ' +
        "To move money from one category to another in one step, use ynab_move_money.",
      inputSchema: {
        budget_id: budgetIdSchema,
        month: monthSchema,
        category_id: z.string().min(1).describe("YNAB category id"),
        budgeted: milliunitsSchema.describe(
          'The new budgeted amount (mode "set") or the amount to add to it (mode "add"), in milliunits',
        ),
        mode: z
          .enum(["set", "add"])
          .optional()
          .describe('"set" replaces the budgeted amount (default); "add" adds to it'),
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      month,
      category_id,
      budgeted,
      mode,
    }: {
      budget_id: string;
      month: string;
      category_id: string;
      budgeted: number;
      mode?: "set" | "add" | undefined;
    }) =>
      withYnabErrorHandling(async () => {
        const c =
          mode === "add"
            ? await addToBudgeted(ynab, budget_id, month, category_id, budgeted)
            : await ynab.assignBudgetedAmount(budget_id, month, category_id, budgeted);
        return jsonToolResult(categorySummary(c));
      }),
  );

  server.registerTool(
    "ynab_move_money",
    {
      title: "Move money between YNAB categories",
      description:
        'Move an amount of assigned money from one category to another within a month, like YNAB\'s "Move money" dialog. ' +
        "Omit from_category_id to take the money from Ready to Assign; omit to_category_id to return it to Ready to Assign. " +
        "Internally this is two writes (decrease the source first, then increase the target): if the second one fails, the money ends up in Ready to Assign and the error says so.",
      inputSchema: {
        budget_id: budgetIdSchema,
        month: monthSchema,
        amount: milliunitsSchema
          .positive()
          .describe("Amount to move, in milliunits (must be positive)"),
        from_category_id: z
          .string()
          .min(1)
          .optional()
          .describe("Category to take the money from. Omit to take it from Ready to Assign."),
        to_category_id: z
          .string()
          .min(1)
          .optional()
          .describe("Category to move the money to. Omit to return it to Ready to Assign."),
      },
      annotations: { ...UPDATES, idempotentHint: false },
    },
    async ({
      budget_id,
      month,
      amount,
      from_category_id,
      to_category_id,
    }: {
      budget_id: string;
      month: string;
      amount: number;
      from_category_id?: string | undefined;
      to_category_id?: string | undefined;
    }) => {
      if (from_category_id === undefined && to_category_id === undefined) {
        return errorToolResult("Pass from_category_id, to_category_id, or both.");
      }
      if (from_category_id === to_category_id) {
        return errorToolResult("from_category_id and to_category_id must differ.");
      }

      return withYnabErrorHandling(async () => {
        const from =
          from_category_id !== undefined
            ? await addToBudgeted(ynab, budget_id, month, from_category_id, -amount)
            : undefined;
        let to;
        if (to_category_id !== undefined) {
          try {
            to = await addToBudgeted(ynab, budget_id, month, to_category_id, amount);
          } catch (err) {
            if (from === undefined) throw err;
            const mapped = mapYnabError(err).message;
            throw new YnabToolError(
              `The money was already taken out of "${from.name}" but adding it to the target category failed (${mapped}); it is now in Ready to Assign.`,
              "partial_move",
              false,
            );
          }
        }
        return jsonToolResult({
          month,
          amount: milliunitsBrand.parse(amount),
          from: from ? categorySummary(from) : "Ready to Assign",
          to: to ? categorySummary(to) : "Ready to Assign",
        });
      });
    },
  );
}

/** Reads the category's budgeted amount for the month and adds `delta` to it. */
async function addToBudgeted(
  ynab: YnabClient,
  budgetId: string,
  month: string,
  categoryId: string,
  delta: number,
) {
  const current = await ynab.getMonthCategory(budgetId, month, categoryId);
  return ynab.assignBudgetedAmount(budgetId, month, categoryId, current.budgeted + delta);
}
