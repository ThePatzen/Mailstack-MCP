import { isIP } from 'node:net';
import { findOAuthClient, OAuthClientCapacityError, registerOAuthClient, type OAuthClient } from '../storage/repository.js';

export const OAUTH_ISSUER_PATH = '/';
export const OAUTH_AUTHORIZATION_ENDPOINT = '/oauth/authorize';
export const OAUTH_TOKEN_ENDPOINT = '/oauth/token';
export const OAUTH_REGISTRATION_ENDPOINT = '/oauth/register';
export const OAUTH_AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
export const OAUTH_AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

const TOOL_NAMES = [
  'list_mailboxes', 'create_mailbox', 'rename_mailbox', 'delete_mailbox',
  'list_messages', 'search_messages', 'read_message', 'get_attachment',
  'set_message_flags', 'copy_message', 'move_message', 'delete_message', 'expunge_messages',
  'send_email',
] as const;

export interface AuthorizationRequestInput {
  clientId: string;
  redirectUri: string;
  resource: string;
  state: string;
  codeChallenge: string;
  scopes: string[];
}

export type OAuthErrorCode =
  | 'invalid_request' | 'invalid_client' | 'invalid_redirect_uri' | 'invalid_scope'
  | 'unsupported_grant_type' | 'invalid_grant' | 'invalid_client_metadata' | 'access_denied' | 'server_error';

/** Represents a safe OAuth protocol error suitable for a standards-compatible response. */
export class OAuthProtocolError extends Error {
  constructor(readonly code: OAuthErrorCode, message: string) {
    super(message);
    this.name = 'OAuthProtocolError';
  }
}

/** Lists exactly the MCP tool scopes available in this server configuration. */
export function supportedOAuthScopes(smtpConfigured: boolean): string[] {
  return TOOL_NAMES.filter((name) => name !== 'send_email' || smtpConfigured).map((name) => `mailstack:${name}`);
}

/** Reads one bounded parameter and rejects duplicate values that could be interpreted differently. */
function singleParameter(params: URLSearchParams, name: string, maxLength: number, required = true): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1 || (required && values.length !== 1)) {
    throw new OAuthProtocolError('invalid_request', `Invalid ${name} parameter.`);
  }
  const value = values[0];
  if (value !== undefined && (!value || value.length > maxLength || /[\r\n\0]/.test(value))) {
    throw new OAuthProtocolError('invalid_request', `Invalid ${name} parameter.`);
  }
  return value;
}

/** Validates the authorization request against a registered client and canonical MCP resource. */
export function parseAuthorizationRequest(
  params: URLSearchParams,
  resource: string,
  smtpConfigured = false,
): AuthorizationRequestInput {
  const responseType = singleParameter(params, 'response_type', 16);
  const clientId = singleParameter(params, 'client_id', 128)!;
  const redirectUri = singleParameter(params, 'redirect_uri', 2048)!;
  const state = singleParameter(params, 'state', 1024)!;
  const requestedResource = singleParameter(params, 'resource', 2048)!;
  const codeChallenge = singleParameter(params, 'code_challenge', 128)!;
  const codeChallengeMethod = singleParameter(params, 'code_challenge_method', 16)!;
  const scopeValue = singleParameter(params, 'scope', 2048, false);

  if (responseType !== 'code') throw new OAuthProtocolError('invalid_request', 'Only the authorization-code response type is supported.');
  if (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new OAuthProtocolError('invalid_request', 'Authorization Code with PKCE S256 is required.');
  }
  if (requestedResource !== resource) throw new OAuthProtocolError('invalid_request', 'The requested resource is not supported.');
  const client = findOAuthClient(clientId);
  if (!client) throw new OAuthProtocolError('invalid_client', 'The OAuth client is not registered.');
  if (!client.redirectUris.includes(redirectUri)) {
    throw new OAuthProtocolError('invalid_redirect_uri', 'The redirect URI is not registered for this client.');
  }

  const availableScopes = new Set(supportedOAuthScopes(smtpConfigured));
  const scopes = scopeValue === undefined ? [...availableScopes] : scopeValue.split(/\s+/).filter(Boolean);
  if (!scopes.length || new Set(scopes).size !== scopes.length || scopes.some((scope) => !availableScopes.has(scope))) {
    throw new OAuthProtocolError('invalid_scope', 'The request contains an unsupported tool scope.');
  }
  return { clientId, redirectUri, resource, state, codeChallenge, scopes };
}

/** Allows public callbacks only over HTTPS, except for local loopback clients. */
function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\r\n\0]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol !== 'http:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '[::1]' ||
      (isIP(hostname) === 4 && Number(hostname.split('.')[0]) === 127);
  } catch {
    return false;
  }
}

/** Validates public-client metadata and persists only the supported registration fields. */
export function registerPublicClient(metadata: unknown): OAuthClient {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new OAuthProtocolError('invalid_client_metadata', 'Client metadata must be a JSON object.');
  }
  const input = metadata as Record<string, unknown>;
  const clientName = typeof input.client_name === 'string' ? input.client_name.trim() : 'MCP client';
  const redirectUris = input.redirect_uris;
  if (!clientName || clientName.length > 100 || /[\r\n\0]/.test(clientName) ||
      !Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 16 ||
      !redirectUris.every(validRedirectUri) || new Set(redirectUris).size !== redirectUris.length) {
    throw new OAuthProtocolError('invalid_client_metadata', 'The client name or redirect URI list is invalid.');
  }
  if (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== 'none') {
    throw new OAuthProtocolError('invalid_client_metadata', 'Only public OAuth clients are supported.');
  }
  if (input.grant_types !== undefined &&
      (!Array.isArray(input.grant_types) || input.grant_types.length !== 1 || input.grant_types[0] !== 'authorization_code')) {
    throw new OAuthProtocolError('invalid_client_metadata', 'Only the authorization-code grant is supported.');
  }
  if (input.response_types !== undefined &&
      (!Array.isArray(input.response_types) || input.response_types.length !== 1 || input.response_types[0] !== 'code')) {
    throw new OAuthProtocolError('invalid_client_metadata', 'Only the authorization-code response type is supported.');
  }
  try {
    return registerOAuthClient(clientName, redirectUris);
  } catch (error) {
    if (error instanceof OAuthClientCapacityError) {
      throw new OAuthProtocolError('server_error', 'This instance cannot register additional OAuth clients.');
    }
    throw error;
  }
}

