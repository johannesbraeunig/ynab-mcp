import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import type { Account, Category, TransactionDetail } from "ynab";

/**
 * These tests exercise the real YnabClient (src/ynab/client.ts) and the
 * `ynab` SDK against mocked HTTP responses via MSW, rather than a
 * hand-written fake of the YnabClient interface. This covers the SDK
 * adapter itself — the highest-risk file per the design plan, since it's
 * the only place that translates "budget" vocabulary to the SDK's
 * `planId`-based wire format — which a hand-rolled interface mock would
 * bypass entirely.
 */
const BASE = "https://api.ynab.com/v1";

const mswServer = setupServer();

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mswServer.resetHandlers();
  mswServer.events.removeAllListeners();
});
afterAll(() => mswServer.close());

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

function fakeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "c1",
    category_group_id: "cg1",
    name: "Groceries",
    hidden: false,
    internal: false,
    budgeted: 0,
    activity: 0,
    balance: 0,
    deleted: false,
    ...overrides,
  };
}

function saveTransactionsResponse(transactions: TransactionDetail[]) {
  return HttpResponse.json({
    data: {
      transaction_ids: transactions.map((t) => t.id),
      transactions,
      server_knowledge: 1,
    },
  });
}

function ynabErrorResponse(status: number, id: string, name: string, detail: string) {
  return HttpResponse.json({ error: { id, name, detail } }, { status });
}

async function connectedClient() {
  const server = createServer({ accessToken: "test-token" });
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
    const client = await connectedClient();
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
        "ynab_update_transactions_bulk",
        "ynab_match_transfer",
        "ynab_delete_transaction",
        "ynab_import_transactions",
        "ynab_reconcile_account",
        "ynab_move_money",
      ].sort(),
    );
  });

  it("round-trips ynab_list_budgets through the real HTTP + JSON-RPC pipeline", async () => {
    mswServer.use(
      http.get(`${BASE}/plans`, () =>
        HttpResponse.json({
          data: {
            plans: [
              {
                id: "b1",
                name: "My Budget",
                last_modified_on: "2026-01-01T00:00:00Z",
                first_month: "2026-01-01",
                last_month: "2026-06-01",
              },
            ],
          },
        }),
      ),
    );

    const client = await connectedClient();
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

  it("rejects a malformed budget_id argument via the JSON-Schema-derived input validation, without any HTTP call", async () => {
    let called = false;
    mswServer.events.on("request:start", () => {
      called = true;
    });

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_get_budget",
      arguments: { budget_id: "" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/Invalid arguments/);
    expect(called).toBe(false);
  });

  it("rejects ynab_list_transactions when since_date is after until_date, without calling the YNAB API", async () => {
    let called = false;
    mswServer.events.on("request:start", () => {
      called = true;
    });

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_list_transactions",
      arguments: { budget_id: "last-used", since_date: "2026-06-01", until_date: "2026-01-01" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/since_date .* must not be after until_date/);
    expect(called).toBe(false);
  });

  it("rejects ynab_delete_transaction when confirm is not explicitly true, without calling the YNAB API", async () => {
    let called = false;
    mswServer.events.on("request:start", () => {
      called = true;
    });

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_delete_transaction",
      arguments: { budget_id: "last-used", transaction_id: "t1", confirm: false },
    });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("ynab_get_budget returns a bounded overview, not the raw unbounded plan export", async () => {
    mswServer.use(
      http.get(`${BASE}/plans/last-used`, () =>
        HttpResponse.json({
          data: {
            plan: {
              id: "b1",
              name: "My Budget",
              accounts: [
                fakeAccount({ id: "a1", deleted: false }),
                fakeAccount({ id: "a2", deleted: true }),
              ],
              transactions: Array.from({ length: 5000 }, (_, i) =>
                fakeTransaction({ id: `t${i}` }),
              ),
            },
          },
        }),
      ),
    );

    const client = await connectedClient();
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

  it("surfaces a YNAB API error as an MCP tool error, not a protocol error", async () => {
    mswServer.use(
      http.get(`${BASE}/plans/last-used/accounts`, () =>
        ynabErrorResponse(401, "401", "not_authorized", "Unauthorized"),
      ),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_list_accounts",
      arguments: { budget_id: "last-used" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/YNAB_ACCESS_TOKEN/);
  });

  it("surfaces a rate-limit (429) error with retry guidance", async () => {
    mswServer.use(
      http.get(`${BASE}/plans/last-used/categories`, () =>
        ynabErrorResponse(429, "429", "too_many_requests", "slow down"),
      ),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_list_categories",
      arguments: { budget_id: "last-used" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/rate limit/);
    expect(textOf(result.content)).toMatch(/wait before retrying/);
  });

  it("ynab_get_spending_summary aggregates outflow/inflow per category", async () => {
    mswServer.use(
      http.get(`${BASE}/plans/last-used/transactions`, () =>
        HttpResponse.json({
          data: {
            server_knowledge: 0,
            transactions: [
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
          },
        }),
      ),
    );

    const client = await connectedClient();
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

  it("ynab_create_category sends category_group_id/name/note in the request body and echoes the created fields", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.post(`${BASE}/plans/last-used/categories`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: {
            category: {
              id: "c1",
              category_group_id: "cg1",
              name: "Groceries",
              hidden: false,
              internal: false,
              note: "weekly shop",
              budgeted: 0,
              activity: 0,
              balance: 0,
              deleted: false,
            },
          },
        });
      }),
    );

    const client = await connectedClient();
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
    expect(receivedBody).toEqual({
      category: { category_group_id: "cg1", name: "Groceries", note: "weekly shop" },
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

  it("ynab_create_category forwards goal fields and echoes the resulting goal", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.post(`${BASE}/plans/last-used/categories`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: {
            category: {
              id: "c1",
              category_group_id: "cg1",
              name: "Vacation",
              hidden: false,
              internal: false,
              budgeted: 0,
              activity: 0,
              balance: 0,
              deleted: false,
              goal_type: "TBD",
              goal_target: 500_000,
              goal_target_date: "2026-12-01",
              goal_needs_whole_amount: null,
            },
          },
        });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_create_category",
      arguments: {
        budget_id: "last-used",
        category_group_id: "cg1",
        name: "Vacation",
        goal_target: 500_000,
        goal_target_date: "2026-12-01",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedBody).toEqual({
      category: {
        category_group_id: "cg1",
        name: "Vacation",
        goal_target: 500_000,
        goal_target_date: "2026-12-01",
      },
    });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.goal_type).toBe("TBD");
    expect(parsed.goal_target).toBe(500_000);
    expect(parsed.goal_target_date).toBe("2026-12-01");
  });

  it("ynab_update_category PATCHes goal fields onto an existing category", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.patch(`${BASE}/plans/last-used/categories/:categoryId`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: {
            category: {
              id: "c1",
              category_group_id: "cg1",
              name: "Groceries",
              hidden: false,
              internal: false,
              budgeted: 0,
              activity: 0,
              balance: 0,
              deleted: false,
              goal_type: "NEED",
              goal_target: 30_000,
              goal_needs_whole_amount: true,
            },
          },
        });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_update_category",
      arguments: {
        budget_id: "last-used",
        category_id: "c1",
        goal_target: 30_000,
        goal_needs_whole_amount: true,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedBody).toEqual({
      category: { goal_target: 30_000, goal_needs_whole_amount: true },
    });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.goal_type).toBe("NEED");
    expect(parsed.goal_target).toBe(30_000);
    expect(parsed.goal_needs_whole_amount).toBe(true);
  });

  it("ynab_assign_budgeted_amount PATCHes the month/category endpoint with the milliunits amount", async () => {
    let receivedBody: unknown;
    let receivedPath: string | undefined;
    mswServer.use(
      http.patch(
        `${BASE}/plans/last-used/months/:month/categories/:categoryId`,
        async ({ request, params }) => {
          receivedPath = `${params.month}/${params.categoryId}`;
          receivedBody = await request.json();
          return HttpResponse.json({
            data: {
              category: {
                id: params.categoryId,
                category_group_id: "cg1",
                name: "Groceries",
                hidden: false,
                internal: false,
                budgeted: 50_000,
                activity: 0,
                balance: 50_000,
                deleted: false,
              },
            },
          });
        },
      ),
    );

    const client = await connectedClient();
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
    expect(receivedPath).toBe("2026-07-01/c1");
    expect(receivedBody).toEqual({ category: { budgeted: 50_000 } });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.budgeted).toBe(50_000);
  });

  it("ynab_create_transaction POSTs a single transaction and echoes the created transaction", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.post(`${BASE}/plans/last-used/transactions`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: {
            transaction_ids: ["t1"],
            server_knowledge: 0,
            transaction: fakeTransaction({
              id: "t1",
              account_id: "a1",
              date: "2026-07-01",
              amount: -25_000,
              category_id: "c1",
            }),
          },
        });
      }),
    );

    const client = await connectedClient();
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
    expect(receivedBody).toEqual({
      transaction: {
        account_id: "a1",
        date: "2026-07-01",
        amount: -25_000,
        category_id: "c1",
      },
    });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed).toMatchObject({ id: "t1", date: "2026-07-01", amount: -25_000 });
  });

  it("ynab_delete_transaction DELETEs the transaction and echoes the deleted transaction when confirm is true", async () => {
    let called = false;
    mswServer.use(
      http.delete(`${BASE}/plans/last-used/transactions/t1`, () => {
        called = true;
        return HttpResponse.json({
          data: { transaction: fakeTransaction({ id: "t1", deleted: true }) },
        });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_delete_transaction",
      arguments: { budget_id: "last-used", transaction_id: "t1", confirm: true },
    });
    expect(result.isError).toBeFalsy();
    expect(called).toBe(true);
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.id).toBe("t1");
  });

  it("ynab_create_account POSTs the type and starting balance and echoes the created account", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.post(`${BASE}/plans/last-used/accounts`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: {
            account: fakeAccount({
              id: "a1",
              name: "New Checking",
              type: "checking",
              balance: 100_000,
            }),
          },
        });
      }),
    );

    const client = await connectedClient();
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
    expect(receivedBody).toEqual({
      account: { name: "New Checking", type: "checking", balance: 100_000 },
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
    mswServer.use(
      http.post(`${BASE}/plans/last-used/payees`, () =>
        HttpResponse.json({ data: { payee: { id: "p1", name: "Corner Store", deleted: false } } }),
      ),
      http.patch(`${BASE}/plans/last-used/payees/p1`, () =>
        HttpResponse.json({
          data: { payee: { id: "p1", name: "Corner Store Renamed", deleted: false } },
        }),
      ),
    );

    const client = await connectedClient();
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

  it("ynab_list_transactions passes last_knowledge_of_server as a query param and returns the new server_knowledge cursor", async () => {
    let receivedQuery: string | null = null;
    mswServer.use(
      http.get(`${BASE}/plans/last-used/transactions`, ({ request }) => {
        receivedQuery = new URL(request.url).searchParams.get("last_knowledge_of_server");
        return HttpResponse.json({
          data: { transactions: [fakeTransaction({ id: "t1" })], server_knowledge: 42 },
        });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_list_transactions",
      arguments: { budget_id: "last-used", last_knowledge_of_server: 17 },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedQuery).toBe("17");
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.server_knowledge).toBe(42);
  });

  it("ynab_list_transactions passes type and account_id to YNAB's per-account endpoint", async () => {
    let receivedType: string | null = null;
    mswServer.use(
      http.get(`${BASE}/plans/last-used/accounts/a1/transactions`, ({ request }) => {
        receivedType = new URL(request.url).searchParams.get("type");
        return HttpResponse.json({
          data: {
            transactions: [fakeTransaction({ id: "t1", approved: false })],
            server_knowledge: 5,
          },
        });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_list_transactions",
      arguments: { budget_id: "last-used", type: "unapproved", account_id: "a1" },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedType).toBe("unapproved");
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].account_id).toBe("a1");
  });

  it("ynab_list_transactions by category_id returns split lines as hybrid rows", async () => {
    mswServer.use(
      http.get(`${BASE}/plans/last-used/categories/c1/transactions`, () =>
        HttpResponse.json({
          data: {
            transactions: [
              {
                ...fakeTransaction({ id: "s1", amount: -5000, category_id: "c1" }),
                type: "subtransaction",
                parent_transaction_id: "t1",
              },
            ],
          },
        }),
      ),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_list_transactions",
      arguments: { budget_id: "last-used", category_id: "c1" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.transactions[0]).toMatchObject({
      id: "s1",
      type: "subtransaction",
      parent_transaction_id: "t1",
    });
    expect(parsed.server_knowledge).toBeNull();
  });

  it("ynab_list_transactions rejects combining account_id and payee_id without an HTTP call", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_list_transactions",
      arguments: { budget_id: "last-used", account_id: "a1", payee_id: "p1" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/at most one/);
  });

  it("ynab_create_transaction with transfer_account_id sends the target account's transfer payee id", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.get(`${BASE}/plans/last-used/accounts/cc1`, () =>
        HttpResponse.json({
          data: { account: fakeAccount({ id: "cc1", transfer_payee_id: "transfer-cc1" }) },
        }),
      ),
      http.post(`${BASE}/plans/last-used/transactions`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: {
            transaction_ids: ["t1"],
            transaction: fakeTransaction({
              id: "t1",
              amount: -100_000,
              payee_id: "transfer-cc1",
              transfer_account_id: "cc1",
            }),
            server_knowledge: 1,
          },
        });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_create_transaction",
      arguments: {
        budget_id: "last-used",
        account_id: "a1",
        date: "2026-09-30",
        amount: -100_000,
        transfer_account_id: "cc1",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedBody).toEqual({
      transaction: {
        account_id: "a1",
        date: "2026-09-30",
        amount: -100_000,
        payee_id: "transfer-cc1",
      },
    });
    expect(JSON.parse(textOf(result.content)).transfer_account_id).toBe("cc1");
  });

  it("ynab_create_transaction sends subtransactions for a split", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.post(`${BASE}/plans/last-used/transactions`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: {
            transaction_ids: ["t1"],
            transaction: fakeTransaction({ id: "t1", amount: -50_000 }),
            server_knowledge: 1,
          },
        });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_create_transaction",
      arguments: {
        budget_id: "last-used",
        account_id: "a1",
        date: "2026-09-30",
        amount: -50_000,
        payee_name: "Supermarket",
        subtransactions: [
          { amount: -40_000, category_id: "groceries" },
          { amount: -10_000, category_id: "drugstore", memo: "Shampoo" },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedBody).toEqual({
      transaction: {
        account_id: "a1",
        date: "2026-09-30",
        amount: -50_000,
        payee_name: "Supermarket",
        subtransactions: [
          { amount: -40_000, category_id: "groceries" },
          { amount: -10_000, category_id: "drugstore", memo: "Shampoo" },
        ],
      },
    });
  });

  it("ynab_create_transaction rejects subtransactions that don't add up, without an HTTP call", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_create_transaction",
      arguments: {
        budget_id: "last-used",
        account_id: "a1",
        date: "2026-09-30",
        amount: -50_000,
        subtransactions: [{ amount: -40_000 }, { amount: -5_000 }],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/add up to -45000/);
  });

  it("ynab_update_transactions_bulk PATCHes all updates in one request", async () => {
    let receivedBody: unknown;
    let requestCount = 0;
    mswServer.use(
      http.patch(`${BASE}/plans/last-used/transactions`, async ({ request }) => {
        requestCount += 1;
        receivedBody = await request.json();
        return saveTransactionsResponse([
          fakeTransaction({ id: "t1", category_id: "c1", approved: true }),
          fakeTransaction({ id: "t2", approved: true }),
        ]);
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_update_transactions_bulk",
      arguments: {
        budget_id: "last-used",
        transactions: [
          { id: "t1", category_id: "c1", approved: true },
          { id: "t2", approved: true },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(requestCount).toBe(1);
    expect(receivedBody).toEqual({
      transactions: [
        { id: "t1", category_id: "c1", approved: true },
        { id: "t2", approved: true },
      ],
    });
    expect(JSON.parse(textOf(result.content))).toHaveLength(2);
  });

  it("ynab_match_transfer converts one side into a transfer and deletes the imported duplicate", async () => {
    const calls: string[] = [];
    let convertBody: unknown;
    let counterpartBody: unknown;
    mswServer.use(
      http.get(`${BASE}/plans/last-used/transactions/:id`, ({ params }) => {
        calls.push(`GET ${params.id}`);
        return HttpResponse.json({
          data: {
            transaction:
              params.id === "checking-side"
                ? fakeTransaction({ id: "checking-side", account_id: "a1", amount: -100_000 })
                : fakeTransaction({
                    id: "cc-side",
                    account_id: "cc1",
                    amount: 100_000,
                    cleared: "cleared",
                  }),
          },
        });
      }),
      http.get(`${BASE}/plans/last-used/accounts/cc1`, () =>
        HttpResponse.json({
          data: { account: fakeAccount({ id: "cc1", transfer_payee_id: "transfer-cc1" }) },
        }),
      ),
      http.put(`${BASE}/plans/last-used/transactions/:id`, async ({ params, request }) => {
        calls.push(`PUT ${params.id}`);
        if (params.id === "checking-side") {
          convertBody = await request.json();
          return HttpResponse.json({
            data: {
              transaction: fakeTransaction({
                id: "checking-side",
                amount: -100_000,
                transfer_account_id: "cc1",
                transfer_transaction_id: "new-cc-side",
              }),
            },
          });
        }
        counterpartBody = await request.json();
        return HttpResponse.json({
          data: { transaction: fakeTransaction({ id: "new-cc-side", account_id: "cc1" }) },
        });
      }),
      http.delete(`${BASE}/plans/last-used/transactions/cc-side`, () => {
        calls.push("DELETE cc-side");
        return HttpResponse.json({
          data: { transaction: fakeTransaction({ id: "cc-side", deleted: true }) },
        });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_match_transfer",
      arguments: {
        budget_id: "last-used",
        transaction_id: "checking-side",
        counterpart_transaction_id: "cc-side",
        confirm: true,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      "GET checking-side",
      "GET cc-side",
      "PUT checking-side",
      "DELETE cc-side",
      "PUT new-cc-side",
    ]);
    expect(convertBody).toEqual({ transaction: { payee_id: "transfer-cc1" } });
    expect(counterpartBody).toEqual({ transaction: { cleared: "cleared", approved: true } });
  });

  it("ynab_match_transfer refuses transactions whose amounts don't mirror each other", async () => {
    mswServer.use(
      http.get(`${BASE}/plans/last-used/transactions/:id`, ({ params }) =>
        HttpResponse.json({
          data: {
            transaction: fakeTransaction({
              id: String(params.id),
              account_id: params.id === "x" ? "a1" : "cc1",
              amount: -100_000,
            }),
          },
        }),
      ),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_match_transfer",
      arguments: {
        budget_id: "last-used",
        transaction_id: "x",
        counterpart_transaction_id: "y",
        confirm: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/opposite amounts/);
  });

  it("ynab_import_transactions POSTs to the import endpoint and returns the imported ids", async () => {
    mswServer.use(
      http.post(`${BASE}/plans/last-used/transactions/import`, () =>
        HttpResponse.json({ data: { transaction_ids: ["i1", "i2"] } }, { status: 201 }),
      ),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_import_transactions",
      arguments: { budget_id: "last-used" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result.content))).toEqual({
      imported_count: 2,
      transaction_ids: ["i1", "i2"],
    });
  });

  const reconcileHistory = [
    fakeTransaction({ id: "r1", date: "2026-08-01", amount: 500_000, cleared: "reconciled" }),
    fakeTransaction({ id: "c1", date: "2026-09-10", amount: -20_000, cleared: "cleared" }),
    fakeTransaction({ id: "u1", date: "2026-09-15", amount: -5_000, cleared: "uncleared" }),
    fakeTransaction({ id: "c2", date: "2026-10-02", amount: -1_000, cleared: "cleared" }),
  ];

  it("ynab_reconcile_account with dry_run only reports the difference", async () => {
    mswServer.use(
      http.get(`${BASE}/plans/last-used/accounts/a1/transactions`, () =>
        HttpResponse.json({ data: { transactions: reconcileHistory, server_knowledge: 1 } }),
      ),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_reconcile_account",
      arguments: {
        budget_id: "last-used",
        account_id: "a1",
        statement_balance: 470_000,
        statement_date: "2026-09-30",
        dry_run: true,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result.content))).toEqual({
      dry_run: true,
      account_id: "a1",
      statement_date: "2026-09-30",
      statement_balance: 470_000,
      cleared_balance: 480_000,
      difference: -10_000,
      transactions_to_reconcile: 1,
      uncleared_transactions_up_to_date: 1,
    });
  });

  it("ynab_reconcile_account books an adjustment and marks cleared transactions reconciled", async () => {
    let adjustmentBody: unknown;
    let patchBody: unknown;
    mswServer.use(
      http.get(`${BASE}/plans/last-used/accounts/a1/transactions`, () =>
        HttpResponse.json({ data: { transactions: reconcileHistory, server_knowledge: 1 } }),
      ),
      http.post(`${BASE}/plans/last-used/transactions`, async ({ request }) => {
        adjustmentBody = await request.json();
        return HttpResponse.json({
          data: {
            transaction_ids: ["adj"],
            transaction: fakeTransaction({ id: "adj", amount: -10_000, cleared: "reconciled" }),
            server_knowledge: 2,
          },
        });
      }),
      http.patch(`${BASE}/plans/last-used/transactions`, async ({ request }) => {
        patchBody = await request.json();
        return saveTransactionsResponse([fakeTransaction({ id: "c1", cleared: "reconciled" })]);
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_reconcile_account",
      arguments: {
        budget_id: "last-used",
        account_id: "a1",
        statement_balance: 470_000,
        statement_date: "2026-09-30",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(adjustmentBody).toEqual({
      transaction: {
        account_id: "a1",
        date: "2026-09-30",
        amount: -10_000,
        payee_name: "Reconciliation Balance Adjustment",
        memo: "Entered automatically by ynab-mcp reconciliation",
        cleared: "reconciled",
        approved: true,
      },
    });
    expect(patchBody).toEqual({ transactions: [{ id: "c1", cleared: "reconciled" }] });
    const parsed = JSON.parse(textOf(result.content));
    expect(parsed.reconciled_count).toBe(1);
    expect(parsed.adjustment.id).toBe("adj");
  });

  it("ynab_update_category sends goal_target: null to remove a goal", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.patch(`${BASE}/plans/last-used/categories/c1`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ data: { category: fakeCategory() } });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_update_category",
      arguments: { budget_id: "last-used", category_id: "c1", goal_target: null },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedBody).toEqual({ category: { goal_target: null } });
  });

  it("ynab_update_category forwards goal_frequency, which the SDK's serializer would otherwise drop", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.patch(`${BASE}/plans/last-used/categories/c1`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ data: { category: fakeCategory() } });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_update_category",
      arguments: {
        budget_id: "last-used",
        category_id: "c1",
        goal_target: 120_000,
        goal_frequency: "yearly",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedBody).toEqual({
      category: { goal_target: 120_000, goal_frequency: "yearly" },
    });
  });

  it("ynab_update_category rejects goal_frequency without goal_target, without an HTTP call", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_update_category",
      arguments: { budget_id: "last-used", category_id: "c1", goal_frequency: "weekly" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/requires goal_target/);
  });

  it("ynab_assign_budgeted_amount in add mode adds to the current month's budgeted amount", async () => {
    let receivedBody: unknown;
    mswServer.use(
      http.get(`${BASE}/plans/last-used/months/2026-10-01/categories/c1`, () =>
        HttpResponse.json({ data: { category: fakeCategory({ budgeted: 30_000 }) } }),
      ),
      http.patch(`${BASE}/plans/last-used/months/2026-10-01/categories/c1`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ data: { category: fakeCategory({ budgeted: 45_000 }) } });
      }),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_assign_budgeted_amount",
      arguments: {
        budget_id: "last-used",
        month: "2026-10-01",
        category_id: "c1",
        budgeted: 15_000,
        mode: "add",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(receivedBody).toEqual({ category: { budgeted: 45_000 } });
  });

  it("ynab_move_money decreases the source and increases the target category", async () => {
    const budgeted: Record<string, number> = { from: 50_000, to: 0 };
    const writes: Record<string, unknown> = {};
    mswServer.use(
      http.get(`${BASE}/plans/last-used/months/current/categories/:id`, ({ params }) =>
        HttpResponse.json({
          data: {
            category: fakeCategory({
              id: String(params.id),
              budgeted: budgeted[String(params.id)] ?? 0,
            }),
          },
        }),
      ),
      http.patch(
        `${BASE}/plans/last-used/months/current/categories/:id`,
        async ({ params, request }) => {
          writes[String(params.id)] = await request.json();
          return HttpResponse.json({ data: { category: fakeCategory({ id: String(params.id) }) } });
        },
      ),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_move_money",
      arguments: {
        budget_id: "last-used",
        month: "current",
        amount: 20_000,
        from_category_id: "from",
        to_category_id: "to",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(writes).toEqual({
      from: { category: { budgeted: 30_000 } },
      to: { category: { budgeted: 20_000 } },
    });
  });

  it("ynab_move_money reports a partial move when the second write fails", async () => {
    mswServer.use(
      http.get(`${BASE}/plans/last-used/months/current/categories/:id`, ({ params }) =>
        HttpResponse.json({
          data: {
            category: fakeCategory({ id: String(params.id), name: "Fun", budgeted: 50_000 }),
          },
        }),
      ),
      http.patch(`${BASE}/plans/last-used/months/current/categories/from`, () =>
        HttpResponse.json({ data: { category: fakeCategory({ id: "from", name: "Fun" }) } }),
      ),
      http.patch(`${BASE}/plans/last-used/months/current/categories/to`, () =>
        ynabErrorResponse(404, "404", "not_found", "Category not found"),
      ),
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "ynab_move_money",
      arguments: {
        budget_id: "last-used",
        month: "current",
        amount: 20_000,
        from_category_id: "from",
        to_category_id: "to",
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/already taken out of "Fun".*Ready to Assign/);
  });
});
