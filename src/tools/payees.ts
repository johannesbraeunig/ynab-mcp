import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YnabClient } from "../ynab/client.js";
import { budgetIdSchema } from "../schemas/common.js";
import { CREATES, jsonToolResult, READ_ONLY, UPDATES, withYnabErrorHandling } from "./helpers.js";

export function registerPayeeTools(server: McpServer, ynab: YnabClient): void {
  server.registerTool(
    "ynab_list_payees",
    {
      title: "List YNAB payees",
      description: "List all payees in a budget.",
      inputSchema: { budget_id: budgetIdSchema },
      annotations: READ_ONLY,
    },
    async ({ budget_id }: { budget_id: string }) =>
      withYnabErrorHandling(async () => {
        const payees = await ynab.listPayees(budget_id);
        const summary = payees
          .filter((p) => !p.deleted)
          .map((p) => ({
            id: p.id,
            name: p.name,
            transfer_account_id: p.transfer_account_id,
          }));
        return jsonToolResult(summary);
      }),
  );

  server.registerTool(
    "ynab_get_payee",
    {
      title: "Get a YNAB payee",
      description: "Get a single payee by id.",
      inputSchema: {
        budget_id: budgetIdSchema,
        payee_id: z.string().min(1).describe("YNAB payee id"),
      },
      annotations: READ_ONLY,
    },
    async ({ budget_id, payee_id }: { budget_id: string; payee_id: string }) =>
      withYnabErrorHandling(async () => {
        const p = await ynab.getPayee(budget_id, payee_id);
        return jsonToolResult({
          id: p.id,
          name: p.name,
          transfer_account_id: p.transfer_account_id,
        });
      }),
  );

  server.registerTool(
    "ynab_create_payee",
    {
      title: "Create a YNAB payee",
      description: "Create a new payee in a budget.",
      inputSchema: {
        budget_id: budgetIdSchema,
        name: z.string().min(1).describe("Name for the new payee"),
      },
      annotations: CREATES,
    },
    async ({ budget_id, name }: { budget_id: string; name: string }) =>
      withYnabErrorHandling(async () => {
        const p = await ynab.createPayee(budget_id, name);
        return jsonToolResult({
          id: p.id,
          name: p.name,
          transfer_account_id: p.transfer_account_id,
        });
      }),
  );

  server.registerTool(
    "ynab_update_payee",
    {
      title: "Update a YNAB payee",
      description: "Rename an existing payee.",
      inputSchema: {
        budget_id: budgetIdSchema,
        payee_id: z.string().min(1).describe("YNAB payee id"),
        name: z.string().min(1).describe("New name for the payee"),
      },
      annotations: UPDATES,
    },
    async ({ budget_id, payee_id, name }: { budget_id: string; payee_id: string; name: string }) =>
      withYnabErrorHandling(async () => {
        const p = await ynab.updatePayee(budget_id, payee_id, name);
        return jsonToolResult({
          id: p.id,
          name: p.name,
          transfer_account_id: p.transfer_account_id,
        });
      }),
  );
}
