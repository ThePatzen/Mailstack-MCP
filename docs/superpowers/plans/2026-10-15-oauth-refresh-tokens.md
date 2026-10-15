# OAuth Refresh Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support secure OAuth refresh-token rotation for public MCP clients while keeping access tokens short-lived and grants bounded.

**Architecture:** Extend the existing OAuth repository and token endpoint. Persist only refresh-token hashes in a versioned SQLite table, bind each token to the existing grant, and perform single-use rotation plus replay revocation in an immediate transaction. Keep the current authorization-code and MCP bearer flows intact.

**Tech Stack:** Node.js 20+, TypeScript, Express, better-sqlite3, SQLite migrations, EJS documentation.

**Spec:** `docs/superpowers/specs/2026-10-15-mcp-oauth-design.md`

## Global Constraints

- Access tokens live for one hour.
- Each OAuth grant has a fixed maximum lifetime of 30 days from initial authorization; refreshes do not extend it.
- Store only cryptographic hashes of authorization codes, access tokens, and refresh tokens.
- Refresh tokens are single-use and rotate atomically; reuse of a consumed refresh token revokes its grant.
- Refresh and access tokens remain bound to the grant's existing client, resource, account, User-Token, and scopes.
- Never log credentials or raw OAuth tokens; preserve current TLS and token-permission enforcement.

## Review Focus

- Replaying a consumed refresh token from its matching client and resource must revoke the associated grant; inspect repository transaction behavior.
- Refresh attempts for an expired, revoked, wrong-client, wrong-resource, or deleted-parent grant must fail without minting tokens; inspect repository guards and joins.
- Concurrent refresh attempts must not both succeed; inspect the immediate transaction and conditional consume.
- Grants reaching their 30-day deadline must not be renewed; inspect boundary expiry comparisons.
- Existing authorization-code exchange and direct User-Token authentication must retain their current behavior; run the repository typecheck and inspect the diff.

---

### Task 1: Persist refresh-token rotation state

**Files:**
- Create: `src/storage/migrations/004-oauth-refresh-tokens.sql`
- Modify: `src/storage/database.ts`
- Modify: `src/storage/repository.ts`

**Interfaces:**
- Consumes: Existing `oauth_grants`, `oauth_access_tokens`, `hashToken`, and token generation helpers.
- Produces: Repository functions to issue a refresh token with a new grant, and to atomically rotate a refresh token into a new access/refresh pair or reject/revoke a replayed grant.

- [x] Add a `grant_types` column to OAuth clients with an authorization-code-only default for existing clients. Add a refresh-token table keyed by `refresh_token_hash`, with grant foreign key, created/expiry timestamps, and `consumed_at`; index by grant and expiry. Register migration version 4.
- [x] Extend initial authorization-code redemption so grant expiry is `now + 30 days`, access-token expiry is `min(now + 1 hour, grant expiry)`, and a hashed refresh token is persisted when registered.
- [x] Add repository rotation logic that validates grant expiry/revocation, active parent User-Token, client ID, optional resource, and hash; atomically consumes the old token and inserts the new hashed refresh/access tokens.
- [x] If a previously consumed token is presented by its matching client and resource, revoke its grant in the same transaction; reject unknown/expired tokens without issuing credentials.
- [x] Bound cleanup of expired refresh-token rows while retaining consumed hashes until grant expiry for replay detection.
- [x] Run `npm run typecheck` and inspect the migration/repository diff for hash-only storage, expiry checks, and transaction boundaries.

### Task 2: Expose refresh grant through OAuth protocol and HTTP

**Files:**
- Modify: `src/oauth/protocol.ts`
- Modify: `src/oauth/routes.ts`
- Modify: `src/storage/repository.ts` only if Task 1's exported result contract needs integration adjustments.

**Interfaces:**
- Consumes: Task 1 repository token issuance and rotation functions.
- Produces: OAuth metadata and DCR response advertising `authorization_code` plus `refresh_token`; `/oauth/token` accepts `grant_type=refresh_token` and returns standards-compatible token responses.

- [x] Change client metadata validation to allow `authorization_code` alone or with `refresh_token`; default omitted grants to authorization-code-only and retain response type `code` and public-client requirements.
- [x] Advertise both supported grant types in authorization-server metadata and echo the declared grants in dynamic registration responses.
- [x] Include `refresh_token` in the initial code exchange response when registered for that grant.
- [x] Parse refresh-token requests with bounded form fields; require the public `client_id`, validate optional resource against the grant binding, and return a rotated access/refresh pair with one-hour-or-less access expiry and preserved scope.
- [x] Map invalid, expired, mismatched, and replayed refresh credentials to generic `invalid_grant` responses without leaking grant existence.
- [x] Run `npm run typecheck` and inspect all OAuth responses to ensure no refresh/access raw token is logged.

### Task 3: Update operating documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-15-mcp-oauth-design.md`

**Interfaces:**
- Consumes: Shipped endpoint behavior and the approved OAuth design.
- Produces: Accurate operator/client documentation for one-hour access tokens, refresh rotation, fixed 30-day grant lifetime, and grant revocation on token reuse.

- [x] Update OAuth setup text that currently describes tokens as short-lived without refresh behavior.
- [x] Document that clients refresh automatically when supported, refresh tokens rotate, and users must authorize again after the fixed 30-day grant expires.
- [x] Run `npm run typecheck`, `git diff --check`, and review README/spec statements against the implemented constants and route behavior.
