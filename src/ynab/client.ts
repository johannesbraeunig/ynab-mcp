import * as ynab from "ynab";
import type {
  Account,
  Category,
  CategoryGroup,
  CategoryGroupWithCategories,
  MonthDetail,
  MonthSummary,
  Payee,
  PlanDetail,
  PlanSettings,
  PlanSummary,
  ScheduledTransactionDetail,
  TransactionDetail,
  User,
} from "ynab";

export interface NewCategoryInput {
  categoryGroupId: string;
  name: string;
  note?: string;
}

export interface CategoryUpdateInput {
  name?: string;
  note?: string;
  categoryGroupId?: string;
}

/**
 * Narrow, stable interface every tool depends on. Tool-facing vocabulary is
 * "budget" throughout (matches the YNAB product and this server's tool
 * schemas) even though the underlying `ynab` SDK's primary resource is now
 * `planId` (see docs/plans/ynab-mcp-server-plan.md, "API reference" section).
 * This file is the only place that touches `api.plans` / `planId` directly.
 */
export interface YnabClient {
  getUser(): Promise<User>;
  listBudgets(): Promise<PlanSummary[]>;
  getBudget(budgetId: string): Promise<PlanDetail>;
  getBudgetSettings(budgetId: string): Promise<PlanSettings>;
  listAccounts(budgetId: string): Promise<Account[]>;
  getAccount(budgetId: string, accountId: string): Promise<Account>;
  listCategories(budgetId: string): Promise<CategoryGroupWithCategories[]>;
  getCategory(budgetId: string, categoryId: string): Promise<Category>;
  createCategoryGroup(budgetId: string, name: string): Promise<CategoryGroup>;
  updateCategoryGroup(
    budgetId: string,
    categoryGroupId: string,
    name: string,
  ): Promise<CategoryGroup>;
  createCategory(budgetId: string, input: NewCategoryInput): Promise<Category>;
  updateCategory(
    budgetId: string,
    categoryId: string,
    input: CategoryUpdateInput,
  ): Promise<Category>;
  assignBudgetedAmount(
    budgetId: string,
    month: string,
    categoryId: string,
    budgeted: number,
  ): Promise<Category>;
  listMonths(budgetId: string): Promise<MonthSummary[]>;
  getMonth(budgetId: string, month: string): Promise<MonthDetail>;
  listPayees(budgetId: string): Promise<Payee[]>;
  getPayee(budgetId: string, payeeId: string): Promise<Payee>;
  listScheduledTransactions(budgetId: string): Promise<ScheduledTransactionDetail[]>;
  listTransactions(
    budgetId: string,
    options?: { sinceDate?: string; untilDate?: string },
  ): Promise<TransactionDetail[]>;
}

export function createYnabClient(accessToken: string, apiBaseUrl?: string): YnabClient {
  const api = new ynab.api(accessToken, apiBaseUrl);

  return {
    async getUser() {
      const res = await api.user.getUser();
      return res.data.user;
    },

    async listBudgets() {
      const res = await api.plans.getPlans();
      return res.data.plans;
    },

    async getBudget(budgetId) {
      const res = await api.plans.getPlanById(budgetId);
      return res.data.plan;
    },

    async getBudgetSettings(budgetId) {
      const res = await api.plans.getPlanSettingsById(budgetId);
      return res.data.settings;
    },

    async listAccounts(budgetId) {
      const res = await api.accounts.getAccounts(budgetId);
      return res.data.accounts;
    },

    async getAccount(budgetId, accountId) {
      const res = await api.accounts.getAccountById(budgetId, accountId);
      return res.data.account;
    },

    async listCategories(budgetId) {
      const res = await api.categories.getCategories(budgetId);
      return res.data.category_groups;
    },

    async getCategory(budgetId, categoryId) {
      const res = await api.categories.getCategoryById(budgetId, categoryId);
      return res.data.category;
    },

    async createCategoryGroup(budgetId, name) {
      const res = await api.categories.createCategoryGroup(budgetId, {
        category_group: { name },
      });
      return res.data.category_group;
    },

    async updateCategoryGroup(budgetId, categoryGroupId, name) {
      const res = await api.categories.updateCategoryGroup(budgetId, categoryGroupId, {
        category_group: { name },
      });
      return res.data.category_group;
    },

    async createCategory(budgetId, input) {
      const res = await api.categories.createCategory(budgetId, {
        category: {
          category_group_id: input.categoryGroupId,
          name: input.name,
          ...(input.note !== undefined && { note: input.note }),
        },
      });
      return res.data.category;
    },

    async updateCategory(budgetId, categoryId, input) {
      const res = await api.categories.updateCategory(budgetId, categoryId, {
        category: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.note !== undefined && { note: input.note }),
          ...(input.categoryGroupId !== undefined && { category_group_id: input.categoryGroupId }),
        },
      });
      return res.data.category;
    },

    async assignBudgetedAmount(budgetId, month, categoryId, budgeted) {
      const res = await api.categories.updateMonthCategory(budgetId, month, categoryId, {
        category: { budgeted },
      });
      return res.data.category;
    },

    async listMonths(budgetId) {
      const res = await api.months.getPlanMonths(budgetId);
      return res.data.months;
    },

    async getMonth(budgetId, month) {
      const res = await api.months.getPlanMonth(budgetId, month);
      return res.data.month;
    },

    async listPayees(budgetId) {
      const res = await api.payees.getPayees(budgetId);
      return res.data.payees;
    },

    async getPayee(budgetId, payeeId) {
      const res = await api.payees.getPayeeById(budgetId, payeeId);
      return res.data.payee;
    },

    async listScheduledTransactions(budgetId) {
      const res = await api.scheduledTransactions.getScheduledTransactions(budgetId);
      return res.data.scheduled_transactions;
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
