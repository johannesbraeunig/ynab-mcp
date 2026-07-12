import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { createYnabClient, type YnabClient } from "./ynab/client.js";
import { registerAllTools } from "./tools/index.js";

export function createServer(
  config: Config,
  ynabClientFactory: (accessToken: string, apiBaseUrl?: string) => YnabClient = createYnabClient,
): McpServer {
  const server = new McpServer({
    name: "ynab-mcp",
    version: "0.1.0",
  });

  const ynab = ynabClientFactory(config.accessToken, config.apiBaseUrl);
  registerAllTools(server, ynab);

  return server;
}
