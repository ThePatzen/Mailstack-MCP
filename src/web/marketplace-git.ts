import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { createMailstackMarketplace, createMailstackPluginFiles } from './plugin-package.js';

const execFile = promisify(execFileCallback);
const MAX_REPOSITORIES = 4;
const MAX_UPLOAD_PACK_REQUEST_BYTES = 1024 * 1024;
const MAX_CGI_HEADER_BYTES = 16 * 1024;
const ALLOWED_RESPONSE_HEADERS = new Set(['cache-control', 'content-length', 'content-type', 'expires', 'pragma']);

interface RepositoryEntry {
  directory: string;
  repositoryPath: string;
  activeRequests: number;
  lastUsedAt: number;
  ready: Promise<void>;
}

/** Indicates that the cache is full and every repository is serving an active request. */
class MarketplaceBusyError extends Error {}

let tempRootPromise: Promise<string> | undefined;
let exitCleanupRegistered = false;
const repositories = new Map<string, RepositoryEntry>();

/** Creates a private temporary root for generated repositories and removes it on process exit. */
async function getTempRoot(): Promise<string> {
  tempRootPromise ??= mkdtemp(join(tmpdir(), 'mailstack-marketplace-'));
  const tempRoot = await tempRootPromise;
  if (!exitCleanupRegistered) {
    exitCleanupRegistered = true;
    process.once('exit', () => rmSync(tempRoot, { recursive: true, force: true }));
  }
  return tempRoot;
}

/** Runs one fixed Git command without inheriting application secrets or using a shell. */
async function runGit(args: string[], cwd: string): Promise<void> {
  await execFile('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  });
}

/** Writes the instance-specific plugin and marketplace catalog into a working tree. */
async function writeMarketplaceFiles(workTree: string, mcpUrl: string, pluginName: string): Promise<void> {
  const origin = new URL(mcpUrl).origin;
  const gitUrl = new URL('/marketplace.git', origin).toString();
  const files = createMailstackPluginFiles(mcpUrl, pluginName);
  const catalog = createMailstackMarketplace(gitUrl, pluginName);
  files.push({
    name: '.agents/plugins/marketplace.json',
    data: Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, 'utf8'),
  });

  for (const file of files) {
    const path = join(workTree, file.name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.data, { mode: 0o600 });
  }
}

/** Builds one bare, exportable repository from files generated for a validated instance origin. */
async function buildMarketplaceRepository(directory: string, mcpUrl: string, pluginName: string): Promise<void> {
  const workTree = join(directory, 'source');
  const repositoryPath = join(directory, 'marketplace.git');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(workTree, { mode: 0o700 });
  await writeMarketplaceFiles(workTree, mcpUrl, pluginName);

  await runGit(['init', '--initial-branch=main', workTree], directory);
  await runGit(['config', 'user.name', 'Mailstack MCP'], workTree);
  await runGit(['config', 'user.email', 'mailstack@localhost'], workTree);
  await runGit(['add', '--all'], workTree);
  await runGit(['commit', '-m', 'Generate instance plugin'], workTree);
  await runGit(['clone', '--bare', workTree, repositoryPath], directory);
  await runGit(['--git-dir', repositoryPath, 'config', 'http.uploadpack', 'true'], directory);
  await runGit(['--git-dir', repositoryPath, 'config', 'http.receivepack', 'false'], directory);
}

/** Removes the least-recently-used idle entry before another origin reserves its cache slot. */
function evictIdleRepository(): boolean {
  const idle = [...repositories.entries()]
    .filter(([, entry]) => entry.activeRequests === 0)
    .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
  if (!idle) return false;
  repositories.delete(idle[0]);
  if (idle[1].directory) void rm(idle[1].directory, { recursive: true, force: true }).catch(() => undefined);
  return true;
}

/** Returns a ready repository and holds a lease until releaseMarketplaceRepository is called. */
export async function getMarketplaceRepository(origin: string, mcpUrl: string, pluginName: string): Promise<string> {
  const parsedMcpUrl = new URL(mcpUrl);
  if (parsedMcpUrl.protocol !== 'https:' || parsedMcpUrl.origin !== origin || parsedMcpUrl.pathname !== '/mcp') {
    throw new Error('Marketplace requires an HTTPS MCP URL for its own origin.');
  }

  let entry = repositories.get(origin);
  if (!entry) {
    if (repositories.size >= MAX_REPOSITORIES && !evictIdleRepository()) throw new MarketplaceBusyError();
    entry = {
      directory: '',
      repositoryPath: '',
      activeRequests: 1,
      lastUsedAt: Date.now(),
      ready: Promise.resolve(),
    };
    repositories.set(origin, entry);
    entry.ready = (async () => {
      const tempRoot = await getTempRoot();
      const key = createHash('sha256').update(origin).digest('hex').slice(0, 20);
      entry!.directory = join(tempRoot, key);
      entry!.repositoryPath = join(entry!.directory, 'marketplace.git');
      await buildMarketplaceRepository(entry!.directory, mcpUrl, pluginName);
    })().catch(async (error: unknown) => {
      if (repositories.get(origin) === entry) repositories.delete(origin);
      if (entry!.directory) await rm(entry!.directory, { recursive: true, force: true });
      throw error;
    });
  } else {
    entry.activeRequests += 1;
    entry.lastUsedAt = Date.now();
  }

  try {
    await entry.ready;
    entry.lastUsedAt = Date.now();
    return entry.repositoryPath;
  } catch (error) {
    entry.activeRequests = Math.max(0, entry.activeRequests - 1);
    throw error;
  }
}

/** Releases a repository lease so idle origins can be evicted from the bounded cache. */
export function releaseMarketplaceRepository(origin: string): void {
  const entry = repositories.get(origin);
  if (!entry) return;
  entry.activeRequests = Math.max(0, entry.activeRequests - 1);
  entry.lastUsedAt = Date.now();
}

/** Parses Git's CGI response headers and forwards only the headers needed by smart HTTP. */
function forwardCgiHeaders(res: Response, rawHeaders: Buffer): void {
  let status = 200;
  for (const line of rawHeaders.toString('latin1').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === 'status') {
      const match = /^(\d{3})(?:\s|$)/.exec(value);
      if (match) status = Number(match[1]);
    } else if (ALLOWED_RESPONSE_HEADERS.has(name) && !/[\r\n\0]/.test(value)) {
      res.setHeader(name, value);
    }
  }
  res.status(status);
}

/** Streams one validated upload-pack request through Git's CGI backend without exposing its errors. */
async function runGitBackend(req: Request, res: Response, mcpUrl: string, repositoryPath: string): Promise<void> {
  const originUrl = new URL(mcpUrl).origin;
  const requestPath = req.path;
  const gitPath = requestPath.slice('/marketplace.git'.length) || '/';
  const gitArgs = new URL(req.originalUrl, originUrl).searchParams;
  const contentLength = req.get('content-length');
  const bodySize = contentLength === undefined ? NaN : Number(contentLength);
  if (req.method === 'POST' && (!Number.isSafeInteger(bodySize) || bodySize < 0 || bodySize > MAX_UPLOAD_PACK_REQUEST_BYTES)) {
    res.status(bodySize > MAX_UPLOAD_PACK_REQUEST_BYTES ? 413 : 411).send('Ungültige Git-Anfrage.');
    return;
  }

  const origin = new URL(originUrl);
  const child = spawn('git', ['http-backend'], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: {
      PATH: '/usr/bin:/bin',
      HOME: dirname(repositoryPath),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_EXEC_PATH: '/usr/lib/git-core',
      GIT_PROJECT_ROOT: dirname(repositoryPath),
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: `/marketplace.git${gitPath}`,
      QUERY_STRING: gitArgs.toString(),
      REQUEST_METHOD: req.method,
      REQUEST_URI: req.originalUrl,
      SCRIPT_NAME: '/marketplace.git',
      SERVER_NAME: origin.hostname,
      SERVER_PORT: origin.port || '443',
      SERVER_PROTOCOL: `HTTP/${req.httpVersion}`,
      GATEWAY_INTERFACE: 'CGI/1.1',
      SERVER_SOFTWARE: 'Mailstack MCP',
      HTTPS: 'on',
      HTTP_HOST: origin.host,
      HTTP_GIT_PROTOCOL: req.get('git-protocol') ?? '',
      CONTENT_TYPE: req.get('content-type') ?? '',
      CONTENT_LENGTH: contentLength ?? '',
      REMOTE_ADDR: req.ip ?? '',
    },
  });

  let headerBuffer = Buffer.alloc(0);
  let headersForwarded = false;
  let responseDone = false;
  // Hide process failures and stop the child if the HTTP client has gone away.
  const fail = (): void => {
    if (responseDone || res.destroyed) return;
    responseDone = true;
    child.kill();
    if (res.headersSent) res.destroy();
    else res.status(500).send('Marketplace ist derzeit nicht verfügbar.');
  };

  await new Promise<void>((resolve) => {
    child.on('error', () => {
      fail();
      resolve();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (res.destroyed || responseDone) return;
      if (!headersForwarded) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        const crlfSeparator = headerBuffer.indexOf('\r\n\r\n');
        const lfSeparator = headerBuffer.indexOf('\n\n');
        const separator = crlfSeparator >= 0 ? crlfSeparator : lfSeparator;
        if (separator < 0) {
          if (headerBuffer.length > MAX_CGI_HEADER_BYTES) fail();
          return;
        }
        const separatorLength = crlfSeparator >= 0 ? 4 : 2;
        headersForwarded = true;
        forwardCgiHeaders(res, headerBuffer.subarray(0, separator));
        const body = headerBuffer.subarray(separator + separatorLength);
        if (body.length) res.write(body);
        headerBuffer = Buffer.alloc(0);
        return;
      }
      res.write(chunk);
    });
    child.stdout.on('end', () => {
      if (!responseDone && headersForwarded && !res.writableEnded) {
        responseDone = true;
        res.end();
      }
    });
    child.on('close', (code) => {
      if (code !== 0 || !headersForwarded) fail();
      resolve();
    });
    child.stdin.on('error', () => undefined);
    req.on('aborted', () => child.kill());
    res.on('close', () => { if (!res.writableEnded) child.kill(); });
    req.pipe(child.stdin);
  });
}

/** Serves only Git upload-pack requests for the generated instance-specific repository. */
export async function serveMarketplaceGit(req: Request, res: Response, mcpUrl: string, pluginName: string): Promise<void> {
  const gitPath = req.path.slice('/marketplace.git'.length);
  const query = new URL(req.originalUrl, new URL(mcpUrl).origin).searchParams;
  const infoRefs = req.method === 'GET' && gitPath === '/info/refs' &&
    query.size === 1 && query.getAll('service').length === 1 && query.get('service') === 'git-upload-pack';
  const uploadPack = req.method === 'POST' && gitPath === '/git-upload-pack' &&
    (req.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase() === 'application/x-git-upload-pack-request';
  if (!infoRefs && !uploadPack) {
    res.status(req.method === 'GET' || req.method === 'POST' ? 404 : 405).send('Git-Endpunkt nicht gefunden.');
    return;
  }

  const origin = new URL(mcpUrl).origin;
  let repositoryPath: string;
  try {
    repositoryPath = await getMarketplaceRepository(origin, mcpUrl, pluginName);
  } catch (error) {
    if (error instanceof MarketplaceBusyError) {
      res.status(503).send('Marketplace ist vorübergehend ausgelastet.');
      return;
    }
    res.status(500).send('Marketplace ist derzeit nicht verfügbar.');
    return;
  }

  try {
    await runGitBackend(req, res, mcpUrl, repositoryPath);
  } finally {
    releaseMarketplaceRepository(origin);
  }
}
