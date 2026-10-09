import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
