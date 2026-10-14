import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenDigestMatches(candidate: string, storedDigest: string): boolean {
  const digest = Buffer.from(hashToken(candidate), 'hex');
  const stored = Buffer.from(storedDigest, 'hex');
  return stored.length === digest.length && timingSafeEqual(digest, stored);
}

export function hashEmailLoginValue(value: string, purpose: 'email-login-challenge-id' | 'email-login-code', key: Buffer): string {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Email login verification requires a 32-byte key.');
  return createHmac('sha256', key).update(purpose, 'utf8').update('\0').update(value, 'utf8').digest('hex');
}
