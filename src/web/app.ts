import { extname, join } from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from '../config.js';
import { createManagementRouter } from './routes.js';

export interface WebDependencies {
  staticTokens: string[];
  encryptionKey: Buffer;
  appTitle: string;
  appLogoPath?: string;
  pluginName: string;
  imap: AppConfig['imap'];
  smtp?: AppConfig['smtp'];
  systemMail?: AppConfig['systemMail'];
  smtpConfigured: boolean;
}

/** Builds the management Express app with shared security headers, assets, and routes. */
export function createManagementApp(dependencies: WebDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  const moduleDir = __dirname;
  app.set('views', join(moduleDir, 'views'));
  app.use(helmet());
  // Keep old bookmarks working while constraining the redirect to this server's root paths.
  app.use('/manage', (req, res) => {
    const suffix = req.originalUrl.slice('/manage'.length);
    res.redirect(308, `/${suffix.replace(/^\/+/, '')}`);
  });
  app.use('/assets', express.static(join(moduleDir, 'public'), { fallthrough: false, maxAge: '1h' }));
  if (dependencies.appLogoPath) {
    // Keep the optional logo outside the static directory so deployments can use a mounted file.
    app.get('/brand/logo', (_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type(extname(dependencies.appLogoPath!).slice(1));
      res.sendFile(dependencies.appLogoPath!, (error) => { if (error) next(error); });
    });
  }
  app.use(createManagementRouter(dependencies));
  return app;
}
