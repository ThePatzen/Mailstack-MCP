# MCP OAuth authentication design

## Goal

Allow ChatGPT and Codex to connect to an instance's MCP endpoint using OAuth instead of asking users to copy a long-lived MCP bearer token into client configuration. OAuth authentication is an additional authentication method; existing user-token clients continue to work.

The existing Mailstack login proves which mailbox account the user controls. A selected Mailstack User-Token determines which tools that OAuth connection may use. Mailstack does not create a new independent permission set during OAuth authorization.

## User flow

1. ChatGPT or Codex discovers OAuth support from the MCP protected-resource metadata and starts Authorization Code with PKCE (`S256`).
2. Mailstack validates the request, including the registered client, exact redirect URI, state, resource identifier, and PKCE challenge. It creates a short-lived authorization transaction and redirects to the existing Mailstack sign-in page.
3. The user signs in through an existing Mailstack login method, which verifies the IMAP credentials and any configured email-code challenge. The successful login resolves to an internal `accountId`; the account ID comes from the server-side login result, never from OAuth request parameters.
4. Mailstack presents the active User-Tokens for that account, including their labels and the functions each enables that the client requested. The user selects one token and confirms authorization for the requesting client; there is no second function selection. If no active token exists, the page directs the user to create one in the management interface; OAuth must not silently create a token or broaden permissions.
5. Mailstack binds the pending OAuth transaction to the authenticated account and selected token ID, then redirects to the exact pre-registered client callback with a one-time authorization code and the original state.
6. The client exchanges the code and its PKCE verifier at the token endpoint. Mailstack validates and consumes the code atomically, then returns a one-hour opaque access token and, if the registered client requested the refresh-token grant, a refresh token. No mailbox password or raw User-Token is returned to the client.
7. When the access token expires, a client registered for refresh tokens exchanges its refresh token at the token endpoint. Mailstack atomically consumes that token and rotates it, returning a new access token and refresh token without another browser login.
8. The client sends the OAuth access token as a Bearer token to `/mcp`. On every request, Mailstack resolves it to its linked User-Token and account, checks expiry and revocation, and loads the User-Token's current tool permissions. Existing tool-level authorization checks remain in place.

## Permission and revocation model

OAuth grants reference a `token_id` owned by the account established by IMAP login. They do not copy permission rows and do not authorize directly by username. OAuth scopes map to individual MCP tool permissions (for example, `mailstack:list_mailboxes`). The grant stores the client's requested scopes as its ceiling. At runtime, effective tools are the intersection of that ceiling and the referenced token's current permissions. There is no separate function approval: disabling a token permission removes it from existing OAuth connections, and enabling one makes it available automatically when it is within the client's scope ceiling.

Revoking or deleting the selected User-Token immediately invalidates all OAuth grants that reference it. Changing its tool permissions takes effect on the next MCP request. A distinct OAuth grant revoke action revokes only that grant. The existing shared tool execution guard continues to enforce each permission even if a tool was already advertised to the MCP client.

OAuth access and refresh tokens are opaque random values stored only as cryptographic hashes. Access tokens live for one hour. A grant has a fixed maximum lifetime of 30 days from initial authorization; refreshes do not extend it. Refresh tokens are single-use and rotate atomically. Reuse of a consumed refresh token from the matching registered client and resource revokes the associated grant to stop a replayed token family without allowing an unrelated client to revoke it. Authorization codes are random, short-lived, single-use, stored as hashes, and bound to client ID, exact redirect URI, resource, PKCE challenge, account ID, and selected token ID.

## OAuth endpoints and discovery

The service publishes public discovery documents for:

- MCP protected resource metadata, identifying the canonical public MCP resource and this instance as its authorization server.
- OAuth authorization server metadata, advertising the authorization and token endpoints, Authorization Code and Refresh Token grants, `S256` PKCE, public token endpoint authentication (`none`), supported scopes, and issuer identifier.
- A dynamic client registration endpoint, to allow ChatGPT and Codex to register public clients without a client secret. Authorization Code is required; clients may also register for Refresh Token. The implementation validates callback URIs and only permits HTTPS callbacks, with narrowly defined loopback HTTP exceptions if required for local clients.

MCP tool metadata declares OAuth security requirements per tool, with each tool mapped to its corresponding `mailstack:<tool_name>` scope. Discovery lists the supported tool scopes. OAuth authorization validates requested scopes, displays the selected token's currently effective functions on the consent page, and records the client's requested scopes as the grant ceiling.

The authorization and token requests carry the resource identifier. Mailstack requires it to match the canonical MCP resource and binds it to the authorization code and issued access token. The MCP middleware accepts the token only at the matching resource. Authorization responses include the issuer identifier so clients can detect authorization-server mix-ups. At code exchange and refresh, the returned OAuth scopes reflect the selected token's current permissions within the saved scope ceiling.

Public metadata and registration endpoints do not disclose mailbox accounts, User-Tokens, grants, or secrets. OAuth endpoints require HTTPS at the public reverse proxy. The canonical public URL is derived using the same validated forwarded-host/protocol policy as other externally visible service URLs.

## Persistence and lifecycle

Versioned SQLite migrations add focused tables for OAuth clients, authorization transactions/codes, grants, access tokens, and refresh tokens. Store only hashes of authorization codes and both token types. Client registrations retain their declared grant types; existing registrations migrate as authorization-code-only clients. Refresh-token records retain consumed hashes until their grant expires so replay can be detected. Each grant stores its account ID, referenced User-Token ID, OAuth client ID, resource, current granted scopes, client-requested scope ceiling, creation time, fixed expiration time, and revocation time. Existing grants migrate to the supported tool scope ceiling and continue to follow their linked token's permissions. Expired one-time transactions, codes, and refresh-token records are removed opportunistically or by bounded cleanup during OAuth operations.

Foreign keys cascade when an account or User-Token is deleted. The repository layer owns atomic code consumption, PKCE verification inputs, refresh-token rotation and replay handling, ownership checks, expiry, and revocation; routes do not issue SQL directly.

## MCP authentication integration

The Bearer middleware recognizes either the existing fixed-format User-Token or an OAuth access token. It resolves either form to the same `McpPrincipal` shape. For a direct User-Token, current behavior is preserved. For an OAuth token, resolution verifies the access-token hash and expiry, joins the active grant and active referenced User-Token, and loads current permissions intersected with granted OAuth scopes. Invalid, expired, revoked, wrong-resource, or deleted-parent credentials receive `401` and a `WWW-Authenticate` challenge pointing to protected-resource metadata.

The management static token remains separate and never authenticates MCP requests. MCP tools continue to receive only the verified account principal, not caller-supplied identity or raw credential values.

## UI and operations

The existing login page is reused for OAuth sign-in, with a return to the pending authorization transaction after successful login. The consent screen identifies the client and lists selectable active User-Tokens with their enabled tools. It must not show raw token values. Users can decline and return to the client with an OAuth access-denied response.

The token-management page shows OAuth grants associated with each User-Token and allows users to revoke individual grants. Active grants display the linked token's current effective functions. Existing token revocation remains the simple way to revoke every OAuth connection that depends on that User-Token. Documentation explains OAuth connection setup for ChatGPT and Codex alongside the still-available direct-token setup during migration.

## Error handling and security requirements

- Validate exact redirect URI equality against a registered client; never redirect to a request-provided URI that is not registered.
- Require and validate `state`; require PKCE `S256`; consume authorization codes once in a database transaction.
- Enforce short expirations and one-time use for authorization transactions/codes, one-hour access tokens, a fixed 30-day grant lifetime, and atomic refresh-token rotation; never log codes, access tokens, refresh tokens, IMAP passwords, or complete User-Tokens.
- Bind the account and selected User-Token from the authenticated server-side session, and verify ownership again when creating the grant.
- Use generic login errors and existing login throttling. Add rate limits to registration, authorization, and token endpoints without trusting forwarded client IP values beyond the configured proxy hop.
- Reject malformed, expired, revoked, wrong-audience, and insufficiently authorized tokens. Return standards-compatible OAuth errors at OAuth endpoints and `401` plus discovery challenge at the MCP boundary.
- Preserve current TLS certificate verification for IMAP and SMTP.

## Scope exclusions

- No external identity provider and no separate Mailstack username/password database.
- No automatic creation of User-Tokens or implicit grant of all mailbox tools.
- No removal of direct User-Token authentication in the first release.
- No OAuth authorization through the management static token alone; the user must complete the existing mailbox login.

## Compatibility basis

The OAuth discovery, resource binding, public-client registration, Authorization Code with PKCE, issuer identification, and Bearer challenge follow the current OpenAI MCP authentication guidance for ChatGPT and Codex: <https://developers.openai.com/plugins/build/auth>. The design uses Dynamic Client Registration rather than fetching arbitrary client metadata documents, avoiding server-side retrieval of user-controlled URLs.
