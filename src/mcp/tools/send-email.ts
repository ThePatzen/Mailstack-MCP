import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { McpPrincipal } from '../../http/mcp-auth.js';
import { sendAndArchive } from '../../smtp/sender.js';
import { toolCall } from './shared.js';

const addresses = z.array(z.string().min(3).max(320)).max(100);
const sendEmailInput = z.object({
  to: addresses.min(1),
  cc: addresses.optional(),
  bcc: addresses.optional(),
  subject: z.string().max(998),
  text: z.string().max(100_000).optional(),
  html: z.string().max(100_000).optional(),
  attachments: z.array(z.object({
    filename: z.string().min(1).max(255),
    contentType: z.string().max(255).optional(),
    contentBase64: z.string().min(1).max(1_398_104),
  }).strict()).max(10).optional(),
}).strict();

const sendEmailOutput = z.object({
  messageId: z.string(),
  sent: z.literal(true),
  archived: z.boolean(),
  archiveError: z.string().optional(),
});

export function registerSendEmailTool(server: McpServer, principal: McpPrincipal): void {
  if (!principal.enabledTools.includes('send_email')) return;
  server.registerTool('send_email', {
    description: 'Send an email using the mailbox account and save the same message to Sent.',
    inputSchema: sendEmailInput,
    outputSchema: sendEmailOutput,
    annotations: { destructiveHint: false },
  }, async (input) => toolCall(principal, 'send_email', () => sendAndArchive(principal.accountId, input)));
}
