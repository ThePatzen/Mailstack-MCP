-- Keep each OAuth grant bounded by the client's requested scopes while following its User-Token permissions.
ALTER TABLE oauth_grants ADD COLUMN scope_ceiling TEXT NOT NULL DEFAULT '[]';

-- Existing grants now inherit the linked token's current permissions within supported MCP tools.
UPDATE oauth_grants
SET scope_ceiling = '["mailstack:list_mailboxes","mailstack:create_mailbox","mailstack:rename_mailbox","mailstack:delete_mailbox","mailstack:list_messages","mailstack:search_messages","mailstack:read_message","mailstack:get_attachment","mailstack:set_message_flags","mailstack:copy_message","mailstack:move_message","mailstack:delete_message","mailstack:expunge_messages","mailstack:send_email"]';
