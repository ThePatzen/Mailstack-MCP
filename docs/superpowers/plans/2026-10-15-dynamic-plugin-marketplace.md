# Dynamic Plugin Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users install a Mailstack plugin from their own Codex instance, connect the same MCP service in ChatGPT, keep a direct Codex configuration option, and expose the marketplace without authentication.

**Architecture:** Generate the plugin files and marketplace catalog from the request's validated HTTPS origin. Serve a bounded, temporary Git repository through Git Smart HTTP for Codex installation, expose the catalog as `/marketplace.json`, and keep `/plugin.zip` public for old links while removing it from the UI.

**Tech Stack:** Node.js 22, TypeScript, Express 5, Git Smart HTTP via `git http-backend`, Docker, EJS.

**Spec:** `docs/superpowers/specs/2026-10-15-dynamic-plugin-marketplace-design.md`

## Global Constraints

- `/marketplace.json`, `/marketplace.git/`, and `/plugin.zip` are public and contain no credentials.
- Marketplace repositories are read-only; reject pushes, unsupported Git services, and paths outside the fixed repository endpoint.
- Derive the MCP URL only from a valid HTTPS request origin and use its `/mcp` path.
- Do not expose Git process details or environment values in HTTP responses or logs.
- Preserve existing token authentication and per-tool authorization on `/mcp`.
- Keep `/plugin.zip` working without showing its download in the management UI.
- The repository has no test script; do not add a test framework. Use typecheck and focused runtime smoke checks.

## Review Focus

- Invalid or non-HTTPS forwarded host data must return 400 before generating artifacts.
- Git `receive-pack`, unsupported methods, and paths outside the fixed Git endpoint must not write or read arbitrary files.
- Concurrent requests for one origin must share repository initialization rather than expose a half-created repository.
- Requests for many distinct origins must not grow the temporary repository cache without bound.
- Existing plugin slugs, token prompts, and ZIP contents must retain their current behavior.

---

### Task 1: Expose reusable plugin and marketplace artifacts

**Files:**
- Modify: `src/web/plugin-package.ts`

**Interfaces:**
- Produces `createMailstackPluginFiles(mcpUrl: string, pluginName: string, options?: { includeMcpConfig?: boolean }): Array<{ name: string; data: Buffer }>` with paths rooted at the plugin directory; both the compatibility ZIP and marketplace package include `mcp.json` with bearer API-key authentication.
- Produces `pluginTokenEnvironmentName(pluginName: string)` as `MAILSTACK_MCP_<PLUGINNAME>_TOKEN`, where the normalized plugin slug is uppercase with underscores.
- Produces `createMailstackMarketplace(marketplaceGitUrl: string, pluginName: string)` with `{ name: pluginPackageName(pluginName), interface: { displayName: pluginName }, plugins: [{ name: pluginPackageName(pluginName), source: { source: 'url', url: marketplaceGitUrl }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }`.
- Preserves `createMailstackPluginArchive(mcpUrl: string, pluginName: string): Buffer` and `pluginPackageName(pluginName: string): string` as the existing public interfaces.

- [x] Extract root-level plugin files from `createMailstackPluginArchive` into `createMailstackPluginFiles`; keep their contents and token guidance unchanged.
- [x] Implement `createMailstackMarketplace` with top-level marketplace name and display name derived from the plugin slug/name, and a Git `url` source pointing to `marketplaceGitUrl`.
- [x] Rebuild the ZIP from `createMailstackPluginFiles`, prefixing each path with the existing package slug so the current archive layout remains unchanged.
- [x] Run the local TypeScript compiler and inspect the generated catalog and archive entry paths using a small Node/tsx invocation; do not add a test framework.

### Task 2: Serve a bounded read-only Git repository and public catalog

**Files:**
- Create: `src/web/marketplace-git.ts`
- Modify: `src/web/routes.ts`
- Modify: `Dockerfile`

**Interfaces:**
- `serveMarketplaceGit(req: Request, res: Response, mcpUrl: string, pluginName: string): Promise<void>` serves the fixed Git Smart HTTP endpoint for the instance origin.
- `getMarketplaceRepository(origin: string, mcpUrl: string, pluginName: string): Promise<string>` returns a ready bare repository path, sharing concurrent initialization and enforcing a bounded cache of four origins with least-recently-used eviction of idle entries. If all entries are active, reject a new origin with 503 rather than evicting an in-use repository.
- `releaseMarketplaceRepository(origin: string): void` releases the in-flight request lease so an idle repository can be evicted.
- The Git backend accepts upload-pack reads only. Configure each generated repository with `http.uploadpack=true` and `http.receivepack=false`.

- [x] Generate a bare repository at a restricted system temporary directory from the root-level plugin file set and a matching `.agents/plugins/marketplace.json`.
- [x] Initialize repositories with fixed `git` argument arrays and `shell: false`; invoke `git http-backend` with only the required CGI values and the fixed repository root.
- [x] Pass the Git upload-pack request body to the child process, forward its CGI status/headers/body, and return a generic 500 on process errors without including stderr or environment data.
- [x] Reject unsupported methods, Git services other than `git-upload-pack`, and malformed/out-of-scope paths before invoking Git.
- [x] Add a public `GET /marketplace.json` route that validates the HTTPS origin, returns the one-plugin catalog as JSON, and prevents caching across instance origins.
- [x] Add a public Git route for `/marketplace.git` and its Git Smart HTTP subpaths; use the same validated origin for the generated MCP URL and Git source URL.
- [x] Remove `loggedIn` from `/plugin.zip` while preserving its HTTPS validation, archive content, and download headers.
- [x] Install Git in the final Docker image so `git http-backend` is available to the non-root Node process.
- [x] Run local TypeScript checking and focused artifact/clone checks. Docker image build and HTTP listener checks remain unavailable in this sandbox.

### Task 3: Replace ZIP instructions with ChatGPT and Codex setup paths

**Files:**
- Modify: `src/web/views/tokens.ejs`
- Modify: `src/web/public/app.css` (only if needed for the existing responsive setup layout)
- Modify: `README.md`

**Interfaces:**
- The token view continues to receive `mcpUrl` and `pluginName` from `renderTokens`.
- The marketplace link is the absolute same-origin URL `/marketplace.json`; the Codex command uses the same origin with `/marketplace.git`.

- [x] Replace the ZIP download/install steps with ChatGPT custom MCP setup, direct Codex configuration, and Codex Marketplace installation.
- [x] Show the Codex MCP TOML shape with the dynamic endpoint and plugin-name-derived token variable; explain setting the user token in Codex's environment without placing the token in generated configuration.
- [x] Link `/marketplace.json` for direct viewing and provide `codex plugin marketplace add https://<instance>/marketplace.git`, then explain opening `/plugins` and installing the listed Mailstack plugin.
- [x] Explain that the Marketplace package contains the instance URL and bearer-auth configuration without a token, and requests the User-Token during installation; also document ChatGPT's direct custom MCP setup.
- [x] Remove ZIP-specific UI copy and update README instructions for the public catalog/Git endpoints, direct setup option, public `/plugin.zip` compatibility, and reverse-proxy forwarding without additional authentication.
- [x] Render the EJS view with representative instance data, check its two setup options and responsive two-column CSS, and run local TypeScript checking.

### Task 4: End-to-end operational review

**Files:**
- Review: `src/web/marketplace-git.ts`
- Review: `src/web/routes.ts`
- Review: `src/web/plugin-package.ts`
- Review: `Dockerfile`
- Review: `src/web/views/tokens.ejs`
- Review: `README.md`

**Interfaces:**
- Consumes the public routes and artifact generators from Tasks 1–3.

- [ ] Confirm anonymous requests to `/marketplace.json` return valid JSON whose source URL matches the request origin.
- [x] Confirm generated repository can be cloned and contains the generated MCP URL and matching marketplace source URL.
- [ ] Confirm `git push` and unsupported HTTP methods fail without modifying the repository.
- [x] Confirm `/plugin.zip` remains anonymously downloadable in route code and the rendered token page no longer contains a ZIP download link.
- [ ] Confirm malformed/non-HTTPS forwarded host values return 400 and that responses do not disclose Git diagnostics.
- [x] Run local TypeScript checking and `git diff --check`; Docker/runtime HTTP route checks cannot be performed in the available environment.
