import {
  createOAuthAuthorizationRequest as storeAuthorizationRequest,
  exchangeOAuthAuthorizationCode as redeemAuthorizationCode,
  findOAuthClient,
  type OAuthClient,
} from '../storage/repository.js';
import {
  OAUTH_ACCESS_TOKEN_TTL_MS,
  OAUTH_AUTHORIZATION_REQUEST_TTL_MS,
  OAuthProtocolError,
  parseAuthorizationRequest,
  type AuthorizationRequestInput,
} from './protocol.js';

/** Persists a validated browser authorization request with a bounded lifetime. */
export function createAuthorizationRequest(input: AuthorizationRequestInput): { requestId: string; expiresAt: number } {
  const expiresAt = Date.now() + OAUTH_AUTHORIZATION_REQUEST_TTL_MS;
  const requestId = storeAuthorizationRequest({
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    resource: input.resource,
    state: input.state,
    codeChallenge: input.codeChallenge,
    requestedScopes: input.scopes,
    expiresAt,
  });
  return { requestId, expiresAt };
}

/** Validates a browser request against the canonical resource before persisting it. */
export function beginAuthorization(
  params: URLSearchParams,
  resource: string,
  smtpConfigured: boolean,
): { request: AuthorizationRequestInput; requestId: string; expiresAt: number; client: OAuthClient } {
  const request = parseAuthorizationRequest(params, resource, smtpConfigured);
  const client = findOAuthClient(request.clientId);
  if (!client) throw new OAuthProtocolError('invalid_client', 'The OAuth client is not registered.');
  const pending = createAuthorizationRequest(request);
  return { ...pending, request, client };
}

/** Exchanges a validated authorization-code form for one opaque access token. */
export function exchangeAuthorizationCode(input: {
  grantType: string;
  code: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  codeVerifier: string;
}): { accessToken: string; tokenType: 'Bearer'; expiresIn: number; scope: string } {
  if (input.grantType !== 'authorization_code') {
    throw new OAuthProtocolError('unsupported_grant_type', 'Only the authorization-code grant is supported.');
  }
  const client = findOAuthClient(input.clientId);
  if (!client) throw new OAuthProtocolError('invalid_client', 'The OAuth client is not registered.');
  if (!client.redirectUris.includes(input.redirectUri)) {
    throw new OAuthProtocolError('invalid_grant', 'The authorization code is invalid or expired.');
  }
  const now = Date.now();
  const token = redeemAuthorizationCode({
    code: input.code,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    resource: input.resource,
    codeVerifier: input.codeVerifier,
    now,
    accessTokenTtlMs: OAUTH_ACCESS_TOKEN_TTL_MS,
  });
  if (!token) throw new OAuthProtocolError('invalid_grant', 'The authorization code is invalid or expired.');
  return {
    accessToken: token.accessToken,
    tokenType: 'Bearer',
    expiresIn: Math.floor((token.expiresAt - now) / 1000),
    scope: token.scopes.join(' '),
  };
}
