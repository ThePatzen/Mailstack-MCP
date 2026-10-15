import { Router, json, urlencoded, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  bindOAuthAuthorizationRequest,
  findOAuthClient,
  findSession as findManagementSession,
} from '../storage/repository.js';
import { SESSION_COOKIE } from '../web/sessions.js';
import { createOAuthHandoffValue, OAUTH_HANDOFF_COOKIE } from './handoff.js';
import { beginAuthorization, exchangeAuthorizationCode } from './service.js';
import {
  OAUTH_ACCESS_TOKEN_TTL_MS,
  OAUTH_AUTHORIZATION_ENDPOINT,
  OAUTH_REGISTRATION_ENDPOINT,
  OAUTH_TOKEN_ENDPOINT,
  OAuthProtocolError,
  registerPublicClient,
  supportedOAuthScopes,
} from './protocol.js';
import { protectedResourceMetadataUrl, publicOrigin } from './resource.js';

const COOKIE_OPTIONS = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const };
const LOGGABLE_GRANT_TYPES = new Set([
  'authorization_code', 'refresh_token', 'client_credentials', 'password', 'implicit',
  'urn:ietf:params:oauth:grant-type:device_code',
  'urn:ietf:params:oauth:grant-type:jwt-bearer',
  'urn:ietf:params:oauth:grant-type:token-exchange',
]);

type GrantTypesSummary = 'omitted' | 'not_an_array' | { values: string[]; truncated: boolean };

export interface OAuthRouteDependencies {
  encryptionKey: Buffer;
  smtpConfigured: boolean;
}

/** Prevents browser caches from retaining authorization forms and OAuth responses. */
function setNoStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

/** Summarizes only known OAuth grant identifiers and redacts arbitrary client values. */
function summarizeGrantTypes(value: unknown): GrantTypesSummary {
  if (value === undefined) return 'omitted';
  if (!Array.isArray(value)) return 'not_an_array';
  return {
    values: Array.from(value.slice(0, 8), (grantType) =>
      typeof grantType === 'string' && LOGGABLE_GRANT_TYPES.has(grantType) ? grantType : '<other>'),
    truncated: value.length > 8,
  };
}

/** Reads one cookie value without trusting malformed percent escapes. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const part = header.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`));
  if (!part) return undefined;
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return undefined; }
}

/** Sends a safe authorization error to a callback only after exact registration checks. */
function sendAuthorizationError(req: Request, res: Response, error: unknown, origin: string): void {
  const protocolError = error instanceof OAuthProtocolError
    ? error : new OAuthProtocolError('invalid_request', 'The authorization request is invalid.');
  const params = new URL(req.originalUrl, origin).searchParams;
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const states = params.getAll('state');
  const client = clientId ? findOAuthClient(clientId) : null;
  if (client && redirectUri && client.redirectUris.includes(redirectUri) && states.length === 1 && states[0]) {
    const callback = new URL(redirectUri);
    callback.searchParams.set('error', protocolError.code);
    callback.searchParams.set('error_description', protocolError.message);
    callback.searchParams.set('state', states[0]);
    callback.searchParams.set('iss', origin);
    res.redirect(303, callback.toString());
    return;
  }
  res.status(400).json({ error: protocolError.code, error_description: protocolError.message });
}

/** Resolves the current management session without trusting OAuth request identity fields. */
function sessionAccountId(req: Request): string | null {
  const value = readCookie(req, SESSION_COOKIE);
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  // Session resolution is kept here so authorization starts directly at consent for signed-in users.
  const session = findManagementSession(value);
  return session?.accountId ?? null;
}

/** Creates OAuth discovery, registration, authorization, and token routes for one instance. */
export function createOAuthRouter(dependencies: OAuthRouteDependencies): Router {
  const router = Router();

  const limiter = (limit: number) => rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  });

  router.get('/.well-known/oauth-protected-resource', (req, res) => {
    const origin = publicOrigin(req);
    if (!origin) {
      res.status(400).json({ error: 'invalid_request', error_description: 'The public OAuth resource requires HTTPS.' });
      return;
    }
    setNoStore(res);
    res.json({
      resource: origin,
      authorization_servers: [origin],
      scopes_supported: supportedOAuthScopes(dependencies.smtpConfigured),
      bearer_methods_supported: ['header'],
    });
  });

  router.get('/.well-known/oauth-authorization-server', (req, res) => {
    const origin = publicOrigin(req);
    if (!origin) {
      res.status(400).json({ error: 'invalid_request', error_description: 'OAuth metadata requires the public HTTPS origin.' });
      return;
    }
    setNoStore(res);
    res.json({
      issuer: origin,
      authorization_endpoint: new URL(OAUTH_AUTHORIZATION_ENDPOINT, origin).toString(),
      token_endpoint: new URL(OAUTH_TOKEN_ENDPOINT, origin).toString(),
      registration_endpoint: new URL(OAUTH_REGISTRATION_ENDPOINT, origin).toString(),
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: supportedOAuthScopes(dependencies.smtpConfigured),
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: false,
    });
  });

  router.post('/oauth/register', limiter(20), json({ limit: '16kb', strict: true }), (req, res) => {
    try {
      const client = registerPublicClient(req.body);
      setNoStore(res);
      res.status(201).json({
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    } catch (error) {
      const protocolError = error instanceof OAuthProtocolError
        ? error : new OAuthProtocolError('invalid_client_metadata', 'The client metadata is invalid.');
      const status = protocolError.code === 'server_error' ? 503 : 400;
      const grantTypes = error instanceof OAuthProtocolError && error.diagnosticField === 'grant_types'
        ? summarizeGrantTypes(
          req.body && typeof req.body === 'object' && !Array.isArray(req.body)
            ? (req.body as Record<string, unknown>).grant_types
            : undefined,
        )
        : undefined;
      // Keep registration diagnostics useful without logging client-supplied metadata.
      process.stderr.write(`${JSON.stringify({
        event: 'oauth_client_registration_rejected',
        status,
        code: protocolError.code,
        reason: error instanceof OAuthProtocolError ? protocolError.message : 'Unexpected client registration error.',
        ...(grantTypes !== undefined && { grant_types: grantTypes }),
      })}\n`);
      res.status(status)
        .json({ error: protocolError.code, error_description: protocolError.message });
    }
  });

  router.get('/oauth/authorize', limiter(60), (req, res) => {
    const origin = publicOrigin(req);
    if (!origin) {
      res.status(400).send('OAuth authorization requires the public HTTPS origin.');
      return;
    }
    setNoStore(res);
    try {
      const params = new URL(req.originalUrl, origin).searchParams;
      const pending = beginAuthorization(params, origin, dependencies.smtpConfigured);
      const accountId = sessionAccountId(req);
      if (accountId && !bindOAuthAuthorizationRequest(pending.requestId, accountId)) {
        throw new OAuthProtocolError('invalid_request', 'The authorization request has expired.');
      }
      res.cookie(OAUTH_HANDOFF_COOKIE, createOAuthHandoffValue(pending.requestId, dependencies.encryptionKey), {
        ...COOKIE_OPTIONS,
        maxAge: Math.max(0, pending.expiresAt - Date.now()),
      });
      const nextPath = accountId
        ? `/oauth/consent?request=${encodeURIComponent(pending.requestId)}`
        : `/?oauth_request=${encodeURIComponent(pending.requestId)}`;
      res.redirect(303, nextPath);
    } catch (error) {
      sendAuthorizationError(req, res, error, origin);
    }
  });

  router.post('/oauth/token', limiter(60), urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
    setNoStore(res);
    if (!req.is('application/x-www-form-urlencoded')) {
      res.status(400).json({ error: 'invalid_request', error_description: 'The token request must use form encoding.' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const formString = (name: string): string => typeof body[name] === 'string' ? body[name] as string : '';
    try {
      const origin = publicOrigin(req);
      if (!origin) throw new OAuthProtocolError('invalid_request', 'The token request requires the public HTTPS origin.');
      const tokens = exchangeAuthorizationCode({
        grantType: formString('grant_type'),
        code: formString('code'),
        clientId: formString('client_id'),
        redirectUri: formString('redirect_uri'),
        resource: formString('resource'),
        codeVerifier: formString('code_verifier'),
      });
      res.json({
        access_token: tokens.accessToken,
        token_type: tokens.tokenType,
        expires_in: Math.min(tokens.expiresIn, Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000)),
        scope: tokens.scope,
      });
    } catch (error) {
      const protocolError = error instanceof OAuthProtocolError
        ? error : new OAuthProtocolError('invalid_grant', 'The authorization code is invalid or expired.');
      res.status(protocolError.code === 'invalid_client' ? 401 : 400).json({
        error: protocolError.code,
        error_description: protocolError.message,
      });
    }
  });

  return router;
}
