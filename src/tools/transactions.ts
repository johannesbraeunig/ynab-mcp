import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  BulkTransactionUpdateInput,
  ClearedStatus,
  NewTransactionInput,
  SubtransactionInput,
  TransactionTypeFilter,
  TransactionUpdateInput,
  YnabClient,
} from "../ynab/client.js";
import {
  budgetIdSchema,
  clearedStatusSchema,
  confirmSchema,
  isoDateSchema,
  lastKnowledgeOfServerSchema,
  milliunitsSchema,
} from "../schemas/common.js";
import { YnabToolError } from "../ynab/errors.js";
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
import type { HybridTransaction, TransactionDetail } from "ynab";

const DEFAULT_WINDOW_DAYS = 30;
const MAX_RESULTS = 200;

function defaultSinceDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

function subtransactionsSummary(t: TransactionDetail) {
  return t.subtransactions
    .filter((s) => !s.deleted)
    .map((s) => ({
      id: s.id,
      amount: milliunitsBrand.parse(s.amount),
      payee_id: s.payee_id,
      payee_name: s.payee_name,
      category_id: s.category_id,
      category_name: s.category_name,
      transfer_account_id: s.transfer_account_id,
      memo: s.memo,
    }));
}

export function transactionSummary(t: TransactionDetail) {
  const subtransactions = subtransactionsSummary(t);
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
    transfer_account_id: t.transfer_account_id,
    transfer_transaction_id: t.transfer_transaction_id,
    memo: t.memo,
    cleared: t.cleared,
    approved: t.approved,
    ...(subtransactions.length > 0 && { subtransactions }),
  };
}

function hybridTransactionSummary(t: HybridTransaction) {
  return {
    id: t.id,
    type: t.type,
    parent_transaction_id: t.parent_transaction_id,
    date: t.date,
    amount: milliunitsBrand.parse(t.amount),
    amount_formatted: t.amount_formatted,
    account_id: t.account_id,
    account_name: t.account_name,
    payee_id: t.payee_id,
    payee_name: t.payee_name,
    category_id: t.category_id,
    category_name: t.category_name,
    transfer_account_id: t.transfer_account_id,
    memo: t.memo,
    cleared: t.cleared,
    approved: t.approved,
  };
}

const subtransactionSchema = z.object({
  amount: milliunitsSchema.describe("Amount of this split line in milliunits (same sign rules)"),
  payee_id: z.string().min(1).optional().describe("Existing YNAB payee id for this split line"),
  payee_name: z.string().optional().describe("Payee name for this split line"),
  category_id: z.string().min(1).optional().describe("YNAB category id for this split line"),
  memo: z.string().optional().describe("Memo for this split line"),
});

type SubtransactionArgs = z.infer<typeof subtransactionSchema>;

const subtransactionsSchema = z
  .array(subtransactionSchema)
  .min(1)
  .describe(
    "Split the transaction into these lines (e.g. a supermarket receipt with a drugstore part). The amounts must add up to the transaction's amount, and category_id must not be set on the parent. " +
      "YNAB only accepts this when creating a transaction or when turning a non-split transaction into a split — the lines of an existing split can't be changed through the API (delete and re-create the transaction instead).",
  );

const transferAccountIdSchema = z
  .string()
  .min(1)
  .describe(
    "Make this a transfer to/from the given account (sets payee_id to that account's transfer payee, which is how the YNAB API models transfers; YNAB creates the counterpart transaction in that account automatically). Mutually exclusive with payee_id/payee_name. " +
      "A transfer between two on-budget accounts (e.g. checking → credit card) needs no category; a transfer from an on-budget to an off-budget tracking account (e.g. checking → ETF depot or loan) needs a category_id. " +
      "To turn two already-imported transactions (one on each account) into a single transfer without creating a duplicate, use ynab_match_transfer instead.",
  );

const newTransactionShape = {
  account_id: z.string().min(1).describe("YNAB account id the transaction belongs to"),
  date: isoDateSchema,
  amount: milliunitsSchema,
  payee_id: z.string().min(1).optional().describe("Existing YNAB payee id"),
  payee_name: z
    .string()
    .optional()
    .describe("Payee name; YNAB creates a new payee if none matches. Ignored if payee_id is set."),
  transfer_account_id: transferAccountIdSchema.optional(),
  category_id: z.string().min(1).optional().describe("YNAB category id to assign"),
  memo: z.string().optional().describe("Transaction memo"),
  cleared: clearedStatusSchema.optional().describe("Defaults to uncleared if omitted"),
  approved: z.boolean().optional().describe("Defaults to false (unapproved) if omitted"),
  subtransactions: subtransactionsSchema.optional(),
};

const transactionUpdateShape = {
  account_id: z.string().min(1).optional().describe("Move the transaction to this account"),
  date: isoDateSchema.optional(),
  amount: milliunitsSchema.optional(),
  payee_id: z.string().min(1).optional().describe("Existing YNAB payee id"),
  payee_name: z
    .string()
    .optional()
    .describe("Payee name; YNAB creates a new payee if none matches. Ignored if payee_id is set."),
  transfer_account_id: transferAccountIdSchema.optional(),
  category_id: z.string().min(1).optional().describe("YNAB category id to assign"),
  memo: z.string().optional(),
  cleared: clearedStatusSchema.optional(),
  approved: z.boolean().optional(),
  subtransactions: subtransactionsSchema.optional(),
};

interface TransactionFieldArgs {
  account_id?: string | undefined;
  date?: string | undefined;
  amount?: number | undefined;
  payee_id?: string | undefined;
  payee_name?: string | undefined;
  transfer_account_id?: string | undefined;
  category_id?: string | undefined;
  memo?: string | undefined;
  cleared?: ClearedStatus | undefined;
  approved?: boolean | undefined;
  subtransactions?: SubtransactionArgs[] | undefined;
}

interface NewTransactionArgs extends TransactionFieldArgs {
  account_id: string;
  date: string;
  amount: number;
}

interface TransactionUpdateArgs extends TransactionFieldArgs {
  id: string;
}

/** Returns a user-facing problem with the field combination, or undefined if it's fine. */
function validateTransactionFields(args: TransactionFieldArgs, label: string): string | undefined {
  if (
    args.transfer_account_id !== undefined &&
    (args.payee_id !== undefined || args.payee_name !== undefined)
  ) {
    return `${label}: transfer_account_id can't be combined with payee_id or payee_name — a transfer's payee is the target account.`;
  }
  if (args.subtransactions !== undefined) {
    if (args.category_id !== undefined) {
      return `${label}: category_id can't be set on a split transaction — put the categories on the subtransactions instead.`;
    }
    if (args.amount !== undefined) {
      const sum = args.subtransactions.reduce((acc, s) => acc + s.amount, 0);
      if (sum !== args.amount) {
        return `${label}: subtransaction amounts add up to ${sum} milliunits, but the transaction amount is ${args.amount}.`;
      }
    }
  }
  return undefined;
}

/**
 * Maps account ids to their transfer payee ids, which is what YNAB actually
 * stores as the payee of a transfer transaction. Uses a single request either
 * way: getAccount for one id, listAccounts for several.
 */
async function resolveTransferPayeeIds(
  ynab: YnabClient,
  budgetId: string,
  accountIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(accountIds)];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const accounts =
    unique.length === 1 && unique[0] !== undefined
      ? [await ynab.getAccount(budgetId, unique[0])]
      : (await ynab.listAccounts(budgetId)).items;
  for (const a of accounts) {
    if (a.transfer_payee_id !== null) result.set(a.id, a.transfer_payee_id);
  }
  for (const id of unique) {
    if (!result.has(id)) {
      throw new YnabToolError(
        `Account ${id} was not found or has no transfer payee, so it can't be used as transfer_account_id.`,
        "invalid_transfer_account",
        false,
      );
    }
  }
  return result;
}

function toSubtransactionInput(s: SubtransactionArgs): SubtransactionInput {
  return {
    amount: s.amount,
    ...(s.payee_id !== undefined && { payeeId: s.payee_id }),
    ...(s.payee_name !== undefined && { payeeName: s.payee_name }),
    ...(s.category_id !== undefined && { categoryId: s.category_id }),
    ...(s.memo !== undefined && { memo: s.memo }),
  };
}

function toTransactionUpdateInput(
  args: TransactionFieldArgs,
  transferPayeeIds: Map<string, string>,
): TransactionUpdateInput {
  const payeeId =
    args.transfer_account_id !== undefined
      ? transferPayeeIds.get(args.transfer_account_id)
      : args.payee_id;
  return {
    ...(args.account_id !== undefined && { accountId: args.account_id }),
    ...(args.date !== undefined && { date: args.date }),
    ...(args.amount !== undefined && { amount: args.amount }),
    ...(payeeId !== undefined && { payeeId }),
    ...(args.payee_name !== undefined && { payeeName: args.payee_name }),
    ...(args.category_id !== undefined && { categoryId: args.category_id }),
    ...(args.memo !== undefined && { memo: args.memo }),
    ...(args.cleared !== undefined && { cleared: args.cleared }),
    ...(args.approved !== undefined && { approved: args.approved }),
    ...(args.subtransactions !== undefined && {
      subtransactions: args.subtransactions.map(toSubtransactionInput),
    }),
  };
}

function toNewTransactionInput(
  args: NewTransactionArgs,
  transferPayeeIds: Map<string, string>,
): NewTransactionInput {
  return {
    ...toTransactionUpdateInput(args, transferPayeeIds),
    accountId: args.account_id,
    date: args.date,
    amount: args.amount,
  };
}

function transferAccountIds(items: TransactionFieldArgs[]): string[] {
  return items.flatMap((t) => (t.transfer_account_id !== undefined ? [t.transfer_account_id] : []));
}

export function registerTransactionTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_transactions",
    {
      title: "List YNAB transactions",
      description:
        `List transactions in a budget. Defaults to the last ${DEFAULT_WINDOW_DAYS} days if since_date is not given, and returns at most ${MAX_RESULTS} transactions per call (most recent first) with has_more indicating whether more exist for the window. ` +
        "Use type (uncategorized/unapproved) and account_id/category_id/payee_id to let YNAB filter server-side instead of fetching everything — e.g. type: 'unapproved' for the monthly review. At most one of account_id/category_id/payee_id may be given (each is a separate YNAB endpoint). " +
        "With category_id or payee_id, split transactions are returned as individual rows: each split line has type 'subtransaction' and parent_transaction_id set. " +
        `Note: the YNAB API has no result-count limit of its own, so this tool always fetches every matching transaction before applying the ${MAX_RESULTS}-result cap — narrow the date range for large or long-lived budgets rather than requesting everything at once, both to keep the response small and to avoid burning YNAB's 200-requests/hour rate limit on an oversized fetch. ` +
        "For repeated polling of the same budget, prefer last_knowledge_of_server over re-fetching the full date range each time.",
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
        type: z
          .enum(["uncategorized", "unapproved"])
          .optional()
          .describe("Only return uncategorized or only unapproved transactions"),
        account_id: z.string().min(1).optional().describe("Only transactions in this account"),
        category_id: z
          .string()
          .min(1)
          .optional()
          .describe("Only transactions (or split lines) in this category"),
        payee_id: z
          .string()
          .min(1)
          .optional()
          .describe("Only transactions (or split lines) with this payee"),
        last_knowledge_of_server: lastKnowledgeOfServerSchema
          .optional()
          .describe(
            "Delta sync cursor: pass the server_knowledge value from a previous ynab_list_transactions call to receive only transactions that changed since then (ignores since_date/until_date filtering on the delta itself, though YNAB still applies them). Omit for a full fetch. server_knowledge may be null when filtering by category_id/payee_id.",
          ),
      },
      annotations: READ_ONLY,
    },
    async ({
      budget_id,
      since_date,
      until_date,
      type,
      account_id,
      category_id,
      payee_id,
      last_knowledge_of_server,
    }: {
      budget_id: string;
      since_date?: string | undefined;
      until_date?: string | undefined;
      type?: TransactionTypeFilter | undefined;
      account_id?: string | undefined;
      category_id?: string | undefined;
      payee_id?: string | undefined;
      last_knowledge_of_server?: number | undefined;
    }) => {
      const sinceDate = since_date ?? defaultSinceDate();
      if (until_date !== undefined && sinceDate > until_date) {
        return errorToolResult(
          `since_date (${sinceDate}) must not be after until_date (${until_date}).`,
        );
      }
      const scopes = [account_id, category_id, payee_id].filter((x) => x !== undefined);
      if (scopes.length > 1) {
        return errorToolResult(
          "Pass at most one of account_id, category_id, payee_id — YNAB has a separate endpoint for each and can't combine them.",
        );
      }

      return withYnabErrorHandling(async () => {
        const options = {
          sinceDate,
          ...(until_date !== undefined && { untilDate: until_date }),
          ...(type !== undefined && { type }),
          ...(last_knowledge_of_server !== undefined && {
            lastKnowledgeOfServer: last_knowledge_of_server,
          }),
        };

        let rows: { date: string; deleted: boolean; summary: object }[];
        let serverKnowledge: number | null;
        const filter =
          category_id !== undefined
            ? { categoryId: category_id }
            : payee_id !== undefined
              ? { payeeId: payee_id }
              : undefined;
        if (filter !== undefined) {
          const res = await ynab.listTransactionsByCategoryOrPayee(budget_id, filter, options);
          rows = res.items.map((t) => ({
            date: t.date,
            deleted: t.deleted,
            summary: hybridTransactionSummary(t),
          }));
          serverKnowledge = res.serverKnowledge;
        } else {
          const res = await ynab.listTransactions(budget_id, {
            ...options,
            ...(account_id !== undefined && { accountId: account_id }),
          });
          rows = res.items.map((t) => ({
            date: t.date,
            deleted: t.deleted,
            summary: transactionSummary(t),
          }));
          serverKnowledge = res.serverKnowledge;
        }

        const sorted = rows
          .filter((r) => !r.deleted)
          .sort((a, b) => {
            if (a.date < b.date) return 1;
            if (a.date > b.date) return -1;
            return 0;
          });
        return jsonToolResult({
          transactions: sorted.slice(0, MAX_RESULTS).map((r) => r.summary),
          has_more: sorted.length > MAX_RESULTS,
          server_knowledge: serverKnowledge,
        });
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
        const { items: transactions } = await ynab.listTransactions(budget_id, {
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
        "Create a single transaction. Amount is in milliunits: negative = outflow (spending), positive = inflow. Supports transfers (transfer_account_id) and split transactions (subtransactions).",
      inputSchema: { budget_id: budgetIdSchema, ...newTransactionShape },
      annotations: CREATES,
    },
    async ({ budget_id, ...rest }: { budget_id: string } & NewTransactionArgs) => {
      const problem = validateTransactionFields(rest, "transaction");
      if (problem !== undefined) return errorToolResult(problem);

      return withYnabErrorHandling(async () => {
        const transferPayeeIds = await resolveTransferPayeeIds(
          ynab,
          budget_id,
          transferAccountIds([rest]),
        );
        const t = await ynab.createTransaction(
          budget_id,
          toNewTransactionInput(rest, transferPayeeIds),
        );
        return jsonToolResult(transactionSummary(t));
      });
    },
  );

  server.registerTool(
    "ynab_create_transactions_bulk",
    {
      title: "Create multiple YNAB transactions",
      description:
        "Create multiple transactions in a single call. Amounts are in milliunits: negative = outflow (spending), positive = inflow. Each transaction supports transfer_account_id and subtransactions like ynab_create_transaction.",
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
      transactions: NewTransactionArgs[];
    }) => {
      for (const [i, t] of transactions.entries()) {
        const problem = validateTransactionFields(t, `transactions[${i}]`);
        if (problem !== undefined) return errorToolResult(problem);
      }

      return withYnabErrorHandling(async () => {
        const transferPayeeIds = await resolveTransferPayeeIds(
          ynab,
          budget_id,
          transferAccountIds(transactions),
        );
        const created = await ynab.createTransactionsBulk(
          budget_id,
          transactions.map((t) => toNewTransactionInput(t, transferPayeeIds)),
        );
        return jsonToolResult(created.map(transactionSummary));
      });
    },
  );

  server.registerTool(
    "ynab_update_transaction",
    {
      title: "Update a YNAB transaction",
      description:
        "Update a transaction's account, date, amount, payee, category, memo, cleared status, and/or approved status. Only the fields provided are changed — this single tool covers approving a transaction, categorizing it, editing its amount, turning it into a transfer (transfer_account_id), etc. " +
        "To update many transactions at once (e.g. categorizing and approving a month), use ynab_update_transactions_bulk instead — it costs one API request instead of one per transaction.",
      inputSchema: {
        budget_id: budgetIdSchema,
        transaction_id: z.string().min(1).describe("YNAB transaction id"),
        ...transactionUpdateShape,
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      transaction_id,
      ...rest
    }: { budget_id: string; transaction_id: string } & TransactionFieldArgs) => {
      const problem = validateTransactionFields(rest, "transaction");
      if (problem !== undefined) return errorToolResult(problem);

      return withYnabErrorHandling(async () => {
        const transferPayeeIds = await resolveTransferPayeeIds(
          ynab,
          budget_id,
          transferAccountIds([rest]),
        );
        const t = await ynab.updateTransaction(
          budget_id,
          transaction_id,
          toTransactionUpdateInput(rest, transferPayeeIds),
        );
        return jsonToolResult(transactionSummary(t));
      });
    },
  );

  server.registerTool(
    "ynab_update_transactions_bulk",
    {
      title: "Update multiple YNAB transactions",
      description:
        "Update many transactions in a single API request (YNAB's PATCH /transactions bulk endpoint) — e.g. categorize and approve a whole month at once without spending one request per transaction against YNAB's 200-requests/hour limit. " +
        "Each entry needs the transaction id plus only the fields to change; the same fields as ynab_update_transaction are supported.",
      inputSchema: {
        budget_id: budgetIdSchema,
        transactions: z
          .array(
            z.object({
              id: z.string().min(1).describe("YNAB transaction id to update"),
              ...transactionUpdateShape,
            }),
          )
          .min(1)
          .describe("Transactions to update, each with its id and the fields to change"),
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      transactions,
    }: {
      budget_id: string;
      transactions: TransactionUpdateArgs[];
    }) => {
      for (const [i, t] of transactions.entries()) {
        const problem = validateTransactionFields(t, `transactions[${i}]`);
        if (problem !== undefined) return errorToolResult(problem);
      }

      return withYnabErrorHandling(async () => {
        const transferPayeeIds = await resolveTransferPayeeIds(
          ynab,
          budget_id,
          transferAccountIds(transactions),
        );
        const updates: BulkTransactionUpdateInput[] = transactions.map((t) => ({
          id: t.id,
          ...toTransactionUpdateInput(t, transferPayeeIds),
        }));
        const updated = await ynab.updateTransactionsBulk(budget_id, updates);
        return jsonToolResult(updated.map(transactionSummary));
      });
    },
  );

  server.registerTool(
    "ynab_match_transfer",
    {
      title: "Match two imported YNAB transactions as one transfer",
      description:
        "Turn two existing transactions that are the two sides of the same money movement (e.g. a credit card payment imported once on the checking account and once on the credit card account) into a single YNAB transfer, without leaving a duplicate. " +
        "Converts transaction_id into a transfer to counterpart_transaction_id's account (YNAB then creates the transfer's counterpart there automatically), copies the counterpart's cleared status onto that new counterpart, and permanently deletes counterpart_transaction_id. " +
        "Both transactions must be on different accounts, have opposite amounts, and neither may already be a transfer. Requires confirm: true because a transaction is deleted. " +
        "If the other side hasn't been imported yet, use ynab_update_transaction with transfer_account_id instead — YNAB matches the later import against the transfer it created.",
      inputSchema: {
        budget_id: budgetIdSchema,
        transaction_id: z
          .string()
          .min(1)
          .describe("The transaction to keep and convert into a transfer"),
        counterpart_transaction_id: z
          .string()
          .min(1)
          .describe("The duplicate on the other account, which gets deleted"),
        confirm: confirmSchema,
      },
      annotations: DELETES,
    },
    async ({
      budget_id,
      transaction_id,
      counterpart_transaction_id,
    }: {
      budget_id: string;
      transaction_id: string;
      counterpart_transaction_id: string;
      confirm: true;
    }) => {
      if (transaction_id === counterpart_transaction_id) {
        return errorToolResult("transaction_id and counterpart_transaction_id must differ.");
      }

      return withYnabErrorHandling(async () => {
        const source = await ynab.getTransaction(budget_id, transaction_id);
        const counterpart = await ynab.getTransaction(budget_id, counterpart_transaction_id);
        const problem = (() => {
          if (source.account_id === counterpart.account_id)
            return "Both transactions are on the same account; a transfer needs two different accounts.";
          if (source.amount !== -counterpart.amount)
            return `Amounts don't mirror each other (${source.amount} vs. ${counterpart.amount} milliunits); a transfer's two sides must have opposite amounts.`;
          if (source.transfer_account_id || counterpart.transfer_account_id)
            return "At least one of the transactions is already a transfer.";
          return undefined;
        })();
        if (problem !== undefined) return errorToolResult(problem);

        const targetAccount = await ynab.getAccount(budget_id, counterpart.account_id);
        if (targetAccount.transfer_payee_id === null) {
          return errorToolResult(`Account ${targetAccount.name} has no transfer payee.`);
        }
        // Convert first, delete second: if the delete fails, the user is left
        // with a recoverable duplicate rather than a lost transaction.
        const converted = await ynab.updateTransaction(budget_id, transaction_id, {
          payeeId: targetAccount.transfer_payee_id,
        });
        const deleted = await ynab.deleteTransaction(budget_id, counterpart_transaction_id);

        let newCounterpart: TransactionDetail | undefined;
        if (converted.transfer_transaction_id) {
          newCounterpart = await ynab.updateTransaction(
            budget_id,
            converted.transfer_transaction_id,
            { cleared: counterpart.cleared, approved: counterpart.approved },
          );
        }
        return jsonToolResult({
          transfer: transactionSummary(converted),
          transfer_counterpart: newCounterpart ? transactionSummary(newCounterpart) : null,
          deleted_duplicate: transactionSummary(deleted),
        });
      });
    },
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

  server.registerTool(
    "ynab_import_transactions",
    {
      title: "Import YNAB transactions from linked banks",
      description:
        'Trigger a bank import on all linked (Direct Import) accounts of the budget — the same as clicking "Import" in the YNAB web app. Returns the ids of newly imported transactions (empty if there was nothing new). Accounts without a bank connection are unaffected.',
      inputSchema: { budget_id: budgetIdSchema },
      annotations: CREATES,
    },
    async ({ budget_id }: { budget_id: string }) =>
      withYnabErrorHandling(async () => {
        const ids = await ynab.importTransactions(budget_id);
        return jsonToolResult({ imported_count: ids.length, transaction_ids: ids });
      }),
  );
}
