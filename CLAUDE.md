# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project State

An MCP server for YNAB (You Need A Budget). Implements the full read-only budget analysis surface (section A of the plan: `ynab_get_user`, `ynab_list_budgets`, `ynab_get_budget`, `ynab_get_budget_settings`, `ynab_list_accounts`, `ynab_get_account`, `ynab_list_categories`, `ynab_get_category`, `ynab_list_months`, `ynab_get_month`, `ynab_list_payees`, `ynab_get_payee`, `ynab_list_scheduled_transactions`, `ynab_list_transactions`, `ynab_get_spending_summary`) plus category management writes (section B: `ynab_create_category_group`, `ynab_update_category_group`, `ynab_create_category`, `ynab_update_category`, `ynab_assign_budgeted_amount`). There is no `ynab_delete_category` — YNAB's public API has no delete endpoint for categories and no `hidden` field on the create/update request bodies, so a category can't be deleted or hidden through the API at all; this was verified directly against the `ynab` SDK's `CategoriesApi`/`NewCategory`/`ExistingCategory` types rather than assumed. Transaction management and account/budget setup tools (sections C and D) are planned but not built. See [docs/plans/ynab-mcp-server-plan.md](docs/plans/ynab-mcp-server-plan.md) for the full design and phased roadmap, and [README.md](README.md) for setup instructions.

## Package Manager

Use **pnpm** (pinned to `pnpm@10.33.0` via the `packageManager` field). Do not use npm or yarn to install dependencies.

## Commands

- `pnpm build` — bundle to `dist/index.js` via tsup
- `pnpm dev` — watch mode, restarts the server on change
- `pnpm typecheck` — `tsc --noEmit` (TypeScript 7)
- `pnpm lint` — oxlint over `src` and `test`
- `pnpm format` — oxfmt over `src` and `test`
- `pnpm test` — unit + integration tests via vitest (excludes `test/live`)
- `pnpm test -- path/to/file.test.ts` — run a single test file
- `pnpm test:live` — reserved for opt-in tests against a real YNAB account; not yet implemented (no `test/live` directory exists yet)

## Architecture

- **Transport**: local stdio only, launched as a child process by an MCP host (e.g. Claude Desktop). Entry point is `src/index.ts`.
- **`src/server.ts`**: `createServer(config, ynabClientFactory?)` builds the `McpServer` and registers all tools — injectable factory for tests.
- **`src/ynab/client.ts`**: the `YnabClient` interface and its adapter over the `ynab` npm package. This is the only file that touches the underlying SDK's `planId`-based API surface directly — every tool-facing name stays `budget_id`/"budget" (see the plan's "API reference" section for why the SDK uses `planId` internally).
- **`src/ynab/errors.ts`**: `mapYnabError` validates YNAB's thrown error shape via a zod schema and maps it to a user-facing `YnabToolError`.
- **`src/ynab/types.ts` / `format.ts`**: `Milliunits` is a zod-branded type (`z.number().int().brand<"Milliunits">()`) so a raw currency amount can't be passed where the YNAB API expects milliunits (1000 = 1.00) without going through `toMilliunits`/`fromMilliunits`.
- **`src/tools/*.ts`**: one module per resource area, each exporting `registerXTools(server, ynab)`. `src/tools/helpers.ts` holds the shared `READ_ONLY` annotations, `jsonToolResult`, and `withYnabErrorHandling` used by every tool handler.
- **`src/schemas/common.ts`**: shared zod input fragments (`budgetIdSchema`, `milliunitsSchema`, `isoDateSchema`, `confirmSchema`) used across tool input schemas.

No `as` type assertions anywhere in this codebase — prefer zod parsing/branding, explicit type annotations with contextual typing, or `in`-operator narrowing instead.
