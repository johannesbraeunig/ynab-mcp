# ynab-mcp

An MCP (Model Context Protocol) server for [YNAB](https://www.ynab.com/) (You Need A Budget), so an LLM client such as Claude Desktop can analyze your budget, accounts, categories, and transactions.

**Status: early work in progress.** Read-only budget analysis, category management, and transaction management tools are implemented so far. Account/budget setup tools are planned but not yet built — see [docs/plans/ynab-mcp-server-plan.md](docs/plans/ynab-mcp-server-plan.md) for the full design and roadmap.

## What it can do today

| Tool | Description |
| --- | --- |
| `ynab_get_user` | Get the id of the authenticated user for the configured access token. |
| `ynab_list_budgets` | List all budgets accessible to the configured access token. |
| `ynab_get_budget` | Get an overview of one budget: metadata plus counts of accounts/categories/payees/transactions. Use the dedicated list tools below for the actual data. |
| `ynab_get_budget_settings` | Get the date format and currency format settings for a budget. |
| `ynab_list_accounts` | List accounts in a budget, with balances in milliunits. |
| `ynab_get_account` | Get a single account by id. |
| `ynab_list_categories` | List category groups and categories, with budgeted/activity/balance figures for the current month. |
| `ynab_get_category` | Get a single category by id, including goal figures. |
| `ynab_list_months` | List summary figures (income/budgeted/activity/to_be_budgeted) for every month in a budget's history. |
| `ynab_get_month` | Get summary figures plus every category's budgeted/activity/balance for one budget month. |
| `ynab_list_payees` | List all payees in a budget. |
| `ynab_get_payee` | Get a single payee by id. |
| `ynab_list_scheduled_transactions` | List upcoming scheduled (future-dated, recurring) transactions. |
| `ynab_list_transactions` | List transactions in a budget, filterable by date range. Defaults to the last 30 days and returns at most 200 per call. |
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

The tools above are the only ones implemented — nothing in this server can create, modify, or delete accounts or payees yet. There is intentionally no `ynab_delete_category`: YNAB's public API has no delete endpoint for categories and no way to hide one via the API either, so that action isn't possible through this server (or any other API client).

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
- `ynab_delete_transaction` is the one destructive tool implemented so far: it's annotated `destructiveHint: true`, requires an explicit `confirm: true` field in the tool call (calls without it are rejected before any request reaches YNAB), and returns the deleted transaction's fields in the result so the call is auditable afterwards. See the [security notes in the design plan](docs/plans/ynab-mcp-server-plan.md#security-notes) for the full intended safeguards, including that host-level tool-call approval (e.g. in Claude Desktop) remains the primary line of defense — the `confirm` field is defense-in-depth, not a substitute for it.
- Your access token is read once from the `YNAB_ACCESS_TOKEN` environment variable at startup and is never logged or written to disk by this server.

## Development

```sh
pnpm dev         # watch mode, restarts the server on change
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm format      # oxfmt
pnpm test        # unit + integration tests (vitest)
```

`pnpm test:live` is reserved for opt-in tests against a real YNAB account (gated behind env vars, excluded from `pnpm test`) as described in the design plan, but that test suite hasn't been written yet — running it today will just report "no test files found."

See [CLAUDE.md](CLAUDE.md) for architecture notes and [docs/plans/ynab-mcp-server-plan.md](docs/plans/ynab-mcp-server-plan.md) for the full design plan, including the phased roadmap for write tools.

## License

[MIT](LICENSE)
