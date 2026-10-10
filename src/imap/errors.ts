export type ImapErrorCode = 'AUTHENTICATION' | 'PERMISSION' | 'UNSUPPORTED' | 'CONNECTION' | 'TIMEOUT' | 'INVALID_INPUT' | 'NOT_FOUND' | 'TOO_LARGE' | 'SEARCH_LIMIT' | 'INTERNAL';

const SAFE_MESSAGES: Record<ImapErrorCode, string> = {
  AUTHENTICATION: 'The mailbox login was rejected.', PERMISSION: 'The mailbox server denied this operation.',
  UNSUPPORTED: 'The mailbox server does not support this operation.', CONNECTION: 'The mailbox server could not complete the operation.',
  TIMEOUT: 'The mailbox server did not respond in time.', INVALID_INPUT: 'The supplied mailbox or message input is invalid.',
  NOT_FOUND: 'The requested mailbox or message was not found.', TOO_LARGE: 'The requested content exceeds the allowed size.',
  SEARCH_LIMIT: 'The search matched too few messages in the recent mailbox range scanned. Narrow the search with a sender, subject, or date.',
  INTERNAL: 'The mailbox operation failed.',
};

export class ImapServiceError extends Error {
  constructor(readonly code: ImapErrorCode, message = SAFE_MESSAGES[code]) {
    super(message);
    this.name = 'ImapServiceError';
  }
}

export function mapImapError(error: unknown): ImapServiceError {
  if (error instanceof ImapServiceError) return error;
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = String(value.code ?? '').toLowerCase();
  const response = String(value.response ?? value.responseText ?? '').toLowerCase();
  const serverCode = String(value.serverResponseCode ?? '').toLowerCase();
  const name = String(value.name ?? '').toLowerCase();
  if (value.authenticationFailed === true || /auth|login|invalidcredentials/.test(code) || /authenticationfailed|authentication failed|login failed/.test(response) || serverCode === 'authenticationfailed') return new ImapServiceError('AUTHENTICATION');
  if (/nonexistent|notfound/.test(code) || /nonexistent|no such mailbox|no such message/.test(response) || serverCode === 'nonexistent') return new ImapServiceError('NOT_FOUND');
  if (/permission|denied|forbidden|noperm/.test(code) || /permission denied|not permitted|access denied/.test(response) || serverCode === 'noperm') return new ImapServiceError('PERMISSION');
  if (/unsupported|missingserverextension/.test(code) || /unsupported|unknown command|not implemented/.test(response) || /^(?:cannot|notsupported)$/.test(serverCode)) return new ImapServiceError('UNSUPPORTED');
  if (/timeout|etimedout/.test(code) || name.includes('timeout')) return new ImapServiceError('TIMEOUT');
  if (/noconnection|econn|enet|ehost|epipe|closed|socket|tls|certificate/.test(code) || name.includes('connection')) return new ImapServiceError('CONNECTION');
  return new ImapServiceError('INTERNAL');
}

export async function safely<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { throw mapImapError(error); }
}
