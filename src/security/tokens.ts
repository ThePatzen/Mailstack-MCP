import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Creates a cryptographically random bearer-compatible identifier. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Returns the one-way digest used to store bearer tokens and session identifiers. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Checks a candidate against its stored token digest using a constant-time byte comparison. */
export function tokenDigestMatches(candidate: string, storedDigest: string): boolean {
  const digest = Buffer.from(hashToken(candidate), 'hex');
  const stored = Buffer.from(storedDigest, 'hex');
  return stored.length === digest.length && timingSafeEqual(digest, stored);
}

/** Creates a keyed digest with purpose separation for email-login codes and challenge identifiers. */
export function hashEmailLoginValue(value: string, purpose: 'email-login-challenge-id' | 'email-login-code', key: Buffer): string {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Email login verification requires a 32-byte key.');
  return createHmac('sha256', key).update(purpose, 'utf8').update('\0').update(value, 'utf8').digest('hex');
}
