import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YnabClient } from "../ynab/client.js";
import { budgetIdSchema, isoDateSchema, milliunitsSchema } from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { jsonToolResult, UPDATES, withYnabErrorHandling } from "./helpers.js";
import { transactionSummary } from "./transactions.js";

const ADJUSTMENT_PAYEE_NAME = "Reconciliation Balance Adjustment";

export function registerReconcileTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_reconcile_account",
    {
      title: "Reconcile a YNAB account",
      description:
        "Reconcile an account against a bank statement, like YNAB's \"Reconcile\" button: compares statement_balance with the account's cleared balance as of statement_date (sum of all cleared and reconciled transactions dated on or before it), " +
        `then marks every cleared transaction up to that date as reconciled and, if the two balances differ, creates a "${ADJUSTMENT_PAYEE_NAME}" transaction for the difference. ` +
        "Run with dry_run: true first: it only reports the cleared balance, the difference and how many transactions would be reconciled, without changing anything. A non-zero difference usually means a missing or uncleared transaction — check before letting the tool book an adjustment. " +
        "Fetches the account's full transaction history (one request) plus at most two write requests.",
      inputSchema: {
        budget_id: budgetIdSchema,
        account_id: z.string().min(1).describe("YNAB account id to reconcile"),
        statement_balance: milliunitsSchema.describe(
          "The balance according to the bank statement, in milliunits (negative for a credit card or loan balance owed)",
        ),
        statement_date: isoDateSchema
          .optional()
          .describe("Date of the statement balance. Defaults to today."),
        dry_run: z
          .boolean()
          .optional()
          .describe("Only report the difference; change nothing. Defaults to false."),
        adjustment_category_id: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Category for the adjustment transaction, if one is needed. YNAB's own reconcile uses 'Inflow: Ready to Assign' for on-budget accounts; omit to leave the adjustment uncategorized.",
          ),
      },
      annotations: UPDATES,
    },
    async ({
      budget_id,
      account_id,
      statement_balance,
      statement_date,
      dry_run,
      adjustment_category_id,
    }: {
      budget_id: string;
      account_id: string;
      statement_balance: number;
      statement_date?: string | undefined;
      dry_run?: boolean | undefined;
      adjustment_category_id?: string | undefined;
    }) =>
      withYnabErrorHandling(async () => {
        const date = statement_date ?? new Date().toISOString().slice(0, 10);
        const { items } = await ynab.listTransactions(budget_id, { accountId: account_id });
        const upToDate = items.filter((t) => !t.deleted && t.date <= date);

        const clearedBalance = upToDate
          .filter((t) => t.cleared !== "uncleared")
          .reduce((sum, t) => sum + t.amount, 0);
        const difference = statement_balance - clearedBalance;
        const toReconcile = upToDate.filter((t) => t.cleared === "cleared");
        const unclearedCount = upToDate.filter((t) => t.cleared === "uncleared").length;

        const report = {
          account_id,
          statement_date: date,
          statement_balance: milliunitsBrand.parse(statement_balance),
          cleared_balance: milliunitsBrand.parse(clearedBalance),
          difference: milliunitsBrand.parse(difference),
          transactions_to_reconcile: toReconcile.length,
          uncleared_transactions_up_to_date: unclearedCount,
        };
        if (dry_run === true) {
          return jsonToolResult({ dry_run: true, ...report });
        }

        const adjustment =
          difference !== 0
            ? await ynab.createTransaction(budget_id, {
                accountId: account_id,
                date,
                amount: difference,
                payeeName: ADJUSTMENT_PAYEE_NAME,
                memo: "Entered automatically by ynab-mcp reconciliation",
                cleared: "reconciled",
                approved: true,
                ...(adjustment_category_id !== undefined && {
                  categoryId: adjustment_category_id,
                }),
              })
            : undefined;
        const reconciled =
          toReconcile.length > 0
            ? await ynab.updateTransactionsBulk(
                budget_id,
                toReconcile.map((t) => ({ id: t.id, cleared: "reconciled" })),
              )
            : [];

        return jsonToolResult({
          dry_run: false,
          ...report,
          reconciled_count: reconciled.length,
          adjustment: adjustment ? transactionSummary(adjustment) : null,
        });
      }),
  );
}
