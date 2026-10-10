import type { NextFunction, Request, Response } from 'express';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { findUserToken } from '../storage/repository.js';

export interface McpPrincipal {
  accountId: string;
  tokenId: string;
  username: string;
  enabledTools: string[];
}

type AuthenticatedRequest = Request & { auth?: AuthInfo };
type AuthInfoWithPrincipal = AuthInfo & { extra?: Record<string, unknown> };

export function principalFromAuthInfo(authInfo: AuthInfo | undefined): McpPrincipal | null {
  const candidate = (authInfo as AuthInfoWithPrincipal | undefined)?.extra?.mailstackPrincipal;
  if (!candidate || typeof candidate !== 'object') return null;
  const principal = candidate as Partial<McpPrincipal>;
  if (typeof principal.accountId !== 'string' || typeof principal.tokenId !== 'string' ||
      typeof principal.username !== 'string' || !Array.isArray(principal.enabledTools) ||
      !principal.enabledTools.every((name) => typeof name === 'string')) return null;
  return principal as McpPrincipal;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header);
  return match?.[1] ?? null;
}

export function authenticateMcpRequest(req: Request, res: Response, next: NextFunction): void {
  const token = bearerToken(req.get('authorization'));
  const authenticated = token ? findUserToken(token) : null;
  if (!token || !authenticated) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'unauthorized', message: 'A valid MCP user token is required.' });
    return;
  }

  const principal: McpPrincipal = {
    accountId: authenticated.accountId,
    tokenId: authenticated.id,
    username: authenticated.username,
    enabledTools: authenticated.enabledTools,
  };
  // The SDK's AuthInfo carries the verified identity. The principal stays in
  // memory in its opaque `extra` field; the token is never persisted or logged.
  (req as AuthenticatedRequest).auth = {
    token,
    clientId: principal.username,
    scopes: [],
    extra: { mailstackPrincipal: principal },
  } as AuthInfo;
  next();
}
