# Repository guidance

## Purpose and stack

Mailstack MCP is a self-hosted MCP service for a Dovecot IMAP mailbox, with a web interface for account and token management, optional email-code management sign-in, and optional SMTP sending. It runs as one Node.js 20+ TypeScript service in Docker Compose. Express serves the management UI and Streamable HTTP MCP endpoint; SQLite stores accounts, tokens, permissions, and sessions.

## Where to look

| Area | Entry points |
| --- | --- |
| Startup and environment | `src/main.ts`, `src/config.ts`, `.env.example`, `package.json` |
| MCP endpoint, authentication, tools | `src/mcp/server.ts`, `src/http/mcp-auth.ts`, `src/mcp/tools/` |
| Management UI, routes, sessions, CSRF | `src/web/app.ts`, `src/web/routes.ts`, `src/web/auth.ts`, `src/web/sessions.ts`, `src/web/csrf.ts`, `src/web/views/` |
| IMAP operations and message parsing | `src/imap/` |
| Optional SMTP sending and Sent archival | `src/smtp/sender.ts` |
| System verification email for management sign-in | `src/smtp/system-mail.ts`, `src/web/routes.ts` |
| Encryption, token generation, persistence | `src/security/`, `src/storage/`, `src/storage/migrations/` |
| Container and local deployment | `Dockerfile`, `compose.yaml`, `README.md` |
| Product purpose and UI design | `PRODUCT.md`, `DESIGN.md` |

## Project documentation

- `README.md` is the setup, configuration, MCP client, and operating guide.
- `docs/superpowers/specs/` records agreed architecture and feature designs. Check whether a spec is implemented before treating it as current behavior.
- `docs/superpowers/plans/` records implementation plans; plans can describe work that is not yet implemented.
- Repository-specific workflow guidance is in `.agents/skills/`.

## Skill routing

- For repository orientation or changes that cross subsystems, read `$repository-workflow`.
- Before adding or changing an MCP tool, its input/output schemas, registration, or authorization, read `$mcp-tools`.

## Working rules

- Follow the current implementation and agreed specifications. If they disagree, identify the mismatch before changing behavior; a design or plan alone does not prove a feature is implemented.
- Preserve TLS certificate verification for IMAP and SMTP. Do not introduce plaintext mail connections or a switch that disables certificate checks.
- Never log passwords, complete access tokens, encryption keys, one-time codes, or full message bodies. Examples must use placeholders, not usable secrets.
- Keep management static tokens distinct from per-user MCP bearer tokens. Check token status and tool permission on every tool call; hiding a tool from `tools/list` is not sufficient authorization.
- SMTP acceptance followed by Sent-folder archival failure is a partial success. Report it without automatically sending the message again.
- Keep account, token, permission, and session operations scoped to the authenticated account. Persist schema changes as versioned SQLite migrations.
- Make focused changes in the existing structure. Update the relevant documentation when configuration, externally visible behavior, or operations change.
- Write concise code comments in plain language when they clarify a security boundary, ordering requirement, or non-obvious failure case; avoid comments that merely restate the next line.

## Available commands

- `npm start` starts the service with `tsx src/main.ts`.
- `npm run typecheck` runs `tsc --noEmit`.
- `package.json` currently defines no test script or test suite; do not assume one exists.
