import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type TlsMode = 'implicit' | 'starttls';

export interface AppConfig {
  httpPort: number;
  dataDir: string;
  staticTokens: string[];
  encryptionKey: Buffer;
  imap: { host: string; port: number; tlsMode: TlsMode };
  smtp?: { host: string; port: number; tlsMode: TlsMode };
  systemMail?: { user: string; password: string; from: string };
  sentFolder?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required and must not be empty.`);
  return value;
}

function port(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer from 1 to 65535.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535.`);
  }
  return value;
}

function tlsMode(env: NodeJS.ProcessEnv, name: string, fallback: TlsMode): TlsMode {
  const value = env[name]?.trim().toLowerCase() || fallback;
  if (value !== 'implicit' && value !== 'starttls') {
    throw new Error(`${name} must be either "implicit" or "starttls".`);
  }
  return value;
}

function decodeEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const encoded = env.ENCRYPTION_KEY?.trim();
  const file = env.ENCRYPTION_KEY_FILE?.trim();
  if (encoded && file) throw new Error('Set only one of ENCRYPTION_KEY or ENCRYPTION_KEY_FILE.');
  if (!encoded && !file) throw new Error('Set ENCRYPTION_KEY or ENCRYPTION_KEY_FILE.');

  let value: string;
  try {
    value = encoded ?? readFileSync(resolve(file!), 'utf8').trim();
  } catch {
    throw new Error('Could not read ENCRYPTION_KEY_FILE; check that the configured secret file exists and is readable.');
  }
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('The encryption key must be a valid base64 value containing exactly 32 bytes.');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('The encryption key must be a valid base64 value containing exactly 32 bytes.');
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const rawTokens = required(env, 'MCP_STATIC_TOKENS');
  let staticTokens: unknown;
  try {
    staticTokens = JSON.parse(rawTokens);
  } catch {
    throw new Error('MCP_STATIC_TOKENS must be a JSON array of non-empty strings.');
  }
  if (!Array.isArray(staticTokens) || staticTokens.length === 0 ||
      staticTokens.some((token) => typeof token !== 'string' || token.trim().length < 32)) {
    throw new Error('MCP_STATIC_TOKENS must be a non-empty JSON array of tokens, each at least 32 characters long.');
  }
  const tokens = staticTokens.map((token: string) => token.trim());
  if (new Set(tokens).size !== tokens.length) throw new Error('MCP_STATIC_TOKENS must not contain duplicate tokens.');

  const imapHost = required(env, 'IMAP_HOST');
  const smtpHost = env.SMTP_HOST?.trim();
  const systemMailUser = env.SMTP_SYSTEM_USER?.trim();
  const systemMailPassword = env.SMTP_SYSTEM_PASSWORD;
  const hasSystemMailPassword = Boolean(systemMailPassword?.trim());
  const rawSystemMailFrom = env.SMTP_SYSTEM_FROM;
  if (rawSystemMailFrom && /[\r\n\0]/.test(rawSystemMailFrom)) {
    throw new Error('SMTP_SYSTEM_FROM must not contain CR, LF, or NUL characters.');
  }
  const systemMailFrom = rawSystemMailFrom?.trim();
  const systemMail = systemMailUser && hasSystemMailPassword && systemMailFrom
    ? { user: systemMailUser, password: systemMailPassword!, from: systemMailFrom }
    : undefined;
  const sentFolder = env.IMAP_SENT_FOLDER?.trim();
  const imapTlsMode = tlsMode(env, 'IMAP_TLS_MODE', 'implicit');
  const smtpTlsMode = smtpHost ? tlsMode(env, 'SMTP_TLS_MODE', 'implicit') : undefined;

  return {
    httpPort: port(env, 'APP_PORT', 3000),
    dataDir: resolve(env.DATA_DIR?.trim() || '/app/data'),
    staticTokens: tokens,
    encryptionKey: decodeEncryptionKey(env),
    imap: {
      host: imapHost,
      port: port(env, 'IMAP_PORT', 993),
      tlsMode: imapTlsMode,
    },
    ...(smtpHost ? {
      smtp: {
        host: smtpHost,
        port: port(env, 'SMTP_PORT', smtpTlsMode === 'starttls' ? 587 : 465),
        tlsMode: smtpTlsMode!,
      },
    } : {}),
    ...(systemMail ? { systemMail } : {}),
    ...(sentFolder ? { sentFolder } : {}),
  };
}
