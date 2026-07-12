import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NewTransactionInput, TransactionUpdateInput, YnabClient } from "../ynab/client.js";
import {
  budgetIdSchema,
  clearedStatusSchema,
  confirmSchema,
  isoDateSchema,
  milliunitsSchema,
} from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import {
  CREATES,
  DELETES,
  errorToolResult,
  jsonToolResult,
  READ_ONLY,
  UPDATES,
  withYnabErrorHandling,
} from "./helpers.js";
import type { TransactionDetail } from "ynab";

const DEFAULT_WINDOW_DAYS = 30;
const MAX_RESULTS = 200;

function defaultSinceDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

function transactionSummary(t: TransactionDetail) {
  return {
    id: t.id,
    date: t.date,
    amount: milliunitsBrand.parse(t.amount),
    amount_formatted: t.amount_formatted,
    account_id: t.account_id,
    account_name: t.account_name,
    payee_id: t.payee_id,
    payee_name: t.payee_name,
    category_id: t.category_id,
    category_name: t.category_name,
    memo: t.memo,
    cleared: t.cleared,
    approved: t.approved,
  };
}

const newTransactionShape = {
  account_id: z.string().min(1).describe("YNAB account id the transaction belongs to"),
  date: isoDateSchema,
  amount: milliunitsSchema,
  payee_id: z.string().min(1).optional().describe("Existing YNAB payee id"),
  payee_name: z
    .string()
    .optional()
    .describe("Payee name; YNAB creates a new payee if none matches. Ignored if payee_id is set."),
  category_id: z.string().min(1).optional().describe("YNAB category id to assign"),
  memo: z.string().optional().describe("Transaction memo"),
  cleared: clearedStatusSchema.optional().describe("Defaults to uncleared if omitted"),
  approved: z.boolean().optional().describe("Defaults to false (unapproved) if omitted"),
};

function toNewTransactionInput(args: {
  account_id: string;
  date: string;
  amount: number;
  payee_id?: string | undefined;
  payee_name?: string | undefined;
  category_id?: string | undefined;
  memo?: string | undefined;
  cleared?: "cleared" | "uncleared" | "reconciled" | undefined;
  approved?: boolean | undefined;
}): NewTransactionInput {
  return {
    accountId: args.account_id,
    date: args.date,
    amount: args.amount,
    ...(args.payee_id !== undefined && { payeeId: args.payee_id }),
    ...(args.payee_name !== undefined && { payeeName: args.payee_name }),
    ...(args.category_id !== undefined && { categoryId: args.category_id }),
    ...(args.memo !== undefined && { memo: args.memo }),
    ...(args.cleared !== undefined && { cleared: args.cleared }),
    ...(args.approved !== undefined && { approved: args.approved }),
  };
}

export function registerTransactionTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_transactions",
    {
      title: "List YNAB transactions",
      description:
        `List transactions in a budget. Defaults to the last ${DEFAULT_WINDOW_DAYS} days if since_date is not given, and returns at most ${MAX_RESULTS} transactions per call (most recent first) with has_more indicating whether more exist for the window. ` +
        `Note: the YNAB API has no result-count limit of its own, so this tool always fetches every transaction in the requested date range before applying the ${MAX_RESULTS}-result cap — narrow the date range for large or long-lived budgets rather than requesting everything at once, both to keep the response small and to avoid burning YNAB's 200-requests/hour rate limit on an oversized fetch.`,
      inputSchema: {
        budget_id: budgetIdSchema,
        since_date: isoDateSchema
          .optional()
          .describe(
            `Only return transactions on or after this date. Defaults to ${DEFAULT_WINDOW_DAYS} days ago. Must not be after until_date.`,
          ),
        until_date: isoDateSchema
          .optional()
          .describe("Only return transactions on or before this date."),
      },
      annotations: READ_ONLY,
    },
    async ({
      budget_id,
      since_date,
      until_date,
    }: {
      budget_id: string;
      since_date?: string | undefined;
      until_date?: string | undefined;
    }) => {
      const sinceDate = since_date ?? defaultSinceDate();
      if (until_date !== undefined && sinceDate > until_date) {
        return errorToolResult(
          `since_date (${sinceDate}) must not be after until_date (${until_date}).`,
        );
      }

      return withYnabErrorHandling(async () => {
        const transactions = await ynab.listTransactions(budget_id, {
          sinceDate,
          ...(until_date !== undefined && { untilDate: until_date }),
        });
        const nonDeleted = transactions.filter((t) => !t.deleted);
        const sorted = nonDeleted.sort((a, b) => {
          if (a.date < b.date) return 1;
          if (a.date > b.date) return -1;
          return 0;
        });
        const page = sorted.slice(0, MAX_RESULTS);
        const summary = page.map((t) => ({
          id: t.id,
          date: t.date,
          amount: milliunitsBrand.parse(t.amount),
          amount_formatted: t.amount_formatted,
          payee_name: t.payee_name,
          category_name: t.category_name,
          account_name: t.account_name,
          memo: t.memo,
          cleared: t.cleared,
          approved: t.approved,
        }));
        return jsonToolResult({ transactions: summary, has_more: sorted.length > MAX_RESULTS });
      });
    },
  );

  server.registerTool(
    "ynab_get_spending_summary",
    {
      title: "Get YNAB spending summary by category",
      description:
        `Summarize spending (outflow) and income (inflow) per category over a date range, computed client-side from transactions (YNAB has no single endpoint for this). Defaults to the last ${DEFAULT_WINDOW_DAYS} days if since_date is not given. ` +
        "Narrow the date range for large or long-lived budgets, both to keep the response small and to avoid burning YNAB's 200-requests/hour rate limit.",
      inputSchema: {
        budget_id: budgetIdSchema,
        since_date: isoDateSchema
          .optional()
          .describe(
            `Only include transactions on or after this date. Defaults to ${DEFAULT_WINDOW_DAYS} days ago. Must not be after until_date.`,
          ),
        until_date: isoDateSchema
          .optional()
          .describe("Only include transactions on or before this date."),
      },
      annotations: READ_ONLY,
    },
    async ({
      budget_id,
      since_date,
      until_date,
    }: {
      budget_id: string;
      since_date?: string | undefined;
      until_date?: string | undefined;
    }) => {
      const sinceDate = since_date ?? defaultSinceDate();
      if (until_date !== undefined && sinceDate > until_date) {
        return errorToolResult(
          `since_date (${sinceDate}) must not be after until_date (${until_date}).`,
        );
      }

      return withYnabErrorHandling(async () => {
        const transactions = await ynab.listTransactions(budget_id, {
          sinceDate,
          ...(until_date !== undefined && { untilDate: until_date }),
        });

        const byCategory = new Map<
          string,
          {
            category_id: string | null;
            category_name: string | null;
            outflow: number;
            inflow: number;
            transaction_count: number;
          }
        >();
        for (const t of transactions) {
          if (t.deleted) continue;
          const key = t.category_id ?? "__uncategorized__";
          const entry = byCategory.get(key) ?? {
            category_id: t.category_id ?? null,
            category_name: t.category_name ?? null,
            outflow: 0,
            inflow: 0,
            transaction_count: 0,
          };
          if (t.amount < 0) {
            entry.outflow += -t.amount;
          } else {
            entry.inflow += t.amount;
          }
          entry.transaction_count += 1;
          byCategory.set(key, entry);
        }

        const summary = [...byCategory.values()]
          .map((entry) => ({
            category_id: entry.category_id,
            category_name: entry.category_name,
            outflow: milliunitsBrand.parse(entry.outflow),
            inflow: milliunitsBrand.parse(entry.inflow),
            transaction_count: entry.transaction_count,
          }))
          .sort((a, b) => b.outflow - a.outflow);

        return jsonToolResult({
          since_date: sinceDate,
          until_date: until_date ?? null,
          categories: summary,
        });
      });
    },
  );

  server.registerTool(
    "ynab_create_transaction",
    {
      title: "Create a YNAB transaction",
      description:
        "Create a single transaction. Amount is in milliunits: negative = outflow (spending), positive = inflow.",
      inputSchema: { budget_id: budgetIdSchema, ...newTransactionShape },
      annotations: CREATES,
    },
    async ({
      budget_id,
      ...rest
    }: {
      budget_id: string;
      account_id: string;
      date: string;
      amount: number;
      payee_id?: string | undefined;
      payee_name?: string | undefined;
      category_id?: string | undefined;
      memo?: string | undefined;
      cleared?: "cleared" | "uncleared" | "reconciled" | undefined;
      approved?: boolean | undefined;
    }) =>
      withYnabErrorHandling(async () => {
        const t = await ynab.createTransaction(budget_id, toNewTransactionInput(rest));
        return jsonToolResult(transactionSummary(t));
      }),
  );

  server.registerTool(
    "ynab_create_transactions_bulk",
    {
      title: "Create multiple YNAB transactions",
      description:
        "Create multiple transactions in a single call. Amounts are in milliunits: negative = outflow (spending), positive = inflow.",
      inputSchema: {
        budget_id: budgetIdSchema,
        transactions: z
          .array(z.object(newTransactionShape))
          .min(1)
          .describe("Transactions to create"),
      },
      annotations: CREATES,
    },
    async ({
      budget_id,
      transactions,
    }: {
      budget_id: string;
      transactions: {
        account_id: string;
        date: string;
        amount: number;
        payee_id?: string | undefined;
        payee_name?: string | undefined;
        category_id?: string | undefined;
        memo?: string | undefined;
        cleared?: "cleared" | "uncleared" | "reconciled" | undefined;
        approved?: boolean | undefined;
      }[];
    }) =>
      withYnabErrorHandling(async () => {
        const created = await ynab.createTransactionsBulk(
          budget_id,
          transactions.map(toNewTransactionInput),
        );
        return jsonToolResult(created.map(transactionSummary));
      }),
  );

  server.registerTool(
    "ynab_update_transaction",
    {
      title: "Update a YNAB transaction",
      description:
        "Update a transaction's account, date, amount, payee, category, memo, cleared status, and/or approved status. Only the fields provided are changed — this single tool covers approving a transaction, categorizing it, editing its amount, etc.",
      inputSchema: {
        budget_id: budgetIdSchema,
        transaction_id: z.string().min(1).describe("YNAB transaction id"),
        account_id: z.string().min(1).optional().describe("Move the transaction to this account"),
        date: isoDateSchema.optional(),
        amount: milliunitsSchema.optional(),
        payee_id: z.string().min(1).optional().describe("Existing YNAB payee id"),
        payee_name: z
          .string()
          .optional()
          .describe(
            "Payee name; YNAB creates a new payee if none matches. Ignored if payee_id is set.",
          ),
        category_id: z.string().min(1).optional().describe("YNAB category id to assign"),
        memo: z.string().optional(),
        cleared: clearedStatusSchema.optional(),
        approved: z.boolean().optional(),
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      transaction_id,
      ...rest
    }: {
      budget_id: string;
      transaction_id: string;
      account_id?: string | undefined;
      date?: string | undefined;
      amount?: number | undefined;
      payee_id?: string | undefined;
      payee_name?: string | undefined;
      category_id?: string | undefined;
      memo?: string | undefined;
      cleared?: "cleared" | "uncleared" | "reconciled" | undefined;
      approved?: boolean | undefined;
    }) =>
      withYnabErrorHandling(async () => {
        const input: TransactionUpdateInput = {
          ...(rest.account_id !== undefined && { accountId: rest.account_id }),
          ...(rest.date !== undefined && { date: rest.date }),
          ...(rest.amount !== undefined && { amount: rest.amount }),
          ...(rest.payee_id !== undefined && { payeeId: rest.payee_id }),
          ...(rest.payee_name !== undefined && { payeeName: rest.payee_name }),
          ...(rest.category_id !== undefined && { categoryId: rest.category_id }),
          ...(rest.memo !== undefined && { memo: rest.memo }),
          ...(rest.cleared !== undefined && { cleared: rest.cleared }),
          ...(rest.approved !== undefined && { approved: rest.approved }),
        };
        const t = await ynab.updateTransaction(budget_id, transaction_id, input);
        return jsonToolResult(transactionSummary(t));
      }),
  );

  server.registerTool(
    "ynab_delete_transaction",
    {
      title: "Delete a YNAB transaction",
      description:
        "Permanently delete a transaction. This cannot be undone via the API. Requires confirm: true.",
      inputSchema: {
        budget_id: budgetIdSchema,
        transaction_id: z.string().min(1).describe("YNAB transaction id to delete"),
        confirm: confirmSchema,
      },
      annotations: DELETES,
    },
    async ({
      budget_id,
      transaction_id,
    }: {
      budget_id: string;
      transaction_id: string;
      confirm: true;
    }) =>
      withYnabErrorHandling(async () => {
        const t = await ynab.deleteTransaction(budget_id, transaction_id);
        return jsonToolResult(transactionSummary(t));
      }),
  );
}
