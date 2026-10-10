import { McpServer } from '@modelcontextprotocol/server';
import type { McpPrincipal } from '../http/mcp-auth.js';
import { registerMailboxTools } from './tools/mailboxes.js';
import { registerMessageTools } from './tools/messages.js';

export function buildMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer({ name: 'mailstack-mcp', version: '0.1.0' }, {
    capabilities: { tools: { listChanged: false } },
  });
  registerMailboxTools(server, principal);
  registerMessageTools(server, principal);
  return server;
}
