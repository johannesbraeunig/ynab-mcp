# YNAB MCP Server — Implementation Plan

## Context

`ynab-mcp` is currently an empty repo (stub `package.json` + `CLAUDE.md` only). The goal is to build an MCP server that wraps the YNAB REST API so an LLM (via Claude Desktop, initially) can analyze budgets, manage categories, manage transactions, and handle account/budget setup. The YNAB access token is supplied by the user via an environment variable — no config file, no OAuth flow. The server should be built cleanly enough that it can be published to npm later (via `npx`), but publishing itself is not in scope for this pass.

Decisions already confirmed with the user:
- **Scope**: all four areas — read-only budget analysis, category management, transaction management, account/budget setup.
- **Transport**: local stdio only (Claude Desktop spawns it as a child process).
- **Auth**: `YNAB_ACCESS_TOKEN` env var.
- **Stack**: TypeScript + the official `@modelcontextprotocol/sdk`, pnpm (already pinned in `package.json`).

## API reference

Official docs: **https://api.ynab.com/** (landing/overview) and **https://api.ynab.com/v1** (interactive endpoint reference — JS-rendered, browse directly rather than scraping). Confirmed directly from the docs:

- Base URL: `https://api.ynab.com/v1`.
- Auth: HTTP Bearer (personal access token, or OAuth2 Implicit/Authorization Code Grant) via the `Authorization` header.
- Rate limit: **200 requests/hour** per token, rolling window; over the limit returns `429 Too Many Requests`.
- Resources: plans/budgets, accounts, categories (+ groups), transactions, scheduled transactions, payees, months, "money movements". Mostly `GET`, with `POST`/`PATCH`/`DELETE` on select resources only.
- Delta requests supported (`last_knowledge_of_server` / `server_knowledge`) for efficient incremental sync.
- Amounts in **milliunits**; newer responses may also include `_formatted`/`_currency` convenience fields worth checking during the spike.
- CORS enabled; consistent JSON envelope; errors as `{ error: { id, name, detail } }`.

**Confirmed naming change** (this matters for the SDK adapter below): YNAB's docs state that **as of v1.79.0 the API uses `/plans/{plan_id}` as the primary path**, with the legacy `/budgets/{budget_id}` paths kept only for backward compatibility. This lines up with what's already in the published `ynab` npm package (v4.5.0), which exposes `PlansApi`/`planId` as the generated top-level resource. The product itself is still called "Budget" in YNAB's own UI, in virtually all tutorials, and in most training data — so this is a real, current mismatch worth insulating against deliberately rather than assuming either naming.

**Design decision**: **all tool-facing names stay `budget_id`/"budget"** throughout the MCP server (matches user-facing product vocabulary and the user's own requirements), but every direct call to the `ynab` SDK is isolated behind one adapter file (`src/ynab/client.ts`). Internally it can call the `/plans` surface (the current primary path) while translating the shape back to "budget" vocabulary for every consumer.

**First implementation step, before writing any tool code**: a short spike — install `ynab`, call `getUser()` and list-plans against a real personal access token, confirm the exact payload shape (including whether `_formatted`/`_currency` fields are present), and implement the adapter accordingly.

## Project structure

```
ynab-mcp/
├── package.json                 # bin entry added now for later npx publish
├── tsconfig.json                 # NodeNext, strict, ES2022
├── tsup.config.ts                # bundles to dist/index.js with shebang banner
├── vitest.config.ts
├── oxlint config (.oxlintrc.json) / oxfmt config
├── .env.example
├── src/
│   ├── index.ts                  # bin entry: loadConfig -> createServer -> connect(StdioServerTransport)
│   ├── server.ts                 # createServer(config): builds McpServer, wires YnabClient, registerAllTools
│   ├── config.ts                 # zod-validated env loading (YNAB_ACCESS_TOKEN, optional YNAB_API_BASE_URL)
│   ├── ynab/
│   │   ├── client.ts             # YnabClient interface + adapter over the `ynab` SDK (budgets/plans seam)
│   │   ├── errors.ts             # mapYnabError(): SDK/HTTP errors -> MCP-friendly tool errors, never logs the token
│   │   ├── format.ts             # milliunits <-> currency helpers, date helpers
│   │   └── types.ts              # branded Milliunits type + z.infer'd domain types
│   ├── tools/
│   │   ├── index.ts              # registerAllTools(server, ynab)
│   │   ├── budgets.ts / accounts.ts / categories.ts / transactions.ts / payees.ts
│   └── schemas/
│       ├── common.ts             # budgetIdSchema, milliunitsSchema, isoDateSchema, confirmSchema
│       └── budgets.ts / accounts.ts / categories.ts / transactions.ts / payees.ts
└── test/
    ├── unit/                     # format, errors, tool handlers against a hand-written mock YnabClient
    ├── integration/              # McpServer + SDK InMemoryTransport, drives tools/list + tools/call
    └── live/                     # opt-in, skipped unless YNAB_LIVE_TEST_TOKEN/BUDGET_ID set; not run by default
```

`src/ynab/client.ts` is the highest-risk file (absorbs the budgets/plans naming risk). `src/schemas/common.ts` is the shared foundation every tool schema depends on.

## Tooling

- **TypeScript**: **TypeScript 7** (the native Go port, GA as of July 2026) as the compiler used for `typecheck`. `NodeNext` module/resolution, `ES2022` target, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, explicit `types: ["node"]` (needs `@types/node`; TS7 defaults `types` to `[]`). No explicit `rootDir` — `tsc --noEmit` typechecks both `src/` and `test/` together via `include`, and pinning `rootDir` to `./src` conflicts with `test/` living alongside it (`tsup` still only bundles from `src/index.ts`, so this doesn't affect the build output). Avoid the flags TS7 hard-errors on (no `target: es5`, no `moduleResolution: node` — `NodeNext` is unaffected, no `baseUrl`, no `module: amd/umd/systemjs`) — none of these are needed here anyway. TS7 has no stable programmatic API until 7.1, which doesn't matter here since the plan only uses the `tsc` CLI (`typecheck` script) and `tsup`'s bundler is esbuild-based, not TS-compiler-based.
- **Build**: `tsup` → single ESM bundle at `dist/index.js` with a `#!/usr/bin/env node` banner. `package.json` gets `"bin": { "ynab-mcp": "./dist/index.js" }` from day one so `node dist/index.js` today behaves identically to `npx ynab-mcp` later.
- **Lint/format**: **oxc** — `oxlint` for linting (ESLint-compatible rule set, 800+ rules, drop-in replacement) and `oxfmt` for formatting. Oxlint is production-ready; `oxfmt` is still in beta, so if it produces edge-case formatting issues on this codebase, fall back to Prettier for formatting only (keep oxlint regardless — linting is the production-ready half). Both are scoped to `src test` explicitly in the npm scripts (`oxlint src test` / `oxfmt src test`), not run over the whole repo — otherwise they also reformat `docs/`, `CLAUDE.md`, and `.claude/` config, which aren't code. No ESLint/Prettier config needed unless the oxfmt fallback is triggered.
- **Tests**: Vitest (pairs naturally with the esbuild-based tsup toolchain).
- **Scripts**: `build`, `dev` (tsup --watch), `start`, `typecheck` (tsc CLI via TS7), `lint` (oxlint), `format` (oxfmt), `test` (excludes `test/live`), `test:live`.
- **Deps**: `@modelcontextprotocol/sdk`, `ynab`, `zod`; dev deps: `typescript` (v7), `tsup`, `vitest`, `oxlint`, `oxfmt`. Pin `zod` to whatever major version `@modelcontextprotocol/sdk`'s `peerDependencies` requires — check this during the Phase 0 spike, since a mismatched zod major is a common source of `registerTool` input-schema type errors that only show up as confusing generic-inference failures, not clear error messages.
- **Correctness on numeric types**: `Milliunits` is a branded type (`type Milliunits = number & { readonly __brand: "Milliunits" }`) in `src/ynab/types.ts`, not just a bare `number` — this makes it a compile error to pass a raw dollar amount (e.g. `12.34`) where milliunits (`12340`) are expected, which is exactly the kind of bug that's easy to make and expensive to make silently against a real budget. `format.ts`'s `toMilliunits`/`fromMilliunits` are the only sanctioned way to produce/consume the branded type.
- **Nullability**: YNAB's API uses explicit `null` on many fields (e.g. `category_id`, `payee_id`, `memo`, `flag_color` can all be `null`, not just absent) — every zod schema mirroring a YNAB response field must use `.nullable()` (or `.nullish()` where YNAB genuinely omits the key too), matched field-by-field against real API responses captured in the Phase 0 spike, not assumed from memory. Conflating "optional" with "nullable" here is a recurring source of runtime `undefined`-vs-`null` bugs against real API responses.

## MCP server architecture

- `src/index.ts` is a thin entry: `loadConfig()` (fails fast on stderr, never stdout, if `YNAB_ACCESS_TOKEN` is missing) → `createServer(config)` → `server.connect(new StdioServerTransport())`.
- `createServer(config, ynabClientFactory = createYnabClient)` is a pure function returning an `McpServer`, injectable for tests (no global singletons) — this is also the seam that would let a future HTTP/Streamable transport reuse the same tool registrations without rework.
- `YnabClient` (in `src/ynab/client.ts`) is a narrow interface (`listBudgets`, `getBudget`, `listAccounts`, `createTransaction`, `deleteTransaction`, etc.) that normalizes whatever the underlying SDK calls its resources back into "budget" vocabulary. Every tool module depends only on this interface, never on raw `ynab` SDK types.
- One module per resource area under `src/tools/` (`budgets.ts`, `accounts.ts`, `categories.ts`, `transactions.ts`, `payees.ts`), each exporting `registerXTools(server, ynab)`. Tools use the modern `server.registerTool(name, { title, description, inputSchema, annotations }, handler)` API. Naming convention: `ynab_<verb>_<resource>` (e.g. `ynab_list_transactions`, `ynab_delete_transaction`) — the `ynab_` prefix avoids collisions with other MCP servers.
- **Errors**: `src/ynab/errors.ts` maps YNAB's `{ error: { id, name, detail } }` shape (401/403/404/429/network) into `YnabToolError`, and every handler catches and returns `{ isError: true, content: [...] }` — MCP tool errors surface *in* the result, not as protocol-level JSON-RPC errors, so the calling model can see and react.
- **Validation**: zod schemas per tool, built from shared fragments in `src/schemas/common.ts`:
  - `budgetIdSchema` — documents that `"last-used"` is a valid convenience value.
  - `milliunitsSchema` — documents that amounts are in milliunits (1000 = 1.00), explicitly in every money-related tool description.
  - `isoDateSchema`, `confirmSchema` (`z.literal(true)`, used only on destructive tools).

## v1 tool inventory (by scope area)

**A. Read-only budget analysis** — `list_budgets`, `get_budget`, `get_budget_settings`, `list_accounts`, `get_account`, `list_categories`, `get_category`, `list_months`, `get_month`, `list_transactions` (filterable by date/account/category/payee/unapproved/uncategorized — see pagination note below), `get_transaction`, `get_spending_summary` (composed client-side from transactions/months, not a single YNAB endpoint), `list_payees`, `get_payee`, `list_scheduled_transactions`, `get_user`.

**B. Category management** — `create_category`, `create_category_group`, `update_category`, `update_category_group`, `assign_budgeted_amount` (sets `budgeted` milliunits for a category/month — the "assign money" action), `delete_category` (verify during the spike whether YNAB's API supports true delete vs. only `hidden: true`; document accordingly rather than shipping a tool that can't do what its name promises).

**C. Transaction management** — `create_transaction`, `create_transactions_bulk`, `update_transaction` (single general-purpose update tool covering category/payee/approved/cleared/memo/amount/date changes), `delete_transaction` (destructive — reference implementation for the safety pattern below).

**D. Account & budget setup** — `create_account`, `create_payee`/`update_payee`, `close_account` (**provisional** — YNAB's public API has historically been read-heavy on account lifecycle; confirm during the spike and drop/rename if unsupported rather than shipping a tool that always errors).

Design notes baked into the tools:
- **Kept the tool count deliberately lean.** `categorize_transaction` and `approve_transaction` were cut as separate tools — they're just `update_transaction` with one field set, and every extra tool in the list dilutes the model's tool-selection accuracy for no real gain. Only add a narrow single-purpose tool later if usage shows the model consistently mishandles the general update tool for that case.
- **`list_transactions` pagination/bounding**: a real budget can have many thousands of transactions — returning all of them in one tool result would blow past useful LLM context. Default to a bounded window (e.g. `since_date` defaults to 90 days back if the caller doesn't specify one) and cap the returned count (e.g. 200 per call) with a `has_more`/cursor-style continuation value in the response, rather than an unbounded dump. Applies to any other list tool over a potentially-large collection (e.g. `list_scheduled_transactions` less so, but `list_transactions` is the main risk).
- Rate limit is ~200 requests/hour per token — prefer list endpoints over N+1 single-item calls where the model is doing analysis over many records.
- Support `last_knowledge_of_server` / `server_knowledge` on list tools for incremental sync (cheap to add now, avoids burning rate limit on repeated polling later).

## Destructive-action safety

MCP `ToolAnnotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: true`) are set correctly per tool category (read tools all `readOnlyHint: true`; creates `idempotentHint: false`; updates `idempotentHint: true`; deletes `destructiveHint: true`) — but annotations are hints only, not enforced by the protocol, so safety is also enforced in handler logic:

1. Every destructive tool (`delete_transaction`, `delete_category`, `close_account`) requires an explicit `confirm: z.literal(true)` input field with a description explaining the action is irreversible via the API. Handler validates this before making any network call.
2. Update/delete tools return the affected object's fields in the result (not just `{ok: true}`), so the tool call is auditable after the fact.
3. No bulk-delete tool in v1 — only single-id delete, to bound blast radius. Bulk *create* is fine.
4. No separate `dry_run` flag for v1 (relying on confirm-field + the fact that read tools already let a user/model preview before deleting); flagged as a possible v2 addition if real usage shows it's needed.
5. **The `confirm` field is defense-in-depth, not the only safeguard.** Claude Desktop (and well-behaved MCP hosts generally) already prompt the user to approve each tool call before it executes — that host-level approval is the primary line of defense against a model calling a destructive tool on bad reasoning (including prompt-injection scenarios, e.g. malicious text pulled in from a transaction memo or another connected tool instructing "delete all transactions"). The `confirm` field exists so the *call itself* is unambiguous and auditable, not as a substitute for host-level review — tool descriptions must not be worded in a way that encourages a model to set `confirm: true` reflexively.

## Security notes

- **Token handling**: `YNAB_ACCESS_TOKEN` must never appear in logs, error messages, or tool results. `src/logging.ts` and `mapYnabError` must not log full request/response objects (which would include the `Authorization` header) — log status codes and YNAB's `error.id`/`error.name`/`error.detail` only, never raw headers.
- **No granular token scopes**: YNAB personal access tokens grant full read/write access to the entire account (all budgets) — YNAB doesn't support scoped/restricted tokens. This is a real constraint of the platform, not something this server can narrow; document it plainly in the README so users understand what they're handing to Claude Desktop (this also reinforces why the confirm-field + host-approval safeguards above matter).
- **Secrets hygiene**: `.env` (if used for local dev) must be in `.gitignore` alongside `dist/` and `node_modules/`; only `.env.example` (no real values) is committed. `YNAB_ACCESS_TOKEN` is never written to disk by the server itself (no config-file persistence, per the user's requirement).
- **Transport**: `YNAB_API_BASE_URL` is overridable (for future testing), but the default and documented value is always `https://api.ynab.com/v1` (TLS). No code path should silently accept a plaintext `http://` override in normal operation.
- **Supply chain**: commit the pnpm lockfile, keep dependencies minimal (already the case — `@modelcontextprotocol/sdk`, `ynab`, `zod` as the only runtime deps), and run `pnpm audit` before the eventual npm publish.

## Configuration

- `YNAB_ACCESS_TOKEN` (required) — read once at startup via a zod-validated `loadConfig()` in `src/config.ts`; missing/empty token fails fast on stderr with a clear message and a non-zero exit, so Claude Desktop's logs make the problem obvious immediately.
- `YNAB_API_BASE_URL` (optional, defaults to `https://api.ynab.com/v1`) — useful for testing later, costs nothing to support now.
- Claude Desktop config (`claude_desktop_config.json`) for local use during development:
  ```json
  {
    "mcpServers": {
      "ynab": {
        "command": "node",
        "args": ["/absolute/path/to/ynab-mcp/dist/index.js"],
        "env": { "YNAB_ACCESS_TOKEN": "<personal access token>" }
      }
    }
  }
  ```

## Testing strategy (no live YNAB sandbox available)

1. **Unit** (`test/unit/`) — `format.test.ts` (milliunits/currency edge cases), `errors.test.ts` (synthetic YNAB error shapes → correct `YnabToolError`), `tools/*.test.ts` (hand-written mock `YnabClient` per test, call tool handlers directly, assert correct SDK calls + result shape + confirm-field enforcement).
2. **Integration** (`test/integration/`) — real `McpServer` built via `createServer(config, () => mockClient)`, connected to a real `Client` over the MCP SDK's `InMemoryTransport`, driven via `listTools()`/`callTool()` — catches zod→JSON-Schema serialization bugs a handler-only test would miss.
3. **Live** (`test/live/`) — excluded from default `pnpm test`; gated behind `YNAB_LIVE_TEST_TOKEN`/`YNAB_LIVE_TEST_BUDGET_ID` (skip, not fail, if unset). Scope: read-only tools (`get_user`, `list_budgets`, `list_accounts`, `list_categories`, `list_transactions`) against a real budget — this is also how the budgets-vs-plans spike question gets resolved definitively. A separate, explicitly-named, manually-triggered write round-trip test may exist behind an additional `YNAB_LIVE_TEST_ALLOW_WRITES=true` guard.

## Phased build order

1. **Spike & foundations** — scaffold repo (package.json scripts, tsconfig, tsup, oxlint/oxfmt, vitest), add deps (including pinning zod to the MCP SDK's expected major), resolve the budgets-vs-plans question and capture real field-level nullability with a throwaway script, stub the `YnabClient` interface and branded `Milliunits` type.
2. **Minimal server + first read tools** — bare `McpServer` over stdio verified to launch and respond to `initialize`/`tools/list`; implement `list_budgets`, `get_budget`, `list_accounts`, `list_categories`, `list_transactions` end-to-end with tests; get `mapYnabError` solid now since every later tool reuses it.
3. **Complete read-only analysis** (section A) — remaining tools, `last_knowledge_of_server` support. This alone is a usable, safe v0.
4. **Category management** (section B, lower-risk writes) — introduces the confirm-field/annotation pattern; resolves `delete_category` semantics.
5. **Transaction management** (section C, higher-risk writes) — `delete_transaction` last, as the reference implementation of the full destructive-tool safety pattern.
6. **Account & budget setup** (section D) — implement or explicitly drop `close_account`/`create_payee` based on spike findings.
7. **Hardening** — rate-limit-aware error messaging, `server_knowledge` polish, broaden integration coverage, review every tool description for LLM-facing clarity, manual end-to-end pass through Claude Desktop with a real budget.

Each phase ships with its own tests and is independently usable — no phase depends on a later one to be safe or functional.

## Publish-readiness (later, not built now)

`package.json` `exports`/`files`/`engines` fields, README with install/tool docs and a safety section, semver + CHANGELOG, LICENSE, `npm publish --dry-run` sanity check. Not part of this implementation pass.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit + integration) must pass after each phase.
- After Phase 2, connect the built server to Claude Desktop (or the MCP Inspector CLI) and manually call `ynab_list_budgets`/`ynab_list_transactions` against a real budget to confirm the full pipeline works.
- Before marking any destructive tool (Phase 4+) done, manually exercise it once against a disposable/test budget to confirm the confirm-field gate and the read-before-write echo behave as designed.
