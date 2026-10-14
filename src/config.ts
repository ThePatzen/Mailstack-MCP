import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type TlsMode = 'implicit' | 'starttls';

export interface AppConfig {
  httpPort: number;
  dataDir: string;
  appTitle: string;
  appLogoFilename?: string;
  pluginName: string;
  staticTokens: string[];
  encryptionKey: Buffer;
  imap: { host: string; port: number; tlsMode: TlsMode };
  smtp?: { host: string; port: number; tlsMode: TlsMode };
  systemMail?: { user: string; password: string; from: string };
  sentFolder?: string;
}

/** Reads a required environment value and rejects missing or blank input. */
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required and must not be empty.`);
  return value;
}

/** Parses a TCP port while rejecting fractional, unsafe, and out-of-range values. */
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

/** Reads a supported TLS mode without allowing certificate checks to be disabled. */
function tlsMode(env: NodeJS.ProcessEnv, name: string, fallback: TlsMode): TlsMode {
  const value = env[name]?.trim().toLowerCase() || fallback;
  if (value !== 'implicit' && value !== 'starttls') {
    throw new Error(`${name} must be either "implicit" or "starttls".`);
  }
  return value;
}

/** Loads the encryption key from exactly one configured source and validates its 32-byte encoding. */
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

/** Validates environment settings and returns the normalized service configuration. */
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
  const appTitle = env.APP_TITLE?.trim() || 'Mailstack MCP';
  const appLogoFilename = env.APP_LOGO_FILENAME?.trim();
  const pluginName = env.PLUGIN_NAME?.trim() || 'Mailstack MCP';
  if (appTitle.length > 100 || /[\r\n\0]/.test(appTitle)) {
    throw new Error('APP_TITLE must not exceed 100 characters or contain line breaks.');
  }
  if (appLogoFilename && (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,123}\.(?:png|jpe?g|webp|gif|ico)$/i.test(appLogoFilename) || appLogoFilename.includes('..'))) {
    throw new Error('APP_LOGO_FILENAME must be a raster image filename (PNG, JPEG, WebP, GIF, or ICO) without a path.');
  }
  if (!pluginName || pluginName.length > 100 || /[\r\n\0]/.test(pluginName) || !/[A-Za-z0-9]/.test(pluginName.normalize('NFKD'))) {
    throw new Error('PLUGIN_NAME must contain 1 to 100 characters and no line breaks.');
  }
  const smtpHost = env.SMTP_HOST?.trim();
  const systemMailUser = env.SMTP_SYSTEM_USER?.trim();
  const systemMailPassword = env.SMTP_SYSTEM_PASSWORD?.trim();
  const rawSystemMailFrom = env.SMTP_SYSTEM_FROM;
  if (rawSystemMailFrom && /[\r\n\0]/.test(rawSystemMailFrom)) {
    throw new Error('SMTP_SYSTEM_FROM must not contain CR, LF, or NUL characters.');
  }
  const systemMailFrom = rawSystemMailFrom?.trim();
  // Enable email-code sign-in only when all three system-mail settings are present.
  const systemMail = systemMailUser && systemMailPassword && systemMailFrom
    ? { user: systemMailUser, password: systemMailPassword, from: systemMailFrom }
    : undefined;
  const sentFolder = env.IMAP_SENT_FOLDER?.trim();
  const imapTlsMode = tlsMode(env, 'IMAP_TLS_MODE', 'implicit');
  const smtpTlsMode = smtpHost ? tlsMode(env, 'SMTP_TLS_MODE', 'implicit') : undefined;

  return {
    httpPort: port(env, 'APP_PORT', 3000),
    dataDir: resolve(env.DATA_DIR?.trim() || '/app/data'),
    appTitle,
    ...(appLogoFilename ? { appLogoFilename } : {}),
    pluginName,
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
