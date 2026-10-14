---
name: mcp-tools
description: Use when adding or changing Mailstack MCP tools, their Zod input or output schemas, per-token permissions, or MCP request handling.
---

# Mailstack MCP tool workflow

## When to use

Use this skill when changing an MCP tool, how it is exposed to a token, the request identity passed to tools, or the shape of tool results. For changes that also cross into mail protocols, storage, or deployment, read `$repository-workflow` as well.

## Request and authorization path

1. `src/http/mcp-auth.ts` validates the Bearer user token through `findUserToken` and attaches the resulting account principal to the request's MCP auth context. The static management token is not used for MCP requests.
2. `src/main.ts` builds a server for that principal. `src/mcp/server.ts` delegates registration to `src/mcp/tools/`; SMTP sending is registered only when SMTP is configured.
3. Each registration checks `principal.enabledTools`, so unauthorized tools are not advertised. Each handler must still call `toolCall` from `src/mcp/tools/shared.ts`, which checks the permission again before running the action.
4. Pass `principal.accountId` to storage or protocol operations. Never accept an account ID from tool input or share mailbox state across principals.

## Adding or changing a tool

- Add it to the relevant `src/mcp/tools/` module, following nearby naming and registration patterns.
- Define a Zod input schema that matches the underlying operation's limits. Use `.strict()` where unknown fields should be rejected; preserve established behavior where schemas intentionally accept or strip them.
- Define the output schema and an accurate tool description. Set annotations to reflect whether the operation reads data, changes state, or permanently deletes data.
- Gate registration on the exact permission name, then route execution through `toolCall(principal, permissionName, action)` so permission is enforced again at invocation.
- Keep results scoped to the authenticated account. Return bounded, useful data; do not log credentials, tokens, one-time codes, or full message bodies.
- Preserve partial-success semantics. In particular, if SMTP accepted a message but Sent archival failed, report the partial success and do not retry delivery automatically.
- Add short, plain-language comments where they explain an authorization boundary, request-scoped identity, conditional registration, or partial-failure behavior. Explain why the rule matters; do not narrate obvious code.

## Verification

Check `package.json` for current commands. It currently provides `npm run typecheck` and no test script. Do not describe an absent test suite as run or passing.
