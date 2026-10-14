import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router, urlencoded, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { encryptSecret } from '../security/crypto.js';
import { sendManagementLoginCode } from '../smtp/system-mail.js';
import { consumeEmailLoginChallenge, createEmailLoginChallenge, invalidateEmailLoginChallenge, createOrUpdateAccount, createUserToken, deleteToken, findSession, getAccountCredentials, listTokens, revokeToken, setToolPermission } from '../storage/repository.js';
import { createMailstackPluginArchive, pluginPackageName } from './plugin-package.js';
import { verifyImapLogin, verifyStaticToken } from './auth.js';
import type { WebDependencies } from './app.js';
import { createLoginCsrfToken, csrfToken, LOGIN_CSRF_COOKIE, requireCsrf, verifyLoginCsrfToken } from './csrf.js';
import { destroyManagementSession, ManagementRequest, requireManagementSession, SESSION_COOKIE, SESSION_TTL_MS, createManagementSession } from './sessions.js';

const TOOL_NAMES = [
  'list_mailboxes', 'create_mailbox', 'rename_mailbox', 'delete_mailbox',
  'list_messages', 'search_messages', 'read_message', 'get_attachment',
  'set_message_flags', 'copy_message', 'move_message', 'delete_message', 'expunge_messages',
  'send_email',
] as const;
const TOOL_LABELS: Record<(typeof TOOL_NAMES)[number], string> = {
  list_mailboxes: 'List mailboxes', create_mailbox: 'Create mailbox', rename_mailbox: 'Rename mailbox', delete_mailbox: 'Delete mailbox',
  list_messages: 'List messages', search_messages: 'Search messages', read_message: 'Read messages', get_attachment: 'Get attachments',
  set_message_flags: 'Change message flags', copy_message: 'Copy messages', move_message: 'Move messages', delete_message: 'Delete messages',
  expunge_messages: 'Permanently remove deleted messages', send_email: 'Send email',
};
const COOKIE_OPTIONS = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const };

/** Trims user-facing text and caps its length before it reaches persistence or rendering. */
function safeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** Prevents browsers and intermediaries from caching pages that contain account data. */
function setNoStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

type LoginMethod = 'email' | 'token';
interface LoginOptions {
  error: string;
  username: string;
  method?: LoginMethod;
  challengeId?: string;
}

const LOGIN_FAILED = 'Die Anmeldung ist fehlgeschlagen. Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut.';
const CODE_FAILED = 'Der Code ist ungültig oder abgelaufen. Versuchen Sie es erneut oder fordern Sie einen neuen Code an.';

/** Accepts only bounded strings without header or parser control characters. */
function boundedInput(value: unknown, max: number): string {
  return typeof value === 'string' && value.length <= max && !/[\r\n\0]/.test(value) ? value : '';
}

/** Binds an email-login CSRF token to its challenge, account, and random nonce. */
function emailLoginCsrf(challengeId: string, username: string, key: Buffer, nonce: string): string {
  const digest = createHmac('sha256', key)
    .update('mailstack-email-login-csrf:')
    .update(JSON.stringify([nonce, challengeId, username]))
    .digest('base64url');
  return `${nonce}.${digest}`;
}

/** Validates the signed account and challenge context before code verification. */
function validEmailLoginContext(req: Request, key: Buffer): boolean {
  const token = req.body?._csrf;
  const challengeId = boundedInput(req.body?.challengeId, 43);
  const username = boundedInput(req.body?.username, 1024);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token) ||
      !/^[A-Za-z0-9_-]{43}$/.test(challengeId) || !username) return false;
  const expected = emailLoginCsrf(challengeId, username, key, token.slice(0, 43));
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** Builds a privacy-preserving rate-limit key for the account targeted by a login request. */
function accountKey(req: Request, encryptionKey: Buffer): string {
  // The code step's account key is bound to the challenge, so changing the hidden username cannot evade its limiter.
  const isCodeVerification = req.path === '/login/verify-code';
  const username = !isCodeVerification || validEmailLoginContext(req, encryptionKey)
    ? safeText(req.body?.username, 1024).toLocaleLowerCase('en-US') : '';
  return createHash('sha256').update(username || `missing:${ipKeyGenerator(req.ip ?? 'unknown')}`).digest('hex');
}

/** Renders a fresh login form and issues the CSRF state required by its selected method. */
function renderLogin(res: Response, deps: WebDependencies, options: LoginOptions): void {
  const emailAvailable = Boolean(deps.smtp && deps.systemMail);
  const method = emailAvailable && options.method !== 'token' ? 'email' : 'token';
  const challengeId = method === 'email' ? options.challengeId ?? '' : '';
  const accountUsername = options.username.toLocaleLowerCase('en-US');
  const nonce = createLoginCsrfToken();
  const csrf = challengeId ? emailLoginCsrf(challengeId, accountUsername, deps.encryptionKey, nonce) : nonce;
  res.cookie(LOGIN_CSRF_COOKIE, csrf, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });
  setNoStore(res);
  res.status(options.error ? 401 : 200).render('login', {
    ...options, appTitle: deps.appTitle, appLogoUrl: deps.appLogoPath ? '/brand/logo' : '', emailAvailable, method, challengeId, accountUsername, csrf,
  });
}

/** Reads and decodes one named cookie without trusting malformed percent escapes. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const part = header.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`));
  if (!part) return undefined;
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return undefined; }
}

/** Issues the management session as an HTTP-only cookie available to the root-mounted UI. */
function issueCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, { ...COOKIE_OPTIONS, maxAge: SESSION_TTL_MS });
}

/** Builds the public MCP URL only from a valid HTTPS request host. */
function publicMcpUrl(req: Request): string | undefined {
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host');
  if (!host || req.protocol !== 'https' || /[\s/@\\?#]/.test(host)) return undefined;
  try {
    const base = new URL(`${req.protocol}://${host}`);
    if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) return undefined;
    return new URL('/mcp', base).toString();
  } catch {
    return undefined;
  }
}

/** Renders token management data scoped to the authenticated management account. */
function renderTokens(req: Request, res: Response, deps: WebDependencies, options: { notice?: string; oneTimeToken?: string; labelValue?: string; status?: number; openPermissionsTokenId?: string } = {}): void {
  const accountId = (req as ManagementRequest).management?.accountId;
  if (!accountId) {
    res.redirect('/');
    return;
  }
  const username = getAccountCredentials(accountId)?.username ?? (req as ManagementRequest).accountUsername ?? '';
  const summaries = listTokens(accountId);
  setNoStore(res);
  res.status(options.status ?? 200).render('tokens', {
    username: username ?? '',
    appTitle: deps.appTitle,
    appLogoUrl: deps.appLogoPath ? '/brand/logo' : '',
    tokens: summaries,
    toolNames: TOOL_NAMES.filter((tool) => tool !== 'send_email' || deps.smtpConfigured),
    toolLabels: TOOL_LABELS,
    csrf: csrfToken((req as ManagementRequest).management!.sessionId, deps.encryptionKey),
    notice: options.notice ?? '',
    oneTimeToken: options.oneTimeToken ?? '',
    labelValue: options.labelValue ?? '',
    mcpUrl: publicMcpUrl(req) ?? '',
    pluginName: deps.pluginName,
    openPermissionsTokenId: options.openPermissionsTokenId ?? '',
  });
}

/** Creates management routes with login throttling, session checks, and CSRF protection. */
export function createManagementRouter(deps: WebDependencies): Router {
  const router = Router();
  router.use((_req, res, next) => { setNoStore(res); next(); });
  router.use(urlencoded({ extended: false, limit: '16kb' }));
  const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: 'Too many sign-in attempts. Please wait and try again.' });
  const accountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => accountKey(req, deps.encryptionKey),
    message: 'Too many sign-in attempts for this account. Please wait and try again.',
  });
  const loggedIn = requireManagementSession;
  const csrf = requireCsrf(deps.encryptionKey);

  // Resume an existing session before showing a new login form.
  router.get('/', (req, res) => {
    const cookie = readCookie(req, SESSION_COOKIE);
    if (typeof cookie === 'string') {
      const request = req as ManagementRequest;
      const session = findSession(cookie);
      if (session) {
        request.management = { accountId: session.accountId, sessionId: cookie };
        res.redirect('/tokens');
        return;
      }
    }
    renderLogin(res, deps, { error: '', username: '', method: req.query.method === 'token' ? 'token' : 'email' });
  });

  // Authenticate with the operator token and mailbox password before creating an account session.
  router.post('/login', ipLimiter, accountLimiter, async (req, res) => {
    const username = safeText(req.body?.username, 1024);
    if (!verifyLoginCsrfToken(readCookie(req, LOGIN_CSRF_COOKIE), req.body?._csrf)) {
      renderLogin(res, deps, { error: 'Die Anmeldung ist abgelaufen. Bitte versuchen Sie es erneut.', username, method: 'token' });
      return;
    }
    res.clearCookie(LOGIN_CSRF_COOKIE, COOKIE_OPTIONS);
    const staticToken = typeof req.body?.staticToken === 'string' ? req.body.staticToken : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyStaticToken(staticToken, deps.staticTokens)) {
      renderLogin(res, deps, { error: LOGIN_FAILED, username, method: 'token' });
      return;
    }
    try {
      await verifyImapLogin(username, password, deps.imap);
      const account = createOrUpdateAccount(username, encryptSecret(password, deps.encryptionKey));
      const sessionId = createManagementSession(account.id);
      issueCookie(res, sessionId);
      res.redirect(303, '/tokens');
    } catch {
      renderLogin(res, deps, { error: LOGIN_FAILED, username, method: 'token' });
    }
  });

  // Verify mailbox credentials before issuing a short-lived, one-time email challenge.
  router.post('/login/code', ipLimiter, accountLimiter, async (req, res) => {
    const requestTime = Date.now();
    const username = boundedInput(req.body?.username, 320).trim();
    if (!verifyLoginCsrfToken(readCookie(req, LOGIN_CSRF_COOKIE), req.body?._csrf)) {
      renderLogin(res, deps, { error: 'Die Anmeldung ist abgelaufen. Bitte versuchen Sie es erneut.', username, method: 'email' });
      return;
    }
    res.clearCookie(LOGIN_CSRF_COOKIE, COOKIE_OPTIONS);
    if (!deps.smtp || !deps.systemMail) {
      renderLogin(res, deps, { error: 'Die Anmeldung per E-Mail-Code ist derzeit nicht verfügbar. Verwenden Sie ein Verwaltungstoken.', username, method: 'token' });
      return;
    }
    const password = boundedInput(req.body?.password, 4096);
    if (!username || !password || /[\s<>(),;]/.test(username) || !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(username)) {
      renderLogin(res, deps, { error: LOGIN_FAILED, username, method: 'email' });
      return;
    }
    let challengeId: string | undefined;
    try {
      await verifyImapLogin(username, password, deps.imap);
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = requestTime + 600_000;
      challengeId = createEmailLoginChallenge({
        username,
        encryptedPassword: encryptSecret(password, deps.encryptionKey),
        code,
        expiresAt,
        encryptionKey: deps.encryptionKey,
      });
      await sendManagementLoginCode({ smtp: deps.smtp, systemMail: deps.systemMail, appTitle: deps.appTitle }, username, code, expiresAt);
    } catch {
      if (challengeId) invalidateEmailLoginChallenge(challengeId, deps.encryptionKey);
      renderLogin(res, deps, { error: LOGIN_FAILED, username, method: 'email' });
      return;
    }
    renderLogin(res, deps, { error: '', username, method: 'email', challengeId });
  });

  // Consume the code atomically so concurrent submissions cannot reuse the same challenge.
  router.post('/login/verify-code', ipLimiter, accountLimiter, (req, res) => {
    const username = boundedInput(req.body?.username, 1024);
    const challengeId = boundedInput(req.body?.challengeId, 43);
    if (!deps.smtp || !deps.systemMail ||
        !verifyLoginCsrfToken(readCookie(req, LOGIN_CSRF_COOKIE), req.body?._csrf) ||
        !validEmailLoginContext(req, deps.encryptionKey)) {
      renderLogin(res, deps, { error: 'Die Anmeldung ist abgelaufen. Bitte fordern Sie einen neuen Code an.', username, method: 'email' });
      return;
    }
    res.clearCookie(LOGIN_CSRF_COOKIE, COOKIE_OPTIONS);
    try {
      const credentials = consumeEmailLoginChallenge({
        challengeId,
        code: boundedInput(req.body?.code, 6),
        now: Date.now(),
        encryptionKey: deps.encryptionKey,
      });
      if (!credentials) {
        renderLogin(res, deps, { error: CODE_FAILED, username, method: 'email', challengeId });
        return;
      }
      const account = createOrUpdateAccount(credentials.username, credentials.encryptedPassword);
      const sessionId = createManagementSession(account.id);
      issueCookie(res, sessionId);
      res.redirect(303, '/tokens');
    } catch {
      renderLogin(res, deps, { error: LOGIN_FAILED, username, method: 'email' });
    }
  });

  // Load token data only after session middleware has identified the account.
  router.get('/tokens', loggedIn, (req, res) => {
    const managementReq = req as ManagementRequest;
    const account = getAccountCredentials(managementReq.management!.accountId);
    if (!account) {
      destroyManagementSession(managementReq.management!.sessionId);
      res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS).redirect('/');
      return;
    }
    managementReq.accountUsername = account.username;
    const queryNotice = req.query.notice === 'revoked' ? 'Token widerrufen.' : req.query.notice === 'deleted' ? 'Token dauerhaft gelöscht.' : req.query.notice === 'unchanged' ? 'Token war bereits widerrufen oder wurde nicht gefunden.' : '';
    renderTokens(req, res, deps, {
      notice: queryNotice,
      openPermissionsTokenId: safeText(req.query.openPermissions, 64),
    });
  });

  // Generate connection settings for the public HTTPS endpoint without embedding credentials.
  router.get('/plugin.zip', loggedIn, (req, res) => {
    const mcpUrl = publicMcpUrl(req);
    if (!mcpUrl) {
      res.status(400).send('Das Plugin kann nur über die öffentliche HTTPS-Adresse heruntergeladen werden.');
      return;
    }
    const archive = createMailstackPluginArchive(mcpUrl, deps.pluginName);
    setNoStore(res);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${pluginPackageName(deps.pluginName)}.zip"`);
    res.send(archive);
  });

  // Create tokens for the active account and expose the secret only in this response.
  router.post('/tokens', loggedIn, csrf, (req, res) => {
    const management = (req as ManagementRequest).management!;
    const label = safeText(req.body?.label, 101);
    if (!label || label.length > 100) {
      (req as ManagementRequest).accountUsername = '';
      renderTokens(req, res, deps, { notice: 'Geben Sie einen Namen mit 1 bis 100 Zeichen ein.', labelValue: label, status: 400 });
      return;
    }
    try {
      const created = createUserToken(management.accountId, label);
      const account = getAccountCredentials(management.accountId);
      (req as ManagementRequest).accountUsername = account?.username;
      renderTokens(req, res, deps, { notice: 'Token erstellt. Kopieren Sie ihn jetzt; danach wird er nicht erneut angezeigt.', oneTimeToken: created.token });
    } catch {
      res.status(400).send('Token konnte nicht erstellt werden.');
    }
  });

  // Revoke a token within the current account and return a non-sensitive status notice.
  router.post('/tokens/:tokenId/revoke', loggedIn, csrf, (req, res) => {
    const management = (req as ManagementRequest).management!;
    const revoked = revokeToken(management.accountId, safeText(req.params.tokenId, 64));
    res.redirect(303, `/tokens?notice=${revoked ? 'revoked' : 'unchanged'}`);
  });

  // Delete only a revoked token belonging to the current account.
  router.post('/tokens/:tokenId/delete', loggedIn, csrf, (req, res) => {
    const management = (req as ManagementRequest).management!;
    const deleted = deleteToken(management.accountId, safeText(req.params.tokenId, 64));
    res.redirect(303, `/tokens?notice=${deleted ? 'deleted' : 'unchanged'}`);
  });

  // Change a known tool permission only when that tool is available in this deployment.
  router.post('/tokens/:tokenId/permissions/:tool', loggedIn, csrf, (req, res) => {
    const management = (req as ManagementRequest).management!;
    const tokenId = safeText(req.params.tokenId, 64);
    const tool = safeText(req.params.tool, 100);
    const allowedValue = req.body?.allowed;
    const allowed = allowedValue === 'true';
    if (!(TOOL_NAMES as readonly string[]).includes(tool) || (tool === 'send_email' && !deps.smtpConfigured) || !['true', 'false'].includes(allowedValue)) {
      res.status(400).send('Ungültige Berechtigung.');
      return;
    }
    try {
      setToolPermission(management.accountId, tokenId, tool, allowed);
      res.redirect(303, `/tokens?openPermissions=${encodeURIComponent(tokenId)}`);
    } catch {
      res.status(404).send('Token nicht gefunden.');
    }
  });

  // Destroy the persisted session before clearing the browser cookie.
  router.post('/logout', loggedIn, csrf, (req, res) => {
    const sessionId = (req as ManagementRequest).management!.sessionId;
    destroyManagementSession(sessionId);
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS).redirect(303, '/');
  });

  return router;
}
