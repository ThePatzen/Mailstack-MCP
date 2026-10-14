# Management email one-time-code sign-in design

## Goal and agreed scope

Allow a mailbox owner to sign in to the management UI using their mailbox address and password, then prove mailbox ownership with a one-time code sent to that address. Keep the existing management token as an alternate sign-in method. The static token list continues to protect the MCP server as currently configured; user tokens continue to control MCP access and per-tool permissions.

The IMAP server remains configured by `IMAP_HOST`, `IMAP_PORT`, and `IMAP_TLS_MODE`. Email verification reuses the configured SMTP endpoint (`SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS_MODE`) and uses separate system-mail credentials and sender identity. SMTP remains optional for deployments that only need IMAP and/or management-token login.

## Login experience

The management login page explicitly presents two methods: “Code per E-Mail” and “Verwaltungstoken”. Both methods collect the mailbox username and password and verify them against the configured IMAP server. The token method also requires a valid token from `MCP_STATIC_TOKENS`; after successful IMAP authentication it creates the account/session as it does today. The email method requires no static token from the user: after successful IMAP authentication, it sends a code to the supplied mailbox and asks the user to enter that code before creating the account/session.

The email method is available only when SMTP and all system-mail settings are configured. If `SMTP_HOST` or any of `SMTP_SYSTEM_USER`, `SMTP_SYSTEM_PASSWORD`, and `SMTP_SYSTEM_FROM` is missing, the UI offers management-token login and explains that email-code login is unavailable. Partial system-mail configuration does not prevent the service from starting. Normal `send_email` behavior remains unchanged and continues to authenticate to SMTP with each mailbox’s IMAP credentials and archive the message in Sent.

## One-time-code flow

1. The user selects email-code sign-in and submits mailbox username and password with the existing CSRF protection.
2. Apply the existing IP/account rate limits, then verify credentials through IMAP. Do not reveal whether a username, password, or code was the failing value.
3. Generate a cryptographically random six-digit code, store only its keyed/hash digest, and send it to the same mailbox using the system SMTP identity. The code expires after ten minutes, can be used once, and allows at most five verification attempts. Resending invalidates the previous code and is rate-limited.
4. Keep the mailbox password encrypted with the existing AES-256-GCM key in a short-lived pending challenge record. Do not create/update the account or issue a management session until a valid code is submitted.
5. On successful verification, atomically consume the challenge, create/update the account with its encrypted password, create a management session, and redirect to token management. Expired, consumed, exhausted, and superseded challenges cannot be used. Pending records are removed when consumed and opportunistically cleaned after expiry.

The challenge identifier is random and opaque. Store challenge state in the existing SQLite database so it survives process restarts; store only a digest of the identifier and code, plus expiry, attempt count, username, and encrypted pending password fields. Challenge mutation and consumption must be atomic to prevent code replay under concurrent requests. Never log passwords, codes, or SMTP authentication details.

## Configuration and mail delivery

Add optional environment variables:

| Variable | Purpose |
| --- | --- |
| `SMTP_SYSTEM_USER` | SMTP username used only for management verification messages |
| `SMTP_SYSTEM_PASSWORD` | SMTP password used only for management verification messages |
| `SMTP_SYSTEM_FROM` | Explicit From address for verification messages |

These settings use the existing SMTP host, port, TLS mode, and certificate verification. A verification message has a clear subject and includes the six-digit code and expiry. Do not expose the system credentials to MCP tool calls or use them for user `send_email` messages.

## Components

- `src/config.ts` parses the optional system-mail settings and exposes a single capability/config object for verification mail.
- `src/smtp/` adds a dedicated verification-mail sender using Nodemailer and system credentials, separate from normal mailbox sending.
- `src/web/routes.ts` handles the two login methods, challenge creation/verification, and generic failure responses, reusing CSRF and rate limiting.
- `src/web/views/login.ejs` presents the method choice and code-entry step, with clear unavailable-state copy when email login is not configured.
- `src/storage/` adds a migration and repository operations for pending challenges, including atomic attempts, replacement, consumption, and cleanup.
- `.env.example` and `README.md` document the new settings, optional behavior, and login steps.

## Failure behavior and security

If IMAP verification fails, no challenge or account change is created. If SMTP delivery fails, the challenge is invalidated, no account/session is created, and the UI shows a generic retry message. A retry must start with fresh IMAP verification. Code mismatch, expiry, and exhausted attempts produce a generic invalid/expired code message. Rate limits apply to initiating and verifying email login, using both IP and normalized account identity where appropriate.

Use secure, HTTP-only, SameSite cookies as today, no-store headers for login responses, CSRF protection on every state-changing form, constant-time digest comparison where applicable, and opaque random challenge IDs. Do not put codes or passwords in URLs. The management-token path remains separately rate-limited and keeps using the configured token list.

## Acceptance criteria

- With SMTP system-mail settings configured, a user with valid IMAP credentials can request and verify a code, then manage only their own account’s user tokens and permissions.
- Invalid IMAP credentials do not send email or create/update account credentials.
- A code cannot be reused; expires after ten minutes; verification stops after five wrong attempts; requesting a replacement invalidates its predecessor.
- SMTP delivery failure creates no usable session and does not leave a usable challenge.
- Without complete system-mail configuration, management-token login continues to work and the MCP service still supports IMAP-only operation.
- With system-mail settings configured, verification mail uses the system SMTP identity and `SMTP_SYSTEM_FROM`, while regular `send_email` keeps using the mailbox identity and existing Sent archival behavior.
- Configuration and login instructions are documented in `.env.example` and `README.md`.

## Out of scope

OAuth, passwordless mailbox access, email address discovery, changing MCP bearer-token authentication, changing per-tool permissions, changing normal SMTP sending, and adding a separate mail transport are out of scope.
