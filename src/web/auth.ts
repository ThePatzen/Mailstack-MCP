import { createHash, timingSafeEqual } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import type { AppConfig } from '../config.js';

/** Verifies a management static token without stopping at the first configured-token match. */
export function verifyStaticToken(candidate: string, configuredTokens: string[]): boolean {
  if (typeof candidate !== 'string' || !candidate) return false;
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
  let matched = 0;
  for (const configured of configuredTokens) {
    const digest = createHash('sha256').update(configured, 'utf8').digest();
    matched |= Number(timingSafeEqual(candidateDigest, digest));
  }
  return matched === 1;
}

/** Confirms credentials by connecting to IMAP with the configured TLS mode and then closing the client. */
export async function verifyImapLogin(username: string, password: string, config: AppConfig['imap']): Promise<void> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tlsMode === 'implicit',
    doSTARTTLS: config.tlsMode === 'starttls',
    auth: { user: username, pass: password },
    logger: false,
  });
  try {
    await client.connect();
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
  }
}
