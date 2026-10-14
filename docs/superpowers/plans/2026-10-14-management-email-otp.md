# Management Email One-Time-Code Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add optional email one-time-code sign-in to the management UI while retaining static management-token login and existing mailbox SMTP sending behavior.

**Architecture:** Add an optional system-mail configuration that reuses the existing SMTP endpoint, plus a dedicated verification-mail sender using separate credentials and `SMTP_SYSTEM_FROM`. Persist expiring verification challenges in SQLite with keyed digests and an encrypted pending mailbox password; verify and consume each challenge atomically before creating/updating the account and issuing a management session.

**Tech Stack:** TypeScript, Node.js, Express, EJS, `express-rate-limit`, Nodemailer, SQLite (`better-sqlite3`), existing AES-256-GCM and CSRF/session helpers.

**Spec:** `docs/superpowers/specs/2026-10-14-management-email-otp-design.md`

## Global Constraints

- Email-code login is available only when `SMTP_HOST`, `SMTP_SYSTEM_USER`, `SMTP_SYSTEM_PASSWORD`, and `SMTP_SYSTEM_FROM` are all configured.
- Partial system-mail settings do not prevent startup; the management-token login remains available.
- Both sign-in methods verify the mailbox credentials through the configured IMAP server before creating/updating account credentials or a management session.
- Codes are six digits, expire after ten minutes, are single-use, and allow at most five verification attempts.
- Reissuing a code invalidates its predecessor; rate limits cover both IP and normalized account identity.
- Persist only keyed/hash digests of challenge IDs and codes; keep the pending mailbox password encrypted with the existing AES-256-GCM key.
- System SMTP credentials are used only for verification mail. Regular `send_email` keeps authenticating with mailbox credentials and archiving to Sent.
- Never log mailbox passwords, verification codes, challenge IDs, or SMTP authentication details.

## Review Focus

- Partial SMTP system-mail configuration must disable email login without disabling server startup or management-token login; cover this in Task 1's configuration checks.
- SMTP delivery failure must leave no usable challenge or session; cover this in Task 3's flow checks.
- Concurrent submissions of a valid code must create at most one session/account update; cover this in Task 2's atomic consume checks.
- Expired, replaced, consumed, and five-attempt challenges must all be rejected; cover this in Task 2's challenge lifecycle checks.
- Normal message sending must not start using system-mail credentials or sender address; cover this in Task 3's sender separation checks.

---

### Task 1: Parse optional verification-mail configuration

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Extend `AppConfig` with optional `systemMail?: { user: string; password: string; from: string }`.
- `AppConfig.smtp` remains the existing endpoint configuration; email-code login is enabled only when both `smtp` and `systemMail` exist.

- [x] Add `SMTP_SYSTEM_USER`, `SMTP_SYSTEM_PASSWORD`, and `SMTP_SYSTEM_FROM` parsing. Trim the username/from address, preserve password bytes except surrounding env whitespace, and reject CR/LF/NUL in the From address.
- [x] Treat missing or whitespace-only values as unconfigured; if any system-mail value is present but the set is incomplete, leave `systemMail` unset and keep startup successful.
- [x] Add the three variables to `.env.example` with empty values and document their relationship to `SMTP_HOST`, plus the optional login behavior, in `README.md`.
- [x] Inspect the resulting configuration behavior for: no SMTP, SMTP without system credentials, partially set system credentials, and all required settings set. Confirm existing `send_email` configuration remains keyed only to `SMTP_HOST`.

### Task 2: Store and atomically consume verification challenges

**Files:**
- Create: `src/storage/migrations/002-email-login-challenges.sql`
- Modify: `src/storage/database.ts`
- Modify: `src/storage/repository.ts`
- Modify: `src/security/tokens.ts`

**Interfaces:**
- `createEmailLoginChallenge(input: { username: string; encryptedPassword: EncryptedSecret; code: string; expiresAt: number }): string` creates/replaces the pending challenge for the normalized account identity and returns a random opaque challenge ID.
- `consumeEmailLoginChallenge(input: { challengeId: string; code: string; now: number }): { username: string; encryptedPassword: EncryptedSecret } | null` atomically checks expiry/attempt limits, increments wrong attempts, and consumes a valid challenge exactly once.
- `invalidateEmailLoginChallenge(challengeId: string): void` deletes the challenge if it exists.

- [x] Add a migration for one active pending challenge per normalized username, storing challenge ID digest, code HMAC, encrypted pending-password ciphertext/nonce/tag, expiry, and attempt count. Add an index supporting expiry cleanup.
- [x] Add a keyed HMAC digest helper using the configured encryption key and domain-separated inputs for challenge IDs and six-digit codes; compare stored and candidate digests with constant-time comparison.
- [x] Implement challenge creation in one SQLite transaction: delete any previous challenge for that normalized username, generate an opaque 32-byte ID, insert the digests and encrypted password, and opportunistically delete expired challenges.
- [x] Implement atomic consumption so an incorrect code increments attempts and exhausts the challenge at five failures; a valid code returns its pending credentials and deletes the row in the same transaction. Reject expired, missing, superseded, already consumed, and exhausted challenges.
- [x] Confirm the repository enforces one-time consumption under concurrent calls and never returns the stored code digest or challenge ID digest.

### Task 3: Add system-mail sender and the two-step login flow

**Files:**
- Create: `src/smtp/system-mail.ts`
- Modify: `src/web/routes.ts`
- Modify: `src/web/views/login.ejs`
- Modify: `src/web/app.ts`
- Modify: `src/web/sessions.ts` only if the existing session helper needs an exported interface

**Interfaces:**
- `sendManagementLoginCode(config: AppConfig, recipient: string, code: string, expiresAt: number): Promise<void>` sends a plain-text verification email via the configured SMTP endpoint and system-mail credentials.
- `WebDependencies` exposes the system-mail capability/configuration while preserving current `smtpConfigured` behavior for the `send_email` tool.

- [x] Refactor the login page to show “Code per E-Mail” and “Verwaltungstoken” options when email login is configured; otherwise show the management-token path and explain that email-code login is unavailable.
- [x] Keep token login behavior: verify CSRF, static token, rate limits, and IMAP credentials, then update the account and create a management session.
- [x] Add an email-code request endpoint: verify CSRF and login limits, validate bounded username/password inputs, verify IMAP credentials, generate a cryptographically secure six-digit code, persist the encrypted pending challenge, send mail, and invalidate the challenge if SMTP fails.
- [x] Add a code verification endpoint: verify CSRF, IP/account rate limits, and the opaque challenge ID; consume a valid code through the repository, then create/update the account and management session and redirect to `/manage/tokens`.
- [x] Return generic messages for IMAP failure, invalid/expired code, and SMTP failure; do not create/update accounts or sessions before a valid code is consumed. Apply no-store headers and existing secure cookie settings to both steps.
- [x] Do not retain plaintext passwords for a resend action. A replacement code requires restarting email login with fresh IMAP credentials; this re-verifies IMAP, invalidates the prior challenge, and remains covered by the same IP/account rate limits.
- [x] Confirm verification email uses `SMTP_SYSTEM_USER`, `SMTP_SYSTEM_PASSWORD`, and `SMTP_SYSTEM_FROM`, while `src/smtp/sender.ts` and the normal `send_email` flow remain unchanged.

### Task 4: Review deployment instructions and end-to-end behavior

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Review: `src/config.ts`, `src/storage/repository.ts`, `src/web/routes.ts`, `src/smtp/system-mail.ts`

- [x] Document the email-code and management-token login choices, required IMAP verification, six-digit code expiry and attempt limit, and system-mail setup.
- [x] Review the documented behavior against the implementation for IMAP-only startup, SMTP-only normal send configuration, complete system-mail configuration, and failed SMTP delivery.
- [x] Run the configured typecheck (`npm run typecheck` passes). `package.json` defines no production build command.
- [x] Review diffs for unintended changes to MCP bearer-token auth, user token permissions, normal SMTP sender behavior, CSRF, cookie security, or logs.


## Completion note

The implementation is merged into `main`. Static review approved the feature and its follow-up documentation. `npm run typecheck` passes after correcting existing ImapFlow/MCP/Node module typing issues. No test script or production build command is defined in `package.json`; no tests were run.
