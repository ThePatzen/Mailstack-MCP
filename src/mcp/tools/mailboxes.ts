import { requireScopes, type McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createMailbox, deleteMailbox, listMailboxes, renameMailbox } from '../../imap/mailboxes.js';
import type { McpPrincipal } from '../../http/mcp-auth.js';
import { toolCall } from './shared.js';

const mailboxName = z.string().trim().min(1).max(1024).refine((value) => !/[\r\n\0]/.test(value));
const mailboxOutput = z.object({
  path: z.string(), name: z.string(), delimiter: z.union([z.string(), z.literal(false)]),
  specialUse: z.string().nullable(), flags: z.array(z.string()),
});

/** Registers mailbox tools that this token is allowed to discover and invoke. */
export function registerMailboxTools(server: McpServer, principal: McpPrincipal): void {
  // Expose only mailbox operations allowed by this token. toolCall repeats the
  // check when each handler is invoked.
  if (principal.enabledTools.includes('list_mailboxes')) {
    server.registerTool('list_mailboxes', {
      description: 'List the mailboxes available to the authenticated account.',
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['mailstack:list_mailboxes'] }] },
      scopeChallenge: requireScopes('mailstack:list_mailboxes'),
      inputSchema: z.object({}),
      outputSchema: z.object({ mailboxes: z.array(mailboxOutput) }),
      annotations: { readOnlyHint: true },
    }, async () => toolCall(principal, 'list_mailboxes', async () => ({
      mailboxes: await listMailboxes(principal.accountId),
    })));
  }

  if (principal.enabledTools.includes('create_mailbox')) {
    server.registerTool('create_mailbox', {
      description: 'Create a mailbox for the authenticated account.',
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['mailstack:create_mailbox'] }] },
      scopeChallenge: requireScopes('mailstack:create_mailbox'),
      inputSchema: z.object({ name: mailboxName }),
      outputSchema: z.object({ success: z.boolean(), name: z.string() }),
      annotations: { destructiveHint: false },
    }, async ({ name }) => toolCall(principal, 'create_mailbox', async () => {
      await createMailbox(principal.accountId, name);
      return { success: true, name };
    }));
  }

  if (principal.enabledTools.includes('rename_mailbox')) {
    server.registerTool('rename_mailbox', {
      description: 'Rename an existing mailbox.',
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['mailstack:rename_mailbox'] }] },
      scopeChallenge: requireScopes('mailstack:rename_mailbox'),
      inputSchema: z.object({ oldName: mailboxName, newName: mailboxName }),
      outputSchema: z.object({ success: z.boolean(), oldName: z.string(), newName: z.string() }),
      annotations: { destructiveHint: false },
    }, async ({ oldName, newName }) => toolCall(principal, 'rename_mailbox', async () => {
      await renameMailbox(principal.accountId, oldName, newName);
      return { success: true, oldName, newName };
    }));
  }

  if (principal.enabledTools.includes('delete_mailbox')) {
    server.registerTool('delete_mailbox', {
      description: 'Delete an existing mailbox and its contents.',
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['mailstack:delete_mailbox'] }] },
      scopeChallenge: requireScopes('mailstack:delete_mailbox'),
      inputSchema: z.object({ name: mailboxName }),
      outputSchema: z.object({ success: z.boolean(), name: z.string() }),
      annotations: { destructiveHint: true },
    }, async ({ name }) => toolCall(principal, 'delete_mailbox', async () => {
      await deleteMailbox(principal.accountId, name);
      return { success: true, name };
    }));
  }
}
