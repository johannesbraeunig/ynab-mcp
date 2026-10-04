import * as ynab from "ynab";
import type {
  Account,
  Category,
  CategoryGroup,
  CategoryGroupWithCategories,
  HybridTransaction,
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
  goalTarget?: number;
  goalTargetDate?: string;
  goalNeedsWholeAmount?: boolean;
  goalFrequency?: GoalFrequency;
}

export type GoalFrequency = "monthly" | "weekly" | "yearly";

export interface CategoryUpdateInput {
  name?: string;
  note?: string;
  categoryGroupId?: string;
  /** `null` removes the category's existing goal. */
  goalTarget?: number | null;
  goalTargetDate?: string;
  goalNeedsWholeAmount?: boolean;
  goalFrequency?: GoalFrequency;
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

export interface SubtransactionInput {
  amount: number;
  payeeId?: string;
  payeeName?: string;
  categoryId?: string;
  memo?: string;
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
  subtransactions?: SubtransactionInput[];
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
  subtransactions?: SubtransactionInput[];
}

export interface BulkTransactionUpdateInput extends TransactionUpdateInput {
  id: string;
}

export type TransactionTypeFilter = "uncategorized" | "unapproved";

export interface ListTransactionsOptions {
  sinceDate?: string;
  untilDate?: string;
  type?: TransactionTypeFilter;
  lastKnowledgeOfServer?: number;
  /** Only transactions in this account (YNAB's per-account endpoint). */
  accountId?: string;
}

/**
 * Result of a list endpoint that supports YNAB's delta sync mechanism:
 * pass `serverKnowledge` back in as `lastKnowledgeOfServer` on a later call
 * to receive only entities that changed since then, instead of the full
 * collection every time.
 */
export interface ListResult<T> {
  items: T[];
  serverKnowledge: number;
}

/**
 * YNAB's per-category and per-payee transaction endpoints return "hybrid"
 * rows (a split's subtransactions appear as their own rows, tagged with
 * `type`/`parent_transaction_id`) and may omit `server_knowledge`.
 */
export interface HybridListResult {
  items: HybridTransaction[];
  serverKnowledge: number | null;
}

/**
 * Narrow, stable interface every tool depends on. Tool-facing vocabulary is
 * "budget" throughout (matches the YNAB product and this server's tool
 * schemas) even though the underlying `ynab` SDK's primary resource is now
 * `planId` (YNAB introduced `/plans/{plan_id}` as the primary API path in
 * v1.79.0, keeping `/budgets/{budget_id}` only for backward compatibility).
 * This file is the only place that touches `api.plans` / `planId` directly.
 */
export interface YnabClient {
  getUser(): Promise<User>;
  listBudgets(): Promise<PlanSummary[]>;
  getBudget(budgetId: string): Promise<PlanDetail>;
  getBudgetSettings(budgetId: string): Promise<PlanSettings>;
  listAccounts(budgetId: string, lastKnowledgeOfServer?: number): Promise<ListResult<Account>>;
  getAccount(budgetId: string, accountId: string): Promise<Account>;
  createAccount(budgetId: string, input: NewAccountInput): Promise<Account>;
  listCategories(
    budgetId: string,
    lastKnowledgeOfServer?: number,
  ): Promise<ListResult<CategoryGroupWithCategories>>;
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
  getMonthCategory(budgetId: string, month: string, categoryId: string): Promise<Category>;
  assignBudgetedAmount(
    budgetId: string,
    month: string,
    categoryId: string,
    budgeted: number,
  ): Promise<Category>;
  listMonths(budgetId: string, lastKnowledgeOfServer?: number): Promise<ListResult<MonthSummary>>;
  getMonth(budgetId: string, month: string): Promise<MonthDetail>;
  listPayees(budgetId: string, lastKnowledgeOfServer?: number): Promise<ListResult<Payee>>;
  getPayee(budgetId: string, payeeId: string): Promise<Payee>;
  createPayee(budgetId: string, name: string): Promise<Payee>;
  updatePayee(budgetId: string, payeeId: string, name: string): Promise<Payee>;
  listScheduledTransactions(
    budgetId: string,
    lastKnowledgeOfServer?: number,
  ): Promise<ListResult<ScheduledTransactionDetail>>;
  listTransactions(
    budgetId: string,
    options?: ListTransactionsOptions,
  ): Promise<ListResult<TransactionDetail>>;
  listTransactionsByCategoryOrPayee(
    budgetId: string,
    filter: { categoryId: string } | { payeeId: string },
    options?: Omit<ListTransactionsOptions, "accountId">,
  ): Promise<HybridListResult>;
  getTransaction(budgetId: string, transactionId: string): Promise<TransactionDetail>;
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
  updateTransactionsBulk(
    budgetId: string,
    updates: BulkTransactionUpdateInput[],
  ): Promise<TransactionDetail[]>;
  deleteTransaction(budgetId: string, transactionId: string): Promise<TransactionDetail>;
  /** Triggers a bank import on all linked accounts; returns the imported transaction ids. */
  importTransactions(budgetId: string): Promise<string[]>;
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

    async listAccounts(budgetId, lastKnowledgeOfServer) {
      const res = await api.accounts.getAccounts(budgetId, lastKnowledgeOfServer);
      return { items: res.data.accounts, serverKnowledge: res.data.server_knowledge };
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

    async listCategories(budgetId, lastKnowledgeOfServer) {
      const res = await api.categories.getCategories(budgetId, lastKnowledgeOfServer);
      return { items: res.data.category_groups, serverKnowledge: res.data.server_knowledge };
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
      const res = await api.categories.createCategory(
        budgetId,
        {
          category: {
            category_group_id: input.categoryGroupId,
            name: input.name,
            ...(input.note !== undefined && { note: input.note }),
            ...(input.goalTarget !== undefined && { goal_target: input.goalTarget }),
            ...(input.goalTargetDate !== undefined && { goal_target_date: input.goalTargetDate }),
            ...(input.goalNeedsWholeAmount !== undefined && {
              goal_needs_whole_amount: input.goalNeedsWholeAmount,
            }),
          },
        },
        withRawCategoryFields({
          ...(input.goalFrequency !== undefined && { goal_frequency: input.goalFrequency }),
        }),
      );
      return res.data.category;
    },

    async updateCategory(budgetId, categoryId, input) {
      const res = await api.categories.updateCategory(
        budgetId,
        categoryId,
        {
          category: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.note !== undefined && { note: input.note }),
            ...(input.categoryGroupId !== undefined && {
              category_group_id: input.categoryGroupId,
            }),
            ...(input.goalTarget !== undefined &&
              input.goalTarget !== null && { goal_target: input.goalTarget }),
            ...(input.goalTargetDate !== undefined && { goal_target_date: input.goalTargetDate }),
            ...(input.goalNeedsWholeAmount !== undefined && {
              goal_needs_whole_amount: input.goalNeedsWholeAmount,
            }),
          },
        },
        withRawCategoryFields({
          ...(input.goalTarget === null && { goal_target: null }),
          ...(input.goalFrequency !== undefined && { goal_frequency: input.goalFrequency }),
        }),
      );
      return res.data.category;
    },

    async getMonthCategory(budgetId, month, categoryId) {
      const res = await api.categories.getMonthCategoryById(budgetId, month, categoryId);
      return res.data.category;
    },

    async assignBudgetedAmount(budgetId, month, categoryId, budgeted) {
      const res = await api.categories.updateMonthCategory(budgetId, month, categoryId, {
        category: { budgeted },
      });
      return res.data.category;
    },

    async listMonths(budgetId, lastKnowledgeOfServer) {
      const res = await api.months.getPlanMonths(budgetId, lastKnowledgeOfServer);
      return { items: res.data.months, serverKnowledge: res.data.server_knowledge };
    },

    async getMonth(budgetId, month) {
      const res = await api.months.getPlanMonth(budgetId, month);
      return res.data.month;
    },

    async listPayees(budgetId, lastKnowledgeOfServer) {
      const res = await api.payees.getPayees(budgetId, lastKnowledgeOfServer);
      return { items: res.data.payees, serverKnowledge: res.data.server_knowledge };
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

    async listScheduledTransactions(budgetId, lastKnowledgeOfServer) {
      const res = await api.scheduledTransactions.getScheduledTransactions(
        budgetId,
        lastKnowledgeOfServer,
      );
      return {
        items: res.data.scheduled_transactions,
        serverKnowledge: res.data.server_knowledge,
      };
    },

    async listTransactions(budgetId, options) {
      const res =
        options?.accountId !== undefined
          ? await api.transactions.getTransactionsByAccount(
              budgetId,
              options.accountId,
              options.sinceDate,
              options.untilDate,
              options.type,
              options.lastKnowledgeOfServer,
            )
          : await api.transactions.getTransactions(
              budgetId,
              options?.sinceDate,
              options?.untilDate,
              options?.type,
              options?.lastKnowledgeOfServer,
            );
      return { items: res.data.transactions, serverKnowledge: res.data.server_knowledge };
    },

    async listTransactionsByCategoryOrPayee(budgetId, filter, options) {
      const res =
        "categoryId" in filter
          ? await api.transactions.getTransactionsByCategory(
              budgetId,
              filter.categoryId,
              options?.sinceDate,
              options?.untilDate,
              options?.type,
              options?.lastKnowledgeOfServer,
            )
          : await api.transactions.getTransactionsByPayee(
              budgetId,
              filter.payeeId,
              options?.sinceDate,
              options?.untilDate,
              options?.type,
              options?.lastKnowledgeOfServer,
            );
      return {
        items: res.data.transactions,
        serverKnowledge: res.data.server_knowledge ?? null,
      };
    },

    async getTransaction(budgetId, transactionId) {
      const res = await api.transactions.getTransactionById(budgetId, transactionId);
      return res.data.transaction;
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

    async updateTransactionsBulk(budgetId, updates) {
      const res = await api.transactions.updateTransactions(budgetId, {
        transactions: updates.map((u) => ({ id: u.id, ...transactionUpdateToSdk(u) })),
      });
      return res.data.transactions ?? [];
    },

    async deleteTransaction(budgetId, transactionId) {
      const res = await api.transactions.deleteTransaction(budgetId, transactionId);
      return res.data.transaction;
    },

    async importTransactions(budgetId) {
      const res = await api.transactions.importTransactions(budgetId);
      return res.data.transaction_ids;
    },
  };
}

/**
 * The `ynab` SDK (4.5.0) lags the YNAB API spec (1.87.0) for category writes:
 * its `ExistingCategory` type has no `null` for `goal_target` (the spec says
 * "passing null removes any existing target"), and its serializer drops
 * `goal_frequency` entirely. This override merges such fields into the
 * already-serialized request body, which the SDK hands over as a plain JSON
 * object before stringifying it.
 */
function withRawCategoryFields(
  fields: Record<string, unknown>,
): ynab.InitOverrideFunction | undefined {
  if (Object.keys(fields).length === 0) return undefined;
  return async ({ init }) => {
    Object.assign(init.body.category, fields);
    return {};
  };
}

function subtransactionToSdk(input: SubtransactionInput): ynab.SaveSubTransaction {
  return {
    amount: input.amount,
    ...(input.payeeId !== undefined && { payee_id: input.payeeId }),
    ...(input.payeeName !== undefined && { payee_name: input.payeeName }),
    ...(input.categoryId !== undefined && { category_id: input.categoryId }),
    ...(input.memo !== undefined && { memo: input.memo }),
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
    ...(input.subtransactions !== undefined && {
      subtransactions: input.subtransactions.map(subtransactionToSdk),
    }),
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
    ...(input.subtransactions !== undefined && {
      subtransactions: input.subtransactions.map(subtransactionToSdk),
    }),
  };
}
