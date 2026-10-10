import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { ManagementRequest } from './sessions.js';

export const LOGIN_CSRF_COOKIE = 'mailstack_login_csrf';

export function createLoginCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function verifyLoginCsrfToken(cookie: unknown, supplied: unknown): boolean {
  if (typeof cookie !== 'string' || typeof supplied !== 'string') return false;
  const expected = Buffer.from(cookie);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function csrfToken(sessionId: string, key: Buffer): string {
  return createHmac('sha256', key).update(`mailstack-manage-csrf:${sessionId}`).digest('base64url');
}

export function requireCsrf(key: Buffer) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const sessionId = (req as ManagementRequest).management?.sessionId;
    const supplied = req.body?._csrf;
    if (!sessionId || typeof supplied !== 'string') {
      res.status(403).send('Request could not be verified. Reload the page and try again.');
      return;
    }
    const expected = Buffer.from(csrfToken(sessionId, key));
    const actual = Buffer.from(supplied);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(403).send('Request could not be verified. Reload the page and try again.');
      return;
    }
    next();
  };
}
