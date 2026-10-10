# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: TypeScript/Node.js, Express, EJS, SQLite; this stack was selected in the approved implementation plan.

## Users

Inferred from the approved requirements: people who configure an IMAP MCP server for their own mail server and need to connect their personal mailbox credentials and manage their MCP tokens.

## Product Purpose

Inferred from the approved requirements: provide a self-hosted MCP service for common IMAP mailbox tasks, with an optional SMTP send capability. Success means users can connect their mailbox through a protected web UI, issue and manage user tokens, and control which tools each token can use.

## Positioning

Inferred from the approved requirements: user tokens are issued only after both the shared static management token and a successful IMAP login; each token is scoped to one mailbox and individually permissioned.

## Operating Context

Inferred from the approved requirements: runs as a Docker Compose service on the mail server behind Nginx HTTPS. Users visit the management UI to verify their IMAP credentials, then copy the one-time token into their MCP client. The management UI also lists, revokes, and adjusts permissions for their own tokens.

## Capabilities and Constraints

Inferred from the approved requirements: supports common IMAP mailbox and message operations; SMTP is optional and uses the same mailbox credentials, with sent mail archived in the Sent folder. IMAP host and deployment secrets are configured by environment. User credentials are encrypted at rest, tokens are revocable, and permissions are per tool. The static token gates management access; user tokens authenticate MCP calls.

## Product Principles

- Keep each user's mailbox data and token management isolated to their account.
- Require successful IMAP authentication before storing credentials or issuing MCP access.
- Make token scope and permission changes understandable and reversible.
- Preserve sent messages in the mailbox after SMTP delivery.

## Accessibility & Inclusion

Undecided; no product-specific requirement was established.
