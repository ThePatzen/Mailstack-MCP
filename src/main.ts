import { access, constants, stat } from 'node:fs/promises';
import express from 'express';
import helmet from 'helmet';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { loadConfig } from './config.js';
import { initializeDatabase, closeDatabase as closeStorageDatabase } from './storage/database.js';
import { createManagementApp } from './web/app.js';
import { configureImapService } from './imap/client.js';
import { authenticateMcpRequest, principalFromAuthInfo } from './http/mcp-auth.js';
import { buildMcpServer } from './mcp/server.js';

async function verifyDataDirectory(dataDir: string): Promise<void> {
  try {
    const details = await stat(dataDir);
    if (!details.isDirectory()) throw new Error('path is not a directory');
    await access(dataDir, constants.W_OK);
  } catch {
    throw new Error(`Data directory "${dataDir}" must already exist, be a directory, and be writable by the service user. Check the host bind mount permissions.`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  configureImapService(config);
  await verifyDataDirectory(config.dataDir);
  initializeDatabase(config.dataDir, config.encryptionKey);
  registerDatabaseCloser(closeStorageDatabase);

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  const mcpHandler = createMcpHandler(({ authInfo }) => {
    const principal = principalFromAuthInfo(authInfo);
    if (!principal) throw new Error('MCP authentication context is unavailable.');
    return buildMcpServer(principal);
  });
  const handleMcp = toNodeHandler(mcpHandler);
  app.all('/mcp', authenticateMcpRequest, (req, res) => {
    void handleMcp(req, res).catch(() => {
      if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: 'MCP request could not be processed.' });
      else res.destroy();
    });
  });
  app.use(createManagementApp({
    staticTokens: config.staticTokens,
    encryptionKey: config.encryptionKey,
    imap: config.imap,
    smtpConfigured: Boolean(config.smtp),
  }));

  const server = app.listen(config.httpPort, '0.0.0.0', () => {
    process.stdout.write(`Mailstack MCP listening on port ${config.httpPort}\n`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`Received ${signal}; shutting down.\n`);
    server.close(async (error) => {
      await mcpHandler.close();
      await closeDatabase();
      if (error) {
        process.stderr.write('HTTP server did not close cleanly.\n');
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

let closeDatabase: () => Promise<void> = async () => {};
export function registerDatabaseCloser(closer: () => Promise<void>): void {
  closeDatabase = closer;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  process.stderr.write(`Startup failed: ${message}\n`);
  process.exitCode = 1;
});
