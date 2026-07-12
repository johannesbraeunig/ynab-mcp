import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YnabClient } from "../ynab/client.js";
import { registerBudgetTools } from "./budgets.js";
import { registerAccountTools } from "./accounts.js";
import { registerCategoryTools } from "./categories.js";
import { registerMonthTools } from "./months.js";
import { registerPayeeTools } from "./payees.js";
import { registerScheduledTransactionTools } from "./scheduled_transactions.js";
import { registerTransactionTools } from "./transactions.js";

export function registerAllTools(server: McpServer, ynab: YnabClient): void {
  registerBudgetTools(server, ynab);
  registerAccountTools(server, ynab);
  registerCategoryTools(server, ynab);
  registerMonthTools(server, ynab);
  registerPayeeTools(server, ynab);
  registerScheduledTransactionTools(server, ynab);
  registerTransactionTools(server, ynab);
}
