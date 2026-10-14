import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  copyMessage, deleteMessage, expungeMessages, getAttachment, listMessages, moveMessage,
  readMessage, searchMessages, setMessageFlags,
} from '../../imap/messages.js';
import type { McpPrincipal } from '../../http/mcp-auth.js';
import { toolCall } from './shared.js';

const mailbox = z.string().trim().min(1).max(1024).refine((value) => !/[\r\n\0]/.test(value));
const uid = z.number().int().safe().min(1);
const limit = z.number().int().min(1).max(50).default(20);
const page = { limit, beforeUid: uid.optional() };
const addressList = z.array(z.string());
const summary = z.object({
  uid, subject: z.string().nullable(), from: addressList, to: addressList,
  date: z.string().nullable(), flags: z.array(z.string()), size: z.number().nullable(),
});
const content = z.object({
  uid, subject: z.string().nullable(), from: addressList, to: addressList, cc: addressList,
  date: z.string().nullable(), text: z.string(), html: z.string().nullable(), truncated: z.boolean(),
  attachments: z.array(z.object({ partId: z.string(), filename: z.string(), contentType: z.string(), size: z.number() })),
});
const changed = z.object({ success: z.boolean() });

/** Registers message tools enabled for this token, with per-call checks retained. */
export function registerMessageTools(server: McpServer, principal: McpPrincipal): void {
  // Per-token registration keeps tools/list useful; toolCall remains the
  // enforcement point for every individual message operation.
  if (principal.enabledTools.includes('list_messages')) {
    server.registerTool('list_messages', {
      description: 'List recent messages in a mailbox, newest first. Results are paged by UID.',
      inputSchema: z.object({ mailbox, ...page }),
      outputSchema: z.object({ messages: z.array(summary) }),
      annotations: { readOnlyHint: true },
    }, async ({ mailbox: folder, limit: pageLimit, beforeUid }) => toolCall(principal, 'list_messages', async () => ({
      messages: await listMessages(principal.accountId, folder, { limit: pageLimit, beforeUid }),
    })));
  }

  if (principal.enabledTools.includes('search_messages')) {
    server.registerTool('search_messages', {
      description: 'Search messages in a mailbox by sender, recipient, subject, text, date, unread, or flagged status.',
      inputSchema: z.object({
        mailbox, ...page,
        criteria: z.object({
          from: z.string().max(512).optional(), to: z.string().max(512).optional(),
          subject: z.string().max(512).optional(), text: z.string().max(512).optional(),
          since: z.string().max(40).optional(), before: z.string().max(40).optional(),
          unreadOnly: z.boolean().optional(), flaggedOnly: z.boolean().optional(),
        }).strict(),
      }),
      outputSchema: z.object({ messages: z.array(summary) }),
      annotations: { readOnlyHint: true },
    }, async ({ mailbox: folder, limit: pageLimit, beforeUid, criteria }) => toolCall(principal, 'search_messages', async () => ({
      messages: await searchMessages(principal.accountId, folder, criteria, { limit: pageLimit, beforeUid }),
    })));
  }

  if (principal.enabledTools.includes('read_message')) {
    server.registerTool('read_message', {
      description: 'Read a message body and its attachment metadata by mailbox and UID. Attachment bytes are returned only by get_attachment.',
      inputSchema: z.object({ mailbox, uid }),
      outputSchema: content,
      annotations: { readOnlyHint: true },
    }, async ({ mailbox: folder, uid: messageUid }) => toolCall(principal, 'read_message', async () => ({
      ...await readMessage(principal.accountId, folder, messageUid),
    })));
  }

  if (principal.enabledTools.includes('get_attachment')) {
    server.registerTool('get_attachment', {
      description: 'Retrieve one attachment by its MIME part ID. Returned base64 content is limited in size.',
      inputSchema: z.object({ mailbox, uid, partId: z.string().regex(/^\d+(?:\.\d+)*$/).max(100) }),
      outputSchema: z.object({ filename: z.string().nullable(), contentType: z.string(), contentBase64: z.string() }),
      annotations: { readOnlyHint: true },
    }, async ({ mailbox: folder, uid: messageUid, partId }) => toolCall(principal, 'get_attachment', () =>
      getAttachment(principal.accountId, folder, messageUid, partId)));
  }

  if (principal.enabledTools.includes('set_message_flags')) {
    server.registerTool('set_message_flags', {
      description: 'Set or clear the read and flagged status of a message.',
      inputSchema: z.object({ mailbox, uid, flags: z.object({ seen: z.boolean().optional(), flagged: z.boolean().optional() }).strict()
        .refine((flags) => flags.seen !== undefined || flags.flagged !== undefined) }),
      outputSchema: changed,
      annotations: { destructiveHint: false },
    }, async ({ mailbox: folder, uid: messageUid, flags }) => toolCall(principal, 'set_message_flags', async () => {
      await setMessageFlags(principal.accountId, folder, messageUid, flags);
      return { success: true };
    }));
  }

  if (principal.enabledTools.includes('copy_message')) {
    server.registerTool('copy_message', {
      description: 'Copy one message to another mailbox.',
      inputSchema: z.object({ mailbox, uid, destination: mailbox }), outputSchema: changed,
      annotations: { destructiveHint: false },
    }, async ({ mailbox: folder, uid: messageUid, destination }) => toolCall(principal, 'copy_message', async () => {
      await copyMessage(principal.accountId, folder, messageUid, destination);
      return { success: true };
    }));
  }

  if (principal.enabledTools.includes('move_message')) {
    server.registerTool('move_message', {
      description: 'Move one message to another mailbox.',
      inputSchema: z.object({ mailbox, uid, destination: mailbox }), outputSchema: changed,
      annotations: { destructiveHint: true },
    }, async ({ mailbox: folder, uid: messageUid, destination }) => toolCall(principal, 'move_message', async () => {
      await moveMessage(principal.accountId, folder, messageUid, destination);
      return { success: true };
    }));
  }

  if (principal.enabledTools.includes('delete_message')) {
    server.registerTool('delete_message', {
      description: 'Delete one message by moving it to the server Trash mailbox when available, or marking it deleted.',
      inputSchema: z.object({ mailbox, uid }), outputSchema: changed,
      annotations: { destructiveHint: true },
    }, async ({ mailbox: folder, uid: messageUid }) => toolCall(principal, 'delete_message', async () => {
      await deleteMessage(principal.accountId, folder, messageUid);
      return { success: true };
    }));
  }

  if (principal.enabledTools.includes('expunge_messages')) {
    server.registerTool('expunge_messages', {
      description: 'Permanently expunge messages already marked deleted in a mailbox. This action is separate from delete_message.',
      inputSchema: z.object({ mailbox }), outputSchema: changed,
      annotations: { destructiveHint: true },
    }, async ({ mailbox: folder }) => toolCall(principal, 'expunge_messages', async () => {
      await expungeMessages(principal.accountId, folder);
      return { success: true };
    }));
  }
}
