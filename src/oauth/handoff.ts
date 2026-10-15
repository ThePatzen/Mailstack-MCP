import { createHmac, timingSafeEqual } from 'node:crypto';

export const OAUTH_HANDOFF_COOKIE = 'mailstack_oauth_handoff';

/** Signs a random OAuth request handle so it can safely survive the Mailstack login redirect. */
export function createOAuthHandoffValue(requestId: string, key: Buffer): string {
  const signature = createHmac('sha256', key).update(`mailstack-oauth-handoff:${requestId}`).digest('base64url');
  return `${requestId}.${signature}`;
}

/** Verifies the signed browser handoff and returns only its canonical request identifier. */
export function readOAuthHandoffValue(value: unknown, key: Buffer): string | null {
  if (typeof value !== 'string') return null;
  const match = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return null;
  const expected = createHmac('sha256', key).update(`mailstack-oauth-handoff:${match[1]}`).digest();
  const supplied = Buffer.from(match[2], 'base64url');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? match[1] : null;
}
