import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import type { ListResult, YnabClient } from "../../src/ynab/client.js";
import type { Account, PlanSummary, TransactionDetail } from "ynab";

function emptyList<T>(): ListResult<T> {
  return { items: [], serverKnowledge: 0 };
}

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
    listAccounts: async () => emptyList(),
    getAccount: async () => {
      throw new Error("getAccount not implemented in this mock");
    },
    createAccount: async () => {
      throw new Error("createAccount not implemented in this mock");
    },
    listCategories: async () => emptyList(),
    getCategory: async () => {
      throw new Error("getCategory not implemented in this mock");
    },
    createCategoryGroup: async () => {
      throw new Error("createCategoryGroup not implemented in this mock");
    },
    updateCategoryGroup: async () => {
      throw new Error("updateCategoryGroup not implemented in this mock");
    },
    createCategory: async () => {
      throw new Error("createCategory not implemented in this mock");
    },
    updateCategory: async () => {
      throw new Error("updateCategory not implemented in this mock");
    },
    assignBudgetedAmount: async () => {
      throw new Error("assignBudgetedAmount not implemented in this mock");
    },
    listMonths: async () => emptyList(),
    getMonth: async () => {
      throw new Error("getMonth not implemented in this mock");
    },
    listPayees: async () => emptyList(),
    getPayee: async () => {
      throw new Error("getPayee not implemented in this mock");
    },
    createPayee: async () => {
      throw new Error("createPayee not implemented in this mock");
    },
    updatePayee: async () => {
      throw new Error("updatePayee not implemented in this mock");
    },
    listScheduledTransactions: async () => emptyList(),
    listTransactions: async () => emptyList(),
    createTransaction: async () => {
      throw new Error("createTransaction not implemented in this mock");
    },
    createTransactionsBulk: async () => {
      throw new Error("createTransactionsBulk not implemented in this mock");
    },
    updateTransaction: async () => {
      throw new Error("updateTransaction not implemented in this mock");
    },
    deleteTransaction: async () => {
      throw new Error("deleteTransaction not implemented in this mock");
    },
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
  it("advertises all implemented tools", async () => {
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
        "ynab_create_account",
        "ynab_list_categories",
        "ynab_get_category",
        "ynab_create_category_group",
        "ynab_update_category_group",
        "ynab_create_category",
        "ynab_update_category",
        "ynab_assign_budgeted_amount",
        "ynab_list_months",
        "ynab_get_month",
        "ynab_list_payees",
        "ynab_get_payee",
        "ynab_create_payee",
        "ynab_update_payee",
        "ynab_list_scheduled_transactions",
        "ynab_list_transactions",
        "ynab_get_spending_summary",
        "ynab_create_transaction",
        "ynab_create_transactions_bulk",
        "ynab_update_transaction",
        "ynab_delete_transaction",
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
          return emptyList();
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
        listTransactions: async () => ({
          items: [
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
          serverKnowledge: 0,
        }),
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

  it("ynab_create_category creates a category via the category group id and echoes the created fields", async () => {
    let receivedInput: unknown;
    const client = await connectedClient(
      mockYnabClient({
        createCategory: async (budgetId, input) => {
          receivedInput = { budgetId, input };
          return {
            id: "c1",
            category_group_id: input.categoryGroupId,
            name: input.name,
            hidden: false,
            internal: false,
            budgeted: 0,
            activity: 0,
            balance: 0,
            deleted: false,
            ...(input.note !== undefined && { note: input.note }),
          };
        },
      }),
    );

    const result = await client.callTool({
      name: "ynab_create_category",
      arguments: {
        budget_id: "last-used",
        category_group_id: "cg1",
        name: "Groceries",
        note: "weekly shop",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedInput).toEqual({
      budgetId: "last-used",
      input: { categoryGroupId: "cg1", name: "Groceries", note: "weekly shop" },
    });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed).toEqual({
      id: "c1",
      category_group_id: "cg1",
      category_group_name: undefined,
      name: "Groceries",
      hidden: false,
      note: "weekly shop",
      budgeted: 0,
      activity: 0,
      balance: 0,
    });
  });

  it("ynab_assign_budgeted_amount passes the milliunits amount through unchanged", async () => {
    let received: unknown;
    const client = await connectedClient(
      mockYnabClient({
        assignBudgetedAmount: async (budgetId, month, categoryId, budgeted) => {
          received = { budgetId, month, categoryId, budgeted };
          return {
            id: categoryId,
            category_group_id: "cg1",
            name: "Groceries",
            hidden: false,
            internal: false,
            budgeted,
            activity: 0,
            balance: budgeted,
            deleted: false,
          };
        },
      }),
    );

    const result = await client.callTool({
      name: "ynab_assign_budgeted_amount",
      arguments: {
        budget_id: "last-used",
        month: "2026-07-01",
        category_id: "c1",
        budgeted: 50_000,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(received).toEqual({
      budgetId: "last-used",
      month: "2026-07-01",
      categoryId: "c1",
      budgeted: 50_000,
    });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.budgeted).toBe(50_000);
  });

  it("ynab_create_transaction passes amount/fields through unchanged and echoes the created transaction", async () => {
    let receivedInput: unknown;
    const client = await connectedClient(
      mockYnabClient({
        createTransaction: async (budgetId, input) => {
          receivedInput = { budgetId, input };
          return fakeTransaction({
            id: "t1",
            account_id: input.accountId,
            date: input.date,
            amount: input.amount,
            ...(input.categoryId !== undefined && { category_id: input.categoryId }),
          });
        },
      }),
    );

    const result = await client.callTool({
      name: "ynab_create_transaction",
      arguments: {
        budget_id: "last-used",
        account_id: "a1",
        date: "2026-07-01",
        amount: -25_000,
        category_id: "c1",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedInput).toEqual({
      budgetId: "last-used",
      input: { accountId: "a1", date: "2026-07-01", amount: -25_000, categoryId: "c1" },
    });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed).toMatchObject({ id: "t1", date: "2026-07-01", amount: -25_000 });
  });

  it("rejects ynab_delete_transaction when confirm is not explicitly true, without calling the YNAB client", async () => {
    let called = false;
    const client = await connectedClient(
      mockYnabClient({
        deleteTransaction: async () => {
          called = true;
          return fakeTransaction();
        },
      }),
    );

    const result = await client.callTool({
      name: "ynab_delete_transaction",
      arguments: { budget_id: "last-used", transaction_id: "t1", confirm: false },
    });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("ynab_delete_transaction deletes and echoes the deleted transaction when confirm is true", async () => {
    const client = await connectedClient(
      mockYnabClient({
        deleteTransaction: async (budgetId, transactionId) =>
          fakeTransaction({ id: transactionId, deleted: true }),
      }),
    );

    const result = await client.callTool({
      name: "ynab_delete_transaction",
      arguments: { budget_id: "last-used", transaction_id: "t1", confirm: true },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.id).toBe("t1");
  });

  it("ynab_create_account passes the type and starting balance through unchanged", async () => {
    let receivedInput: unknown;
    const client = await connectedClient(
      mockYnabClient({
        createAccount: async (budgetId, input) => {
          receivedInput = { budgetId, input };
          return fakeAccount({
            id: "a1",
            name: input.name,
            type: input.type,
            balance: input.balance,
          });
        },
      }),
    );

    const result = await client.callTool({
      name: "ynab_create_account",
      arguments: {
        budget_id: "last-used",
        name: "New Checking",
        type: "checking",
        balance: 100_000,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedInput).toEqual({
      budgetId: "last-used",
      input: { name: "New Checking", type: "checking", balance: 100_000 },
    });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed).toMatchObject({
      id: "a1",
      name: "New Checking",
      type: "checking",
      balance: 100_000,
    });
  });

  it("ynab_create_payee and ynab_update_payee round-trip the payee name", async () => {
    const client = await connectedClient(
      mockYnabClient({
        createPayee: async (_budgetId, name) => ({ id: "p1", name, deleted: false }),
        updatePayee: async (_budgetId, payeeId, name) => ({ id: payeeId, name, deleted: false }),
      }),
    );

    const created = await client.callTool({
      name: "ynab_create_payee",
      arguments: { budget_id: "last-used", name: "Corner Store" },
    });
    expect(created.isError).toBeFalsy();
    expect(JSON.parse(textOf(created.content))).toMatchObject({ id: "p1", name: "Corner Store" });

    const updated = await client.callTool({
      name: "ynab_update_payee",
      arguments: { budget_id: "last-used", payee_id: "p1", name: "Corner Store Renamed" },
    });
    expect(updated.isError).toBeFalsy();
    expect(JSON.parse(textOf(updated.content))).toMatchObject({
      id: "p1",
      name: "Corner Store Renamed",
    });
  });

  it("ynab_list_transactions passes last_knowledge_of_server through and returns the new server_knowledge cursor", async () => {
    let receivedOptions: unknown;
    const client = await connectedClient(
      mockYnabClient({
        listTransactions: async (_budgetId, options) => {
          receivedOptions = options;
          return { items: [fakeTransaction({ id: "t1" })], serverKnowledge: 42 };
        },
      }),
    );

    const result = await client.callTool({
      name: "ynab_list_transactions",
      arguments: { budget_id: "last-used", last_knowledge_of_server: 17 },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedOptions).toMatchObject({ lastKnowledgeOfServer: 17 });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.server_knowledge).toBe(42);
  });
});
