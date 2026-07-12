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

export type ClearedStatus = "cleared" | "uncleared" | "reconciled";

export type AccountType =
  | "checking"
  | "savings"
  | "cash"
  | "creditCard"
  | "otherAsset"
  | "otherLiability";

export interface NewAccountInput {
  name: string;
  type: AccountType;
  balance: number;
}

export interface NewTransactionInput {
  accountId: string;
  date: string;
  amount: number;
  payeeId?: string;
  payeeName?: string;
  categoryId?: string;
  memo?: string;
  cleared?: ClearedStatus;
  approved?: boolean;
}

export interface TransactionUpdateInput {
  accountId?: string;
  date?: string;
  amount?: number;
  payeeId?: string;
  payeeName?: string;
  categoryId?: string;
  memo?: string;
  cleared?: ClearedStatus;
  approved?: boolean;
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
  createAccount(budgetId: string, input: NewAccountInput): Promise<Account>;
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
  createPayee(budgetId: string, name: string): Promise<Payee>;
  updatePayee(budgetId: string, payeeId: string, name: string): Promise<Payee>;
  listScheduledTransactions(budgetId: string): Promise<ScheduledTransactionDetail[]>;
  listTransactions(
    budgetId: string,
    options?: { sinceDate?: string; untilDate?: string },
  ): Promise<TransactionDetail[]>;
  createTransaction(budgetId: string, input: NewTransactionInput): Promise<TransactionDetail>;
  createTransactionsBulk(
    budgetId: string,
    inputs: NewTransactionInput[],
  ): Promise<TransactionDetail[]>;
  updateTransaction(
    budgetId: string,
    transactionId: string,
    input: TransactionUpdateInput,
  ): Promise<TransactionDetail>;
  deleteTransaction(budgetId: string, transactionId: string): Promise<TransactionDetail>;
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

    async createAccount(budgetId, input) {
      const res = await api.accounts.createAccount(budgetId, {
        account: { name: input.name, type: input.type, balance: input.balance },
      });
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

    async createPayee(budgetId, name) {
      const res = await api.payees.createPayee(budgetId, { payee: { name } });
      return res.data.payee;
    },

    async updatePayee(budgetId, payeeId, name) {
      const res = await api.payees.updatePayee(budgetId, payeeId, { payee: { name } });
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

    async createTransaction(budgetId, input) {
      const res = await api.transactions.createTransaction(budgetId, {
        transaction: newTransactionToSdk(input),
      });
      if (res.data.transaction === undefined) {
        throw new Error("YNAB API did not return the created transaction.");
      }
      return res.data.transaction;
    },

    async createTransactionsBulk(budgetId, inputs) {
      const res = await api.transactions.createTransaction(budgetId, {
        transactions: inputs.map(newTransactionToSdk),
      });
      return res.data.transactions ?? [];
    },

    async updateTransaction(budgetId, transactionId, input) {
      const res = await api.transactions.updateTransaction(budgetId, transactionId, {
        transaction: transactionUpdateToSdk(input),
      });
      return res.data.transaction;
    },

    async deleteTransaction(budgetId, transactionId) {
      const res = await api.transactions.deleteTransaction(budgetId, transactionId);
      return res.data.transaction;
    },
  };
}

function newTransactionToSdk(input: NewTransactionInput): ynab.NewTransaction {
  return {
    account_id: input.accountId,
    date: input.date,
    amount: input.amount,
    ...(input.payeeId !== undefined && { payee_id: input.payeeId }),
    ...(input.payeeName !== undefined && { payee_name: input.payeeName }),
    ...(input.categoryId !== undefined && { category_id: input.categoryId }),
    ...(input.memo !== undefined && { memo: input.memo }),
    ...(input.cleared !== undefined && { cleared: input.cleared }),
    ...(input.approved !== undefined && { approved: input.approved }),
  };
}

function transactionUpdateToSdk(input: TransactionUpdateInput): ynab.ExistingTransaction {
  return {
    ...(input.accountId !== undefined && { account_id: input.accountId }),
    ...(input.date !== undefined && { date: input.date }),
    ...(input.amount !== undefined && { amount: input.amount }),
    ...(input.payeeId !== undefined && { payee_id: input.payeeId }),
    ...(input.payeeName !== undefined && { payee_name: input.payeeName }),
    ...(input.categoryId !== undefined && { category_id: input.categoryId }),
    ...(input.memo !== undefined && { memo: input.memo }),
    ...(input.cleared !== undefined && { cleared: input.cleared }),
    ...(input.approved !== undefined && { approved: input.approved }),
  };
}
