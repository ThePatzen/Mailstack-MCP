import type { NextFunction, Request, Response } from 'express';
import { createSession, deleteSession, findSession } from '../storage/repository.js';

export const SESSION_COOKIE = 'mailstack_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface ManagementRequest extends Request {
  management?: { accountId: string; sessionId: string };
  accountUsername?: string;
}

export function createManagementSession(accountId: string): string {
  return createSession(accountId, Date.now() + SESSION_TTL_MS);
}

export function requireManagementSession(req: Request, res: Response, next: NextFunction): void {
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (typeof sessionId !== 'string') {
    res.redirect('/');
    return;
  }
  const session = findSession(sessionId);
  if (!session) {
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
    res.redirect('/');
    return;
  }
  (req as ManagementRequest).management = { accountId: session.accountId, sessionId };
  next();
}

export function destroyManagementSession(sessionId: string): void {
  deleteSession(sessionId);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}
