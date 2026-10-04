import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AccountType, YnabClient } from "../ynab/client.js";
import {
  budgetIdSchema,
  lastKnowledgeOfServerSchema,
  milliunitsSchema,
} from "../schemas/common.js";
import { milliunitsBrand } from "../ynab/types.js";
import { CREATES, jsonToolResult, READ_ONLY, withYnabErrorHandling } from "./helpers.js";
import type { Account } from "ynab";

const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "creditCard",
  "otherAsset",
  "otherLiability",
] as const;

function accountSummary(a: Account) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    on_budget: a.on_budget,
    closed: a.closed,
    balance: milliunitsBrand.parse(a.balance),
    balance_formatted: a.balance_formatted,
    cleared_balance: milliunitsBrand.parse(a.cleared_balance),
    uncleared_balance: milliunitsBrand.parse(a.uncleared_balance),
    transfer_payee_id: a.transfer_payee_id,
    direct_import_linked: a.direct_import_linked,
    last_reconciled_at: a.last_reconciled_at,
  };
}

export function registerAccountTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_accounts",
    {
      title: "List YNAB accounts",
      description:
        "List all accounts (checking, savings, credit card, etc.) in a budget, with balances in milliunits. Each account's transfer_payee_id is the payee id YNAB uses for transfers into that account.",
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
        const { items, serverKnowledge } = await ynab.listAccounts(
          budget_id,
          last_knowledge_of_server,
        );
        const summary = items.filter((a) => !a.deleted).map(accountSummary);
        return jsonToolResult({ accounts: summary, server_knowledge: serverKnowledge });
      }),
  );

  server.registerTool(
    "ynab_get_account",
    {
      title: "Get a YNAB account",
      description:
        "Get a single account by id, with balances in milliunits. For loan accounts this includes the interest rates, minimum payments and escrow amounts configured in YNAB (read-only — the API can't set them).",
      inputSchema: {
        budget_id: budgetIdSchema,
        account_id: z.string().min(1).describe("YNAB account id"),
      },
      annotations: READ_ONLY,
    },
    async ({ budget_id, account_id }: { budget_id: string; account_id: string }) =>
      withYnabErrorHandling(async () => {
        const a = await ynab.getAccount(budget_id, account_id);
        return jsonToolResult({
          ...accountSummary(a),
          note: a.note,
          debt_original_balance: a.debt_original_balance,
          debt_interest_rates: a.debt_interest_rates,
          debt_minimum_payments: a.debt_minimum_payments,
          debt_escrow_amounts: a.debt_escrow_amounts,
        });
      }),
  );

  server.registerTool(
    "ynab_create_account",
    {
      title: "Create a YNAB account",
      description:
        "Create a new account. checking/savings/cash/creditCard create on-budget accounts; otherAsset and otherLiability create off-budget tracking accounts (e.g. an investment depot, or a loan tracked as a plain liability). " +
        "These six are the only types YNAB's API accepts when creating an account: loan accounts (mortgage, autoLoan, studentLoan, personalLoan, medicalDebt, otherDebt) and lineOfCredit can only be created in the YNAB app, and a loan's interest rate, minimum payment and escrow can't be set through the API either. Use otherLiability as a workaround when a loan should just be tracked without YNAB's loan features. " +
        "There is no API-supported way to close/delete an account afterwards — YNAB's public API has no update or close endpoint for accounts, only create and read, so this action can't be undone through this server (or any other API client).",
      inputSchema: {
        budget_id: budgetIdSchema,
        name: z.string().min(1).describe("Name for the new account"),
        type: z.enum(ACCOUNT_TYPES).describe("The type of account to create"),
        balance: milliunitsSchema.describe(
          "Starting balance for the account, in milliunits (negative for a liability such as a credit card debt or loan)",
        ),
      },
      annotations: CREATES,
    },
    async ({
      budget_id,
      name,
      type,
      balance,
    }: {
      budget_id: string;
      name: string;
      type: AccountType;
      balance: number;
    }) =>
      withYnabErrorHandling(async () => {
        const a = await ynab.createAccount(budget_id, { name, type, balance });
        return jsonToolResult(accountSummary(a));
      }),
  );
}
