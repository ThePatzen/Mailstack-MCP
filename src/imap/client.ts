import { ImapFlow } from 'imapflow';
import type { AppConfig } from '../config.js';
import { decryptSecret } from '../security/crypto.js';
import { getAccountCredentials } from '../storage/repository.js';
import { ImapServiceError, mapImapError } from './errors.js';

let serviceConfig: AppConfig | undefined;

export function configureImapService(config: AppConfig): void { serviceConfig = config; }

export async function withImapClient<T>(accountId: string, action: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (!accountId || typeof action !== 'function') throw new ImapServiceError('INVALID_INPUT');
  if (!serviceConfig) throw new ImapServiceError('INTERNAL');
  const credentials = getAccountCredentials(accountId);
  if (!credentials) throw new ImapServiceError('AUTHENTICATION');
  let password: string;
  try { password = decryptSecret(credentials.encryptedPassword, serviceConfig.encryptionKey); }
  catch { throw new ImapServiceError('INTERNAL'); }

  const client = new ImapFlow({
    host: serviceConfig.imap.host, port: serviceConfig.imap.port,
    secure: serviceConfig.imap.tlsMode === 'implicit',
    doSTARTTLS: serviceConfig.imap.tlsMode === 'starttls',
    auth: { user: credentials.username, pass: password }, logger: false,
  });
  try {
    await client.connect();
    return await action(client);
  } catch (error) {
    throw mapImapError(error);
  } finally {
    if (client.usable) {
      try { await client.logout(); } catch { client.close(); }
    } else {
      client.close();
    }
  }
}
