import { createHash } from 'node:crypto';
import { Router, urlencoded, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { encryptSecret } from '../security/crypto.js';
import { createOrUpdateAccount, createUserToken, deleteToken, findSession, getAccountCredentials, listTokens, revokeToken, setToolPermission } from '../storage/repository.js';
import { createMailstackPluginArchive } from './plugin-package.js';
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
const COOKIE_OPTIONS = { path: '/manage', httpOnly: true, secure: true, sameSite: 'lax' as const };

function safeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function setNoStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function accountKey(req: Request): string {
  const username = safeText(req.body?.username, 1024).toLocaleLowerCase('en-US');
  return createHash('sha256').update(username || `missing:${ipKeyGenerator(req.ip ?? 'unknown')}`).digest('hex');
}

function renderLogin(res: Response, options: { error: string; username: string }): void {
  const csrf = createLoginCsrfToken();
  res.cookie(LOGIN_CSRF_COOKIE, csrf, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });
  setNoStore(res);
  res.status(options.error ? 401 : 200).render('login', { ...options, csrf });
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const part = header.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`));
  if (!part) return undefined;
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return undefined; }
}

function issueCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, { ...COOKIE_OPTIONS, maxAge: SESSION_TTL_MS });
}

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

function renderTokens(req: Request, res: Response, deps: WebDependencies, options: { notice?: string; oneTimeToken?: string; labelValue?: string; status?: number; openPermissionsTokenId?: string } = {}): void {
  const accountId = (req as ManagementRequest).management?.accountId;
  if (!accountId) {
    res.redirect('/manage');
    return;
  }
  const username = getAccountCredentials(accountId)?.username ?? (req as ManagementRequest).accountUsername ?? '';
  const summaries = listTokens(accountId);
  setNoStore(res);
  res.status(options.status ?? 200).render('tokens', {
    username: username ?? '',
    tokens: summaries,
    toolNames: TOOL_NAMES.filter((tool) => tool !== 'send_email' || deps.smtpConfigured),
    toolLabels: TOOL_LABELS,
    csrf: csrfToken((req as ManagementRequest).management!.sessionId, deps.encryptionKey),
    notice: options.notice ?? '',
    oneTimeToken: options.oneTimeToken ?? '',
    labelValue: options.labelValue ?? '',
    mcpUrl: publicMcpUrl(req) ?? '',
    openPermissionsTokenId: options.openPermissionsTokenId ?? '',
  });
}

export function createManagementRouter(deps: WebDependencies): Router {
  const router = Router();
  router.use('/manage', urlencoded({ extended: false, limit: '16kb' }));
  const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: 'Too many sign-in attempts. Please wait and try again.' });
  const accountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
    keyGenerator: accountKey,
    message: 'Too many sign-in attempts for this account. Please wait and try again.',
  });
  const loggedIn = requireManagementSession;
  const csrf = requireCsrf(deps.encryptionKey);

  router.get('/manage', (req, res) => {
    const cookie = readCookie(req, SESSION_COOKIE);
    if (typeof cookie === 'string') {
      const request = req as ManagementRequest;
      const session = findSession(cookie);
      if (session) {
        request.management = { accountId: session.accountId, sessionId: cookie };
        res.redirect('/manage/tokens');
        return;
      }
    }
    renderLogin(res, { error: '', username: '' });
  });

  router.post('/manage/login', ipLimiter, accountLimiter, async (req, res) => {
    const username = safeText(req.body?.username, 1024);
    if (!verifyLoginCsrfToken(readCookie(req, LOGIN_CSRF_COOKIE), req.body?._csrf)) {
      renderLogin(res, { error: 'Die Anmeldung ist abgelaufen. Bitte versuchen Sie es erneut.', username });
      return;
    }
    res.clearCookie(LOGIN_CSRF_COOKIE, COOKIE_OPTIONS);
    const staticToken = typeof req.body?.staticToken === 'string' ? req.body.staticToken : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyStaticToken(staticToken, deps.staticTokens)) {
      renderLogin(res, { error: 'Die Anmeldung ist fehlgeschlagen. Bitte prüfen Sie Ihre Angaben.', username });
      return;
    }
    try {
      await verifyImapLogin(username, password, deps.imap);
      const account = createOrUpdateAccount(username, encryptSecret(password, deps.encryptionKey));
      const sessionId = createManagementSession(account.id);
      issueCookie(res, sessionId);
      res.redirect(303, '/manage/tokens');
    } catch {
      renderLogin(res, { error: 'Die Anmeldung ist fehlgeschlagen. Bitte prüfen Sie Ihre Angaben.', username });
    }
  });

  router.get('/manage/tokens', loggedIn, (req, res) => {
    const managementReq = req as ManagementRequest;
    const account = getAccountCredentials(managementReq.management!.accountId);
    if (!account) {
      destroyManagementSession(managementReq.management!.sessionId);
      res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS).redirect('/manage');
      return;
    }
    managementReq.accountUsername = account.username;
    const queryNotice = req.query.notice === 'revoked' ? 'Token widerrufen.' : req.query.notice === 'deleted' ? 'Token dauerhaft gelöscht.' : req.query.notice === 'unchanged' ? 'Token war bereits widerrufen oder wurde nicht gefunden.' : '';
    renderTokens(req, res, deps, {
      notice: queryNotice,
      openPermissionsTokenId: safeText(req.query.openPermissions, 64),
    });
  });

  router.get('/manage/plugin.zip', loggedIn, (req, res) => {
    const mcpUrl = publicMcpUrl(req);
    if (!mcpUrl) {
      res.status(400).send('Das Plugin kann nur über die öffentliche HTTPS-Adresse heruntergeladen werden.');
      return;
    }
    const archive = createMailstackPluginArchive(mcpUrl);
    setNoStore(res);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="mailstack-mcp-plugin.zip"');
    res.send(archive);
  });

  router.post('/manage/tokens', loggedIn, csrf, (req, res) => {
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

  router.post('/manage/tokens/:tokenId/revoke', loggedIn, csrf, (req, res) => {
    const management = (req as ManagementRequest).management!;
    const revoked = revokeToken(management.accountId, safeText(req.params.tokenId, 64));
    res.redirect(303, `/manage/tokens?notice=${revoked ? 'revoked' : 'unchanged'}`);
  });

  router.post('/manage/tokens/:tokenId/delete', loggedIn, csrf, (req, res) => {
    const management = (req as ManagementRequest).management!;
    const deleted = deleteToken(management.accountId, safeText(req.params.tokenId, 64));
    res.redirect(303, `/manage/tokens?notice=${deleted ? 'deleted' : 'unchanged'}`);
  });

  router.post('/manage/tokens/:tokenId/permissions/:tool', loggedIn, csrf, (req, res) => {
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
      res.redirect(303, `/manage/tokens?openPermissions=${encodeURIComponent(tokenId)}`);
    } catch {
      res.status(404).send('Token nicht gefunden.');
    }
  });

  router.post('/manage/logout', loggedIn, csrf, (req, res) => {
    const sessionId = (req as ManagementRequest).management!.sessionId;
    destroyManagementSession(sessionId);
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS).redirect(303, '/manage');
  });

  return router;
}
