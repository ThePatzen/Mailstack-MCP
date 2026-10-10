# Access-token management surface

Scope: `/manage/tokens` web administration surface. Mode: Operate.

Audience: A mailbox owner managing MCP access for their own IMAP account. Task: create a user token, understand its tool grants and recent use, change individual grants, or revoke it. Show the mailbox identity and connection state as context. SMTP permission appears only when SMTP is configured. The full token appears only at creation and must be copied then. No server-wide account administration belongs here.

## Direction contract

THESIS: The mailbox owner manages personal MCP access from one clear token screen, not a generic API-key dashboard.

OWN-WORLD: Follow the user-selected light SaaS admin reference: quiet cool-gray page ground, white surfaces, navy text, blue primary action and permission switches, subtle borders, compact left rail, and familiar workhorse sans typography. Keep the information hierarchy calm and readable; no fake brand or unrelated admin navigation.

STORY: The owner sees the connected mailbox, identifies each token by label and recent use, expands one, checks its tool grants, changes a permission, or revokes it. New credentials are shown once with a copy action.

FIRST VIEWPORT: Left rail contains Mailstack MCP, the connected mailbox, Access tokens, and Sign out only. Main heading and brief helper line sit above the token list; Create token stays at upper right. Show two token rows with label, created, last-used, status, and revoke action. Expand one token to show individually switchable tool permissions. The right-side one-time-token card appears only after token creation.

FORM: User-selected reference image `/home/eggerd/.codex/desktop-wsl/generated_images/01a120d9-4b83-7e43-aff5-f0d4ae7152b9/exec-0f30e9d3-6d4b-4b14-99a9-3c0d05b16380.png`, adapted as `.impeccable/mocks/comp-token-management.png`. This direct user direction supersedes seed `3052bcba` and the earlier switchboard concept.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
