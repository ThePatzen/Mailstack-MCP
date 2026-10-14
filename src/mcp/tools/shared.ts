import type { CallToolResult } from '@modelcontextprotocol/server';
import { ImapServiceError } from '../../imap/errors.js';
import type { McpPrincipal } from '../../http/mcp-auth.js';

export function executeAuthorized<T>(principal: McpPrincipal, toolName: string, action: () => Promise<T>): Promise<T> {
  // Hiding a tool from tools/list is not authorization; check before any mail
  // operation so a direct call cannot bypass the token's permission set.
  if (!principal.enabledTools.includes(toolName)) {
    throw new ImapServiceError('PERMISSION', 'This MCP token is not allowed to use this tool.');
  }
  return action();
}

export async function toolCall<T extends Record<string, unknown>>(
  principal: McpPrincipal,
  toolName: string,
  action: () => Promise<T>,
): Promise<CallToolResult> {
  try {
    const result = await executeAuthorized(principal, toolName, action);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    // Preserve known, safe service errors while hiding unexpected internals.
    const message = error instanceof ImapServiceError ? error.message : 'The mailbox operation failed.';
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}
