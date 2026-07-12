import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YnabClient } from "../ynab/client.js";
import { budgetIdSchema, isoDateSchema } from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { errorToolResult, jsonToolResult, READ_ONLY, withYnabErrorHandling } from "./helpers.js";

const DEFAULT_WINDOW_DAYS = 30;
const MAX_RESULTS = 200;

function defaultSinceDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
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
}
