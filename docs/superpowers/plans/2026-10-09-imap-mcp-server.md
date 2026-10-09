# IMAP MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-Compose-hosted MCP service for Dovecot IMAP with user-owned, revocable tokens and an optional SMTP send tool that archives sent messages.

**Architecture:** One TypeScript/Node.js service hosts a Streamable HTTP MCP endpoint and a server-rendered management UI. SQLite stores account data, hashed user tokens, permissions, and sessions; IMAP credentials are encrypted with a deployment-provided key. MCP requests resolve the Bearer user token to a mailbox principal, then register only that token's permitted tools.

**Tech Stack:** TypeScript, Node.js 20+, MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`), Express, EJS, ImapFlow, Nodemailer, SQLite, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-09-imap-mcp-design.md`

## Global Constraints

- The service runs as one Docker Compose instance behind Nginx; the public HTTPS endpoint is `/mcp` and the management UI is `/manage`.
- `IMAP_HOST` is required; IMAP and SMTP TLS certificates are verified.
- `MCP_STATIC_TOKENS` gates the management UI; MCP calls use individual user tokens as Bearer tokens.
- User tokens are random, displayed once, stored hashed, revocable, and granted tool permissions individually.
- IMAP credentials are encrypted with the deployment key and stored in SQLite.
- SQLite data is persisted through the configurable Compose bind mount `${DATA_DIR:-./data}:/app/data`.
- SMTP is disabled unless `SMTP_HOST` is set; it uses the account's IMAP username and password.
- SMTP messages are appended to the `\Sent` mailbox; failed archival after SMTP acceptance is reported without resending.
- Do not log credentials, tokens, or complete message bodies.

## Review Focus

- Wrong static token or failed IMAP login must not create an account, session, or MCP token.
- A revoked or unknown user token must fail before any IMAP or SMTP connection is opened.
- A token denied a tool must not see that tool in `tools/list`, and a direct call must still be denied.
- SMTP success followed by IMAP APPEND failure must report partial success and must never send again as recovery.
- Missing TLS, an invalid encryption key, or a non-writable bind mount must fail closed with an actionable startup or request error.

---

### Task 1: Create the service scaffold and configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `src/config.ts`
- Create: `src/main.ts`

**Interfaces:**
- Produces `loadConfig(env: NodeJS.ProcessEnv): AppConfig`.
- `AppConfig` contains `httpPort`, `dataDir`, `staticTokens`, `encryptionKey`, `imap: { host, port, tlsMode }`, optional `smtp: { host, port, tlsMode }`, and optional `sentFolder`.
- `tlsMode` is `'implicit' | 'starttls'`. `IMAP_PORT` defaults to `993`; `SMTP_HOST` controls whether SMTP is enabled.

- [ ] Create the TypeScript package with Node.js 20+ and dependencies: `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, Express, EJS, Helmet, `express-rate-limit`, ImapFlow, Nodemailer, `better-sqlite3`, and `mailparser`; include TypeScript and `tsx` for development.
- [ ] Implement `loadConfig` in `src/config.ts`: parse `MCP_STATIC_TOKENS` as a JSON string array, require `IMAP_HOST`, parse `IMAP_TLS_MODE` and ports, resolve `DATA_DIR`, and decode a 32-byte base64 encryption key from `ENCRYPTION_KEY` or `ENCRYPTION_KEY_FILE`. Reject malformed or insecure settings at startup.
- [ ] Create the Compose service and Docker image. Bind `${DATA_DIR:-./data}` to `/app/data`, publish the app only on `127.0.0.1:${APP_PORT:-3000}:3000`, run as a non-root user, and keep SMTP absent unless configured. At startup, verify `/app/data` exists and is writable, otherwise fail with an actionable message.
- [ ] Add `.env.example` with names and safe examples only; never include usable tokens or encryption keys.
- [ ] Add the Express application entry point in `src/main.ts`, load configuration before opening the listener, and register a shutdown path that closes the HTTP server and database.

### Task 2: Add encrypted account storage and token persistence

**Files:**
- Create: `src/storage/database.ts`
- Create: `src/storage/repository.ts`
- Create: `src/storage/migrations/001-initial.sql`
- Create: `src/security/crypto.ts`
- Create: `src/security/tokens.ts`

**Interfaces:**
- `encryptSecret(plaintext: string, key: Buffer): EncryptedSecret` and `decryptSecret(secret: EncryptedSecret, key: Buffer): string`, using AES-256-GCM with a fresh nonce per encryption.
- `createOrUpdateAccount(username: string, encryptedPassword: EncryptedSecret): AccountRecord`.
- `getAccountCredentials(accountId: string): { username: string; encryptedPassword: EncryptedSecret } | null`.
- `createUserToken(accountId: string, label: string): { token: string; summary: TokenSummary }`.
- `findUserToken(token: string): AuthenticatedToken | null`; `listTokens(accountId: string): TokenSummary[]`; `revokeToken(accountId: string, tokenId: string): boolean`.
- `setToolPermission(accountId: string, tokenId: string, toolName: string, allowed: boolean): void`.
- `createSession(accountId: string, expiresAt: number): string`; `findSession(sessionId: string): { accountId: string; expiresAt: number } | null`; `deleteSession(sessionId: string): void`.

- [ ] Define SQLite tables for accounts, tokens, per-token tool permissions, and expiring management sessions. Enforce unique token hashes and account-scoped token operations with foreign keys.
- [ ] Implement database initialization and versioned migrations in `src/storage/database.ts`; place the database under `/app/data`.
- [ ] Implement AES-256-GCM encryption and decryption in `src/security/crypto.ts`. Store ciphertext, nonce, and authentication tag; reject decryption if the configured key is invalid or has changed.
- [ ] Generate user tokens from 32 random bytes encoded as base64url. Persist only a SHA-256 digest; compare token digests in constant time and update `last_used_at` only after successful authentication.
- [ ] Implement the repository functions. Scope list, permission-change, and revocation operations to the authenticated account so one account cannot manage another account's tokens.

### Task 3: Build the management login and token UI

**Files:**
- Create: `src/web/app.ts`
- Create: `src/web/auth.ts`
- Create: `src/web/sessions.ts`
- Create: `src/web/csrf.ts`
- Create: `src/web/routes.ts`
- Create: `src/web/views/login.ejs`
- Create: `src/web/views/tokens.ejs`

**Interfaces:**
- `verifyStaticToken(candidate: string, configuredTokens: string[]): boolean`.
- `verifyImapLogin(username: string, password: string): Promise<void>`.
- `createManagementSession(accountId: string): string`; `requireManagementSession(req, res, next): void`.
- `createManagementApp(dependencies: WebDependencies): Express`.

- [ ] Implement the login form and `POST /manage/login`. Require a configured static token and a successful TLS IMAP login before creating/updating the account, encrypting its password, or creating a session.
- [ ] Add per-IP and per-account login rate limits, secure response headers, short-lived `HttpOnly; Secure; SameSite=Lax` cookies, random session IDs, session expiration, CSRF tokens on state-changing forms, and Express proxy trust limited to the Nginx hop.
- [ ] Implement `GET /manage/tokens` to list only the logged-in account's token summaries, current per-tool permissions, creation/last-use metadata, and revoked state; never return stored token digests or secrets.
- [ ] Implement account-scoped create, revoke, and permission-update forms. Show the full user token only in the create response and provide no later reveal operation.
- [ ] Implement logout and session expiration. Ensure invalid credentials or static tokens leave no account, token, or live session behind.

### Task 4: Implement the Dovecot IMAP service and base operations

**Files:**
- Create: `src/imap/client.ts`
- Create: `src/imap/mailboxes.ts`
- Create: `src/imap/messages.ts`
- Create: `src/imap/mime.ts`
- Create: `src/imap/errors.ts`

**Interfaces:**
- `withImapClient<T>(accountId: string, action: (client: ImapFlow) => Promise<T>): Promise<T>` decrypts the account credentials, opens a fresh TLS-verified connection, runs one operation, and logs out in `finally`.
- Mailbox operations: `listMailboxes(accountId)`, `createMailbox(accountId, name)`, `renameMailbox(accountId, oldName, newName)`, `deleteMailbox(accountId, name)`.
- Message operations use UIDs: `listMessages(accountId, mailbox, page)`, `searchMessages(accountId, mailbox, criteria, page)`, `readMessage(accountId, mailbox, uid)`, `getAttachment(accountId, mailbox, uid, partId)`, `setMessageFlags(accountId, mailbox, uid, flags)`, `copyMessage(accountId, mailbox, uid, destination)`, `moveMessage(accountId, mailbox, uid, destination)`, `deleteMessage(accountId, mailbox, uid)`, and `expungeMessages(accountId, mailbox)`.
- `MessagePage` is `{ limit: number; beforeUid?: number }`; `SearchCriteria` supports `from`, `to`, `subject`, `text`, `since`, `before`, `unreadOnly`, and `flaggedOnly`; `MessageFlags` supports `seen?: boolean` and `flagged?: boolean`.

- [ ] Implement connection creation from validated `AppConfig` and per-account encrypted credentials. Disable protocol debug logging; always close the connection even when an IMAP command fails.
- [ ] Implement mailbox operations with the ImapFlow mailbox API and return structured, bounded results.
- [ ] Implement UID-based message listing, search, reading, attachment retrieval, flags, copy, move, delete, and explicit expunge. Parse MIME content with `mailparser`; do not return an entire attachment unless the caller requests its part ID.
- [ ] Resolve Dovecot special-use `\Trash` for delete behavior. Move there when available; otherwise mark the message `\Deleted` without expunging. Keep permanent expunge as a separate tool operation.
- [ ] Map authentication, permission, unsupported-command, connection, timeout, and malformed-input errors into safe user-facing error types without exposing passwords or raw message content in logs.

### Task 5: Add MCP authentication and per-token tool registration

**Files:**
- Create: `src/http/mcp-auth.ts`
- Create: `src/mcp/server.ts`
- Create: `src/mcp/tools/mailboxes.ts`
- Create: `src/mcp/tools/messages.ts`
- Modify: `src/main.ts`

**Interfaces:**
- `verifyMcpBearerToken(header: string | undefined): Promise<McpPrincipal | null>` returns `{ accountId, tokenId, enabledTools }` only for an active token.
- `buildMcpServer(principal: McpPrincipal): McpServer` registers only permitted tools.
- `McpPrincipal` is `{ accountId: string; tokenId: string; username: string; enabledTools: string[] }` and is carried in validated `AuthInfo.extra`.
- The Express MCP route attaches the validated `AuthInfo` as `req.auth`; `toNodeHandler(createMcpHandler(ctx => buildMcpServer(principalFrom(ctx.authInfo))))` creates the per-request MCP instance.

- [ ] Implement Bearer parsing, token hash lookup, revocation checks, last-use updates, and a 401 response before MCP handling for missing or invalid tokens.
- [ ] Build the MCP handler with the official SDK's per-request factory and Node adapter; ensure `tools/list` is account-token-specific. Scope form-body parsing to `/manage` so the MCP adapter receives the original request stream.
- [ ] Register the individually typed mailbox and message tools with Zod input schemas and structured outputs. Use the exact operation names and service interfaces from Task 4.
- [ ] Enforce tool permission in each invocation in addition to filtering the tool list. Return a permission error before opening IMAP when a direct call targets a disabled tool.
- [ ] Register `expunge_messages` separately and make its permission independent of `delete_message`.

### Task 6: Add optional SMTP send and Sent archival

**Files:**
- Create: `src/smtp/sender.ts`
- Create: `src/mcp/tools/send-email.ts`
- Modify: `src/mcp/server.ts`

**Interfaces:**
- `sendAndArchive(accountId: string, message: SendEmailInput): Promise<{ messageId: string; sent: true; archived: boolean; archiveError?: string }>`.
- `SendEmailInput` is `{ to: string[]; cc?: string[]; bcc?: string[]; subject: string; text?: string; html?: string; attachments?: Array<{ filename: string; contentType?: string; contentBase64: string }> }`.
- `resolveSentMailbox(accountId: string, override?: string): Promise<string>` resolves the explicit `IMAP_SENT_FOLDER` first, then a mailbox advertised with `\Sent`, and fails before SMTP if neither exists.

- [ ] Add SMTP transport configuration only when `SMTP_HOST` is present; authenticate with the account's stored IMAP username and password and require verified TLS/STARTTLS.
- [ ] Resolve the Sent mailbox before sending. Compose one RFC 822/MIME buffer with Nodemailer's MailComposer, using the account username as `From`, and the recipient, subject, text/HTML, and attachment inputs from `SendEmailInput`.
- [ ] Send the composed message using Nodemailer's raw-message option with an explicit SMTP envelope and with file/URL access disabled, then append the same bytes to the Sent mailbox with `\Seen`.
- [ ] If SMTP rejects the message, return a send failure. If SMTP accepts it and IMAP APPEND fails, return `{ sent: true, archived: false }` with a safe error and never retry the SMTP send.
- [ ] Register `send_email` only when SMTP is configured and enforce its independent per-token permission.

### Task 7: Document deployment and account operations

**Files:**
- Create: `README.md`
- Modify: `.env.example`
- Modify: `compose.yaml`

- [ ] Document Compose startup, the host bind-mount path, directory ownership/write access, and the loopback-only Nginx proxy arrangement.
- [ ] Document required IMAP settings, static token list format, encryption-key generation and backup, optional SMTP settings, and `IMAP_SENT_FOLDER` override.
- [ ] Document UI login, one-time token display, token revocation, per-tool permissions, and the distinction between the static UI token and MCP user tokens.
- [ ] Include an Nginx reverse-proxy example for `/mcp` and `/manage` that preserves streaming responses and forwards the original host/protocol headers.
