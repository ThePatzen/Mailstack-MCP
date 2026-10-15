import { access, constants, stat } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { loadConfig } from './config.js';
import { initializeDatabase, closeDatabase as closeStorageDatabase } from './storage/database.js';
import { createManagementApp } from './web/app.js';
import { configureImapService } from './imap/client.js';
import { configureSmtpService } from './smtp/sender.js';
import { authenticateMcpRequest, principalFromAuthInfo } from './http/mcp-auth.js';
import { buildMcpServer } from './mcp/server.js';
import { createOAuthRouter } from './oauth/routes.js';

/** Confirms the configured data path is an existing writable directory. */
async function verifyDataDirectory(dataDir: string): Promise<void> {
  try {
    const details = await stat(dataDir);
    if (!details.isDirectory()) throw new Error('path is not a directory');
    await access(dataDir, constants.W_OK);
  } catch {
    throw new Error(`Data directory "${dataDir}" must already exist, be a directory, and be writable by the service user. Check the host bind mount permissions.`);
  }
}

/** Loads configuration, initializes services, and starts the HTTP server. */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  configureImapService(config);
  configureSmtpService(config);
  await verifyDataDirectory(config.dataDir);
  const appLogoPath = config.appLogoFilename ? join(config.dataDir, 'image', config.appLogoFilename) : undefined;
  if (appLogoPath) {
    try {
      const logo = await stat(appLogoPath);
      await access(appLogoPath, constants.R_OK);
      if (!logo.isFile()) throw new Error('not a file');
    } catch {
      throw new Error(`Configured APP_LOGO_FILENAME must exist as a readable file in "${join(config.dataDir, 'image')}".`);
    }
  }
  initializeDatabase(config.dataDir, config.encryptionKey);
  registerDatabaseCloser(closeStorageDatabase);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  // Keep health checks independent of mailbox credentials and database state.
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.use(createOAuthRouter({
    encryptionKey: config.encryptionKey,
    smtpConfigured: Boolean(config.smtp),
  }));
  // The auth middleware populates the verified principal before the SDK asks
  // for a server, so registrations are scoped to this request's token.
  // Build each MCP server from the principal authenticated for that request.
  const mcpHandler = createMcpHandler(({ authInfo }) => {
    const principal = principalFromAuthInfo(authInfo);
    if (!principal) throw new Error('MCP authentication context is unavailable.');
    return buildMcpServer(principal, Boolean(config.smtp));
  });
  const handleMcp = toNodeHandler(mcpHandler);
  // Convert rejected SDK requests into a safe response without leaking error details.
  app.all('/mcp', authenticateMcpRequest, (req, res) => {
    void handleMcp(req, res).catch(() => {
      if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: 'MCP request could not be processed.' });
      else res.destroy();
    });
  });
  app.use(createManagementApp({
    staticTokens: config.staticTokens,
    encryptionKey: config.encryptionKey,
    appTitle: config.appTitle,
    appLogoPath,
    pluginName: config.pluginName,
    imap: config.imap,
    smtp: config.smtp,
    systemMail: config.systemMail,
    smtpConfigured: Boolean(config.smtp),
  }));

  // Report readiness only after the HTTP listener has started successfully.
  const server = app.listen(config.httpPort, '0.0.0.0', () => {
    process.stdout.write(`Mailstack MCP listening on port ${config.httpPort}\n`);
  });

  let shuttingDown = false;
  /** Closes MCP, HTTP, and SQLite once after the first termination signal. */
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`Received ${signal}; shutting down.\n`);
    // Keep shutdown moving even if the MCP SDK reports a cleanup error.
    const closeMcp = mcpHandler.close().catch(() => {
      process.stderr.write('MCP handler did not close cleanly.\n');
      process.exitCode = 1;
    });
    // Close storage after HTTP requests stop, so in-flight handlers can finish.
    server.close(async (error) => {
      await closeMcp;
      await closeDatabase();
      if (error) {
        process.stderr.write('HTTP server did not close cleanly.\n');
        process.exitCode = 1;
      }
    });
  };
  // Handle each termination signal once to avoid duplicate cleanup.
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

let closeDatabase: () => Promise<void> = async () => {};
/** Supplies the storage cleanup action used during graceful shutdown. */
export function registerDatabaseCloser(closer: () => Promise<void>): void {
  closeDatabase = closer;
}

// Keep startup errors useful for operators without printing secret values.
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  process.stderr.write(`Startup failed: ${message}\n`);
  process.exitCode = 1;
});
