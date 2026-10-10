import { join } from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from '../config.js';
import { createManagementRouter } from './routes.js';

export interface WebDependencies {
  staticTokens: string[];
  encryptionKey: Buffer;
  imap: AppConfig['imap'];
  smtpConfigured: boolean;
}

export function createManagementApp(dependencies: WebDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  const moduleDir = __dirname;
  app.set('views', join(moduleDir, 'views'));
  app.use(helmet());
  app.use('/manage/assets', express.static(join(moduleDir, 'public'), { fallthrough: false, maxAge: '1h' }));
  app.use(createManagementRouter(dependencies));
  return app;
}
