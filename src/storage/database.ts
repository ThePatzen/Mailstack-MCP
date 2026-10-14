import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../security/crypto.js';

let database: Database.Database | undefined;

export function initializeDatabase(dataDir: string, encryptionKey: Buffer): Database.Database {
  if (database) throw new Error('Database is already initialized.');
  const databaseDir = join(dataDir, 'database');
  const legacyFilename = join(dataDir, 'mailstack.sqlite');
  const filename = join(databaseDir, 'mailstack.sqlite');
  mkdirSync(databaseDir, { recursive: true, mode: 0o700 });
  const legacyExists = existsSync(legacyFilename);
  const currentExists = existsSync(filename);
  if (legacyExists && currentExists) {
    throw new Error(`Both legacy database "${legacyFilename}" and new database "${filename}" exist. Resolve this manually; neither file was changed.`);
  }
  if (legacyExists) {
    const previous = new Database(legacyFilename);
    try {
      const checkpoint = previous.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
      if (checkpoint[0]?.busy) throw new Error('The legacy database is busy and could not be safely moved. Stop other service instances and retry.');
    } finally {
      previous.close();
    }
    renameSync(legacyFilename, filename);
  }
  const connection = new Database(filename);
  try {
    chmodSync(filename, 0o600);
    connection.pragma('foreign_keys = ON');
    connection.pragma('journal_mode = WAL');
    connection.pragma('busy_timeout = 5000');
    connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const version = (connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null }).version ?? 0;
    if (version > 2) throw new Error('Database schema is newer than this service supports.');
    const migrations = [
      { version: 1, filename: '001-initial.sql' },
      { version: 2, filename: '002-email-login-challenges.sql' },
    ];
    for (const migration of migrations) {
      if (version >= migration.version) continue;
      connection.transaction(() => {
        connection.exec(readFileSync(join(__dirname, 'migrations', migration.filename), 'utf8'));
        connection.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
      })();
    }
    const check = connection.prepare('SELECT value FROM deployment_metadata WHERE name = ?').get('encryption_key_check') as { value: string } | undefined;
    if (check) {
      const plaintext = decryptSecret(JSON.parse(check.value) as EncryptedSecret, encryptionKey);
      if (plaintext !== 'mailstack-mcp encryption key verification v1') throw new Error('Encryption key verification failed.');
    } else {
      connection.prepare('INSERT INTO deployment_metadata (name, value) VALUES (?, ?)').run('encryption_key_check', JSON.stringify(encryptSecret('mailstack-mcp encryption key verification v1', encryptionKey)));
    }
    database = connection;
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function getDatabase(): Database.Database {
  if (!database) throw new Error('Database has not been initialized.');
  return database;
}

export async function closeDatabase(): Promise<void> {
  database?.close();
  database = undefined;
}
