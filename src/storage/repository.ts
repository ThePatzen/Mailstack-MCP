import { randomUUID } from 'node:crypto';
import type { EncryptedSecret } from '../security/crypto.js';
import { generateToken, hashToken, tokenDigestMatches } from '../security/tokens.js';
import { getDatabase } from './database.js';

export interface AccountRecord {
  id: string;
  username: string;
  createdAt: number;
  updatedAt: number;
}

export interface TokenSummary {
  id: string;
  accountId: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  enabledTools: string[];
  permissions: Record<string, boolean>;
}

export interface AuthenticatedToken extends TokenSummary {
  username: string;
}

interface AccountRow {
  id: string; username: string; created_at: number; updated_at: number;
  password_ciphertext: string; password_nonce: string; password_tag: string;
}
interface TokenRow {
  id: string; account_id: string; label: string; created_at: number;
  last_used_at: number | null; revoked_at: number | null; token_hash: string;
}

function accountRecord(row: AccountRow): AccountRecord {
  return { id: row.id, username: row.username, createdAt: row.created_at, updatedAt: row.updated_at };
}

function tokenSummary(row: TokenRow): TokenSummary {
  const permissions = Object.fromEntries((getDatabase().prepare('SELECT tool_name, allowed FROM tool_permissions WHERE token_id = ? ORDER BY tool_name').all(row.id) as Array<{ tool_name: string; allowed: number }>).map((permission) => [permission.tool_name, permission.allowed === 1]));
  return {
    id: row.id, accountId: row.account_id, label: row.label, createdAt: row.created_at,
    lastUsedAt: row.last_used_at, revokedAt: row.revoked_at, permissions,
    enabledTools: Object.keys(permissions).filter((name) => permissions[name]),
  };
}

export function createOrUpdateAccount(username: string, encryptedPassword: EncryptedSecret): AccountRecord {
  if (!username || username.length > 1024 || /[\r\n\0]/.test(username)) throw new Error('Invalid account username.');
  const db = getDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO accounts (id, username, password_ciphertext, password_nonce, password_tag, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET
    password_ciphertext = excluded.password_ciphertext, password_nonce = excluded.password_nonce,
    password_tag = excluded.password_tag, updated_at = excluded.updated_at`).run(randomUUID(), username, encryptedPassword.ciphertext, encryptedPassword.nonce, encryptedPassword.tag, now, now);
  return accountRecord(db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as AccountRow);
}

export function getAccountCredentials(accountId: string): { username: string; encryptedPassword: EncryptedSecret } | null {
  const row = getDatabase().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined;
  if (!row) return null;
  return { username: row.username, encryptedPassword: { ciphertext: row.password_ciphertext, nonce: row.password_nonce, tag: row.password_tag } };
}

export function createUserToken(accountId: string, label: string): { token: string; summary: TokenSummary } {
  const cleanLabel = label.trim();
  if (!cleanLabel || cleanLabel.length > 100 || /[\r\n\0]/.test(cleanLabel)) throw new Error('Token label must contain 1 to 100 characters.');
  const token = generateToken();
  const id = randomUUID();
  const db = getDatabase();
  db.prepare('INSERT INTO tokens (id, account_id, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, accountId, cleanLabel, hashToken(token), Date.now());
  return { token, summary: tokenSummary(db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow) };
}

export function findUserToken(token: string): AuthenticatedToken | null {
  // All issued tokens are a canonical 32-byte base64url encoding.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = getDatabase();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND revoked_at IS NULL').get(hashToken(token)) as TokenRow | undefined;
    if (!row || !tokenDigestMatches(token, row.token_hash)) return null;
    const account = db.prepare('SELECT username FROM accounts WHERE id = ?').get(row.account_id) as { username: string } | undefined;
    if (!account) return null;
    const now = Date.now();
    db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, row.id);
    return { ...tokenSummary({ ...row, last_used_at: now }), username: account.username };
  })();
}

export function listTokens(accountId: string): TokenSummary[] {
  return (getDatabase().prepare('SELECT * FROM tokens WHERE account_id = ? ORDER BY created_at DESC, id').all(accountId) as TokenRow[]).map(tokenSummary);
}

export function revokeToken(accountId: string, tokenId: string): boolean {
  return getDatabase().prepare('UPDATE tokens SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL').run(Date.now(), tokenId, accountId).changes > 0;
}

export function deleteToken(accountId: string, tokenId: string): boolean {
  return getDatabase().prepare('DELETE FROM tokens WHERE id = ? AND account_id = ? AND revoked_at IS NOT NULL').run(tokenId, accountId).changes > 0;
}

export function setToolPermission(accountId: string, tokenId: string, toolName: string, allowed: boolean): void {
  if (!/^[a-z][a-z0-9_]{0,99}$/.test(toolName) || typeof allowed !== 'boolean') throw new Error('Invalid tool permission.');
  const db = getDatabase();
  // An INSERT SELECT keeps the ownership and active-token checks in the mutation itself.
  const result = db.prepare(`INSERT INTO tool_permissions (token_id, tool_name, allowed)
    SELECT id, ?, ? FROM tokens WHERE id = ? AND account_id = ? AND revoked_at IS NULL
    ON CONFLICT(token_id, tool_name) DO UPDATE SET allowed = excluded.allowed`).run(toolName, allowed ? 1 : 0, tokenId, accountId);
  if (!result.changes) throw new Error('Active token not found for this account.');
}

export function createSession(accountId: string, expiresAt: number): string {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('Session expiration must be in the future.');
  const sessionId = generateToken();
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions (session_hash, account_id, expires_at) VALUES (?, ?, ?)').run(hashToken(sessionId), accountId, expiresAt);
  })();
  return sessionId;
}

export function findSession(sessionId: string): { accountId: string; expiresAt: number } | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
  const db = getDatabase();
  const digest = hashToken(sessionId);
  const row = db.prepare('SELECT account_id, expires_at, session_hash FROM sessions WHERE session_hash = ?').get(digest) as { account_id: string; expires_at: number; session_hash: string } | undefined;
  if (!row || !tokenDigestMatches(sessionId, row.session_hash)) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE session_hash = ?').run(digest);
    return null;
  }
  return { accountId: row.account_id, expiresAt: row.expires_at };
}

export function deleteSession(sessionId: string): void {
  getDatabase().prepare('DELETE FROM sessions WHERE session_hash = ?').run(hashToken(sessionId));
}
