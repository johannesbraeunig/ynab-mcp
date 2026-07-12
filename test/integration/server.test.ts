import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import type { Account, TransactionDetail } from "ynab";

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
        "ynab_delete_transaction",
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
});
