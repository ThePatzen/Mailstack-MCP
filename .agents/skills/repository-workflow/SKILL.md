---
name: repository-workflow
description: Use when orienting in the Mailstack MCP repository or planning a change that crosses its MCP, mail, management, storage, or deployment areas.
---

# Mailstack MCP repository workflow

## When to use

Use this skill when a task needs repository orientation, touches more than one subsystem, or requires tracing behavior from an MCP request through authentication, storage, and a mail server. For a single-file change, use the relevant instructions in the root `AGENTS.md` and inspect the local implementation.

## Workflow

1. Read the root `AGENTS.md` and identify the code path for the requested behavior from its file index.
2. Read the relevant parts of `README.md` for user-facing configuration or operational effects. Check `PRODUCT.md` and `DESIGN.md` when behavior or UI conventions are involved.
3. Search `docs/superpowers/specs/` for an agreed design and `docs/superpowers/plans/` for related implementation history. Treat a plan as planned work until the implementation confirms it.
4. Trace the full path across boundaries. For an MCP operation, inspect its registration in `src/mcp/tools/`, the principal and authorization in `src/http/mcp-auth.ts` and storage repository, and the protocol operation in `src/imap/` or `src/smtp/`. For management changes, follow routes through session/CSRF helpers and persistence.
5. Keep changes within existing module boundaries. Preserve TLS verification, secret handling, account scoping, and per-tool authorization. When SMTP has accepted a message but Sent archival fails, retain the partial-success result and do not retry delivery automatically.
6. Update relevant user or operations documentation if a change affects configuration, externally visible behavior, or deployment.
7. Check commands in `package.json` before reporting verification. The current project provides `npm run typecheck`; it does not define a test script. Do not report tests as run unless a test command and suite have actually been established and executed.

## Follow-up skill areas

As recurring work justifies them, add focused skills for TypeScript/Node and MCP tools, IMAP/SMTP behavior, security and SQLite storage, and Docker/reverse-proxy operations. Keep repository maps and durable project rules in `AGENTS.md`; skills should add actionable methods rather than copy that index.
