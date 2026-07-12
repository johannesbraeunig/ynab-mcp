import * as ynab from "ynab";
import type {
  Account,
  CategoryGroupWithCategories,
  PlanDetail,
  PlanSummary,
  TransactionDetail,
} from "ynab";

/**
 * Narrow, stable interface every tool depends on. Tool-facing vocabulary is
 * "budget" throughout (matches the YNAB product and this server's tool
 * schemas) even though the underlying `ynab` SDK's primary resource is now
 * `planId` (see docs/plans/ynab-mcp-server-plan.md, "API reference" section).
 * This file is the only place that touches `api.plans` / `planId` directly.
 */
export interface YnabClient {
  listBudgets(): Promise<PlanSummary[]>;
  getBudget(budgetId: string): Promise<PlanDetail>;
  listAccounts(budgetId: string): Promise<Account[]>;
  listCategories(budgetId: string): Promise<CategoryGroupWithCategories[]>;
  listTransactions(
    budgetId: string,
    options?: { sinceDate?: string; untilDate?: string },
  ): Promise<TransactionDetail[]>;
}

export function createYnabClient(accessToken: string, apiBaseUrl?: string): YnabClient {
  const api = new ynab.api(accessToken, apiBaseUrl);

  return {
    async listBudgets() {
      const res = await api.plans.getPlans();
      return res.data.plans;
    },

    async getBudget(budgetId) {
      const res = await api.plans.getPlanById(budgetId);
      return res.data.plan;
    },

    async listAccounts(budgetId) {
      const res = await api.accounts.getAccounts(budgetId);
      return res.data.accounts;
    },

    async listCategories(budgetId) {
      const res = await api.categories.getCategories(budgetId);
      return res.data.category_groups;
    },

    async listTransactions(budgetId, options) {
      const res = await api.transactions.getTransactions(
        budgetId,
        options?.sinceDate,
        options?.untilDate,
      );
      return res.data.transactions;
    },
  };
}
