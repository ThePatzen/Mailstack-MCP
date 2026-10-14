import { McpServer } from '@modelcontextprotocol/server';
import type { McpPrincipal } from '../http/mcp-auth.js';
import { registerMailboxTools } from './tools/mailboxes.js';
import { registerMessageTools } from './tools/messages.js';
import { registerSendEmailTool } from './tools/send-email.js';

/** Builds an MCP server with tools scoped to one authenticated user token. */
export function buildMcpServer(principal: McpPrincipal, smtpConfigured = false): McpServer {
  const server = new McpServer({ name: 'mailstack-mcp', version: '0.1.0' }, {
    capabilities: { tools: { listChanged: false } },
  });
  // Register only this token's allowed tools; toolCall also rechecks each
  // permission when a handler runs.
  registerMailboxTools(server, principal);
  registerMessageTools(server, principal);
  if (smtpConfigured) registerSendEmailTool(server, principal);
  return server;
}
