/**
 * MCP stdio szerver mod: a KeyPro muveletek nativ MCP tool-kent, ugyanazon
 * a kliensen keresztul, mint a CLI parancsok. A tool-definiciok a megosztott
 * mcp-tools.ts-ben vannak (a webes tavoli MCP route is azt hasznalja).
 * Regisztralas Claude Code-ban:
 *   claude mcp add keypro -- npx -y @keypro/cli mcp
 * Auth: KEYPRO_API_KEY env vagy a CLI config (login nincs MCP-n keresztul).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type KeyproClient } from "./client.js";
import { KEYPRO_MCP_VERSION, registerKeyproTools } from "./mcp-tools.js";

export async function runMcpServer(client: KeyproClient): Promise<void> {
  const server = new McpServer({ name: "keypro", version: KEYPRO_MCP_VERSION });
  registerKeyproTools(server, client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
