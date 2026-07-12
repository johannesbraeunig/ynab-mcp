import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import type { YnabClient } from "../../src/ynab/client.js";
import type { Account, PlanSummary, TransactionDetail } from "ynab";

function fakeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "a1",
    name: "Checking",
    type: "checking",
    on_budget: true,
    closed: false,
    balance: 0,
    cleared_balance: 0,
    uncleared_balance: 0,
    transfer_payee_id: "p1",
    deleted: false,
    ...overrides,
  };
}

function fakeTransaction(overrides: Partial<TransactionDetail> = {}): TransactionDetail {
  return {
    id: "t1",
    date: "2026-01-01",
    amount: 0,
    cleared: "cleared",
    approved: true,
    account_id: "a1",
    account_name: "Checking",
    subtransactions: [],
    deleted: false,
    ...overrides,
  };
}

function mockYnabClient(overrides: Partial<YnabClient> = {}): YnabClient {
  return {
    getUser: async () => ({ id: "u1" }),
    listBudgets: async () => [],
    getBudget: async () => {
      throw new Error("getBudget not implemented in this mock");
    },
    getBudgetSettings: async () => {
      throw new Error("getBudgetSettings not implemented in this mock");
    },
    listAccounts: async () => [],
    getAccount: async () => {
      throw new Error("getAccount not implemented in this mock");
    },
    listCategories: async () => [],
    getCategory: async () => {
      throw new Error("getCategory not implemented in this mock");
    },
    listMonths: async () => [],
    getMonth: async () => {
      throw new Error("getMonth not implemented in this mock");
    },
    listPayees: async () => [],
    getPayee: async () => {
      throw new Error("getPayee not implemented in this mock");
    },
    listScheduledTransactions: async () => [],
    listTransactions: async () => [],
    ...overrides,
  };
}

async function connectedClient(ynab: YnabClient) {
  const server = createServer({ accessToken: "test-token" }, () => ynab);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) {
    throw new Error("expected tool result content to be an array");
  }
  const [block] = content;
  if (
    typeof block !== "object" ||
    block === null ||
    !("type" in block) ||
    block.type !== "text" ||
    !("text" in block) ||
    typeof block.text !== "string"
  ) {
    throw new Error("expected first content block to be a text block");
  }
  return block.text;
}

describe("MCP server", () => {
  it("advertises all read-only analysis tools", async () => {
    const client = await connectedClient(mockYnabClient());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "ynab_get_user",
        "ynab_list_budgets",
        "ynab_get_budget",
        "ynab_get_budget_settings",
        "ynab_list_accounts",
        "ynab_get_account",
        "ynab_list_categories",
        "ynab_get_category",
        "ynab_list_months",
        "ynab_get_month",
        "ynab_list_payees",
        "ynab_get_payee",
        "ynab_list_scheduled_transactions",
        "ynab_list_transactions",
        "ynab_get_spending_summary",
      ].sort(),
    );
  });

  it("round-trips ynab_list_budgets through real JSON-RPC serialization", async () => {
    const budget: PlanSummary = {
      id: "b1",
      name: "My Budget",
      last_modified_on: "2026-01-01T00:00:00Z",
      first_month: "2026-01-01",
      last_month: "2026-06-01",
    };
    const client = await connectedClient(mockYnabClient({ listBudgets: async () => [budget] }));

    const result = await client.callTool({ name: "ynab_list_budgets", arguments: {} });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed).toEqual([
      {
        id: "b1",
        name: "My Budget",
        last_modified_on: "2026-01-01T00:00:00Z",
        first_month: "2026-01-01",
        last_month: "2026-06-01",
        currency_format: undefined,
      },
    ]);
  });

  it("rejects a malformed budget_id argument via the JSON-Schema-derived input validation", async () => {
    const client = await connectedClient(mockYnabClient());
    const result = await client.callTool({
      name: "ynab_get_budget",
      arguments: { budget_id: "" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/Invalid arguments/);
  });

  it("rejects ynab_list_transactions when since_date is after until_date, without calling the YNAB client", async () => {
    let called = false;
    const client = await connectedClient(
      mockYnabClient({
        listTransactions: async () => {
          called = true;
          return [];
        },
      }),
    );

    const result = await client.callTool({
      name: "ynab_list_transactions",
      arguments: { budget_id: "last-used", since_date: "2026-06-01", until_date: "2026-01-01" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/since_date .* must not be after until_date/);
    expect(called).toBe(false);
  });

  it("ynab_get_budget returns a bounded overview, not the raw unbounded plan export", async () => {
    const client = await connectedClient(
      mockYnabClient({
        getBudget: async () => ({
          id: "b1",
          name: "My Budget",
          accounts: [
            fakeAccount({ id: "a1", deleted: false }),
            fakeAccount({ id: "a2", deleted: true }),
          ],
          transactions: Array.from({ length: 5000 }, () => fakeTransaction()),
        }),
      }),
    );

    const result = await client.callTool({
      name: "ynab_get_budget",
      arguments: { budget_id: "last-used" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed).toEqual({
      id: "b1",
      name: "My Budget",
      last_modified_on: undefined,
      first_month: undefined,
      last_month: undefined,
      date_format: undefined,
      currency_format: undefined,
      accounts_count: 1,
      category_groups_count: 0,
      categories_count: 0,
      payees_count: 0,
      months_count: 0,
      transactions_count: 5000,
      scheduled_transactions_count: 0,
    });
  });

  it("surfaces a YNAB error as an MCP tool error, not a protocol error", async () => {
    const client = await connectedClient(
      mockYnabClient({
        listAccounts: async () => {
          throw { error: { id: "401", name: "not_authorized", detail: "Unauthorized" } };
        },
      }),
    );

    const result = await client.callTool({
      name: "ynab_list_accounts",
      arguments: { budget_id: "last-used" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/YNAB_ACCESS_TOKEN/);
  });

  it("ynab_get_spending_summary aggregates outflow/inflow per category", async () => {
    const client = await connectedClient(
      mockYnabClient({
        listTransactions: async () => [
          fakeTransaction({
            id: "t1",
            category_id: "c1",
            category_name: "Groceries",
            amount: -50_000,
          }),
          fakeTransaction({
            id: "t2",
            category_id: "c1",
            category_name: "Groceries",
            amount: -25_000,
          }),
          fakeTransaction({ id: "t3", amount: -10_000 }),
          fakeTransaction({
            id: "t4",
            category_id: "c2",
            category_name: "Salary",
            amount: 500_000,
          }),
          fakeTransaction({ id: "t5", deleted: true, category_id: "c1", amount: -999_000 }),
        ],
      }),
    );

    const result = await client.callTool({
      name: "ynab_get_spending_summary",
      arguments: { budget_id: "last-used", since_date: "2026-01-01", until_date: "2026-01-31" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed).toEqual({
      since_date: "2026-01-01",
      until_date: "2026-01-31",
      categories: [
        {
          category_id: "c1",
          category_name: "Groceries",
          outflow: 75_000,
          inflow: 0,
          transaction_count: 2,
        },
        {
          category_id: null,
          category_name: null,
          outflow: 10_000,
          inflow: 0,
          transaction_count: 1,
        },
        {
          category_id: "c2",
          category_name: "Salary",
          outflow: 0,
          inflow: 500_000,
          transaction_count: 1,
        },
      ],
    });
  });
});
