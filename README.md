# ynab-mcp

An MCP (Model Context Protocol) server for [YNAB](https://www.ynab.com/) (You Need A Budget), so an LLM client such as Claude Desktop can analyze your budget, accounts, categories, and transactions.

**Status: early work in progress.** All planned tool areas are implemented: read-only budget analysis, category management, transaction management, and account/budget setup. The one thing not yet done is a manual end-to-end pass through Claude Desktop against a real budget (everything else is covered by the automated test suite).

## What it can do today

| Tool | Description |
| --- | --- |
| `ynab_get_user` | Get the id of the authenticated user for the configured access token. |
| `ynab_list_budgets` | List all budgets accessible to the configured access token. |
| `ynab_get_budget` | Get an overview of one budget: metadata plus counts of accounts/categories/payees/transactions. Use the dedicated list tools below for the actual data. |
| `ynab_get_budget_settings` | Get the date format and currency format settings for a budget. |
| `ynab_list_accounts` | List accounts in a budget, with balances in milliunits. Supports `last_knowledge_of_server` for delta sync. |
| `ynab_get_account` | Get a single account by id. |
| `ynab_list_categories` | List category groups and categories, with budgeted/activity/balance figures for the current month. Supports `last_knowledge_of_server` for delta sync. |
| `ynab_get_category` | Get a single category by id, including goal figures. |
| `ynab_list_months` | List summary figures (income/budgeted/activity/to_be_budgeted) for every month in a budget's history. Supports `last_knowledge_of_server` for delta sync. |
| `ynab_get_month` | Get summary figures plus every category's budgeted/activity/balance for one budget month. |
| `ynab_list_payees` | List all payees in a budget. Supports `last_knowledge_of_server` for delta sync. |
| `ynab_get_payee` | Get a single payee by id. |
| `ynab_list_scheduled_transactions` | List upcoming scheduled (future-dated, recurring) transactions. Supports `last_knowledge_of_server` for delta sync. |
| `ynab_list_transactions` | List transactions in a budget, filterable by date range. Defaults to the last 30 days and returns at most 200 per call. Supports `last_knowledge_of_server` for delta sync. |
| `ynab_get_spending_summary` | Summarize spending (outflow) and income (inflow) per category over a date range, computed client-side from transactions. |
| `ynab_create_category_group` | Create a new category group. |
| `ynab_update_category_group` | Rename an existing category group. |
| `ynab_create_category` | Create a new category within an existing category group. |
| `ynab_update_category` | Update a category's name, note, and/or category group. |
| `ynab_assign_budgeted_amount` | Set the budgeted (assigned) amount for a category in a specific month — the "assign money" action. |
| `ynab_create_transaction` | Create a single transaction. |
| `ynab_create_transactions_bulk` | Create multiple transactions in one call. |
| `ynab_update_transaction` | Update a transaction's account, date, amount, payee, category, memo, cleared status, and/or approved status — also covers approving and categorizing a transaction. |
| `ynab_delete_transaction` | **Destructive.** Permanently delete a transaction. Requires `confirm: true`. |
| `ynab_create_account` | Create a new on-budget account. |
| `ynab_create_payee` | Create a new payee. |
| `ynab_update_payee` | Rename an existing payee. |

There is intentionally no `ynab_delete_category` and no `ynab_close_account`/`ynab_update_account`: YNAB's public API has no delete endpoint for categories, no `hidden` field to hide one either, and no update or close endpoint for accounts at all — `AccountsApi` in the underlying SDK only exposes create/get/list. Once you create an account or category with this server, there's no way to close, hide, or delete it through the API (or any other API client) — you'd need to do that from the YNAB app itself.

**Delta sync**: the list tools marked above accept an optional `last_knowledge_of_server` input and always return a `server_knowledge` value in their result. Save that value and pass it back in on your next call to that tool to receive only the entities that changed since then, instead of re-fetching the whole collection — useful if you're polling the same budget repeatedly and want to stay well under YNAB's 200-requests/hour rate limit.

**Error messages**: every tool error includes a short note on whether retrying makes sense — rate-limit (429) and network errors say to back off and retry later, everything else (bad ids, auth failures, validation errors) says retrying the same call won't help and what to check instead.

## Setup

### Prerequisites

- Node.js >= 20
- [pnpm](https://pnpm.io/) (this repo pins `pnpm@10.33.0` via the `packageManager` field)
- A YNAB **Personal Access Token** (YNAB web app → Account Settings → Developer Settings → New Token)

### Install and build

```sh
pnpm install
pnpm build
```

This produces `dist/index.js`, an executable Node script (it also has a `bin` entry, so once published you'll be able to run it via `npx ynab-mcp`).

### Configure Claude Desktop

Add the server to your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ynab": {
      "command": "node",
      "args": ["/absolute/path/to/ynab-mcp/dist/index.js"],
      "env": {
        "YNAB_ACCESS_TOKEN": "<your personal access token>"
      }
    }
  }
}
```

Restart Claude Desktop and the `ynab_*` tools should be available.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `YNAB_ACCESS_TOKEN` | Yes | Your YNAB Personal Access Token. Grants full read/write access to your entire YNAB account — YNAB does not support scoped tokens, so treat this the same as a password. |
| `YNAB_API_BASE_URL` | No | Overrides the YNAB API base URL (defaults to `https://api.ynab.com/v1`). Must be `https://`. Only useful for testing. |

## Safety

- Category and transaction management tools create and modify data in your live budget. Create/update tools are annotated `readOnlyHint: false`, `destructiveHint: false` (data isn't lost, just changed).
- `ynab_delete_transaction` is the one destructive tool implemented so far: it's annotated `destructiveHint: true`, requires an explicit `confirm: true` field in the tool call (calls without it are rejected before any request reaches YNAB), and returns the deleted transaction's fields in the result so the call is auditable afterwards. Host-level tool-call approval (e.g. in Claude Desktop) remains the primary line of defense against a bad or malicious tool call — the `confirm` field is defense-in-depth, not a substitute for it.
- YNAB personal access tokens are not scoped — there's no way to grant this server read-only or budget-limited access. It gets full read/write access to your entire YNAB account, same as the YNAB app itself.
- Your access token is read once from the `YNAB_ACCESS_TOKEN` environment variable at startup and is never logged or written to disk by this server.

## Development

```sh
pnpm dev         # watch mode, restarts the server on change
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm format      # oxfmt
pnpm test        # unit + integration tests (vitest)
```

The integration tests (`test/integration/server.test.ts`) run the real MCP server against the real `ynab` SDK, with [MSW](https://mswjs.io/) mocking the underlying HTTP calls to `api.ynab.com` — no live network access or real YNAB account needed to run `pnpm test`.

`pnpm test:live` is reserved for opt-in tests against a real YNAB account (gated behind env vars, excluded from `pnpm test`), but that test suite hasn't been written yet — running it today will just report "no test files found."

See [CLAUDE.md](CLAUDE.md) for architecture notes.

## License

[MIT](LICENSE)
