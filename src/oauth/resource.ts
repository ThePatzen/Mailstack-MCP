import type { Request } from 'express';

/** Resolves the canonical HTTPS origin using the service's one trusted proxy hop. */
export function publicOrigin(req: Request): string | null {
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host');
  if (!host || req.protocol !== 'https' || /[\s/@\\?#]/.test(host)) return null;
  try {
    const origin = new URL(`${req.protocol}://${host}`);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

/** Returns the canonical MCP resource identifier for an HTTPS request. */
export function publicResource(req: Request): string | null {
  return publicOrigin(req);
}

/** Builds the protected-resource discovery URL for one validated public origin. */
export function protectedResourceMetadataUrl(origin: string): string {
  return new URL('/.well-known/oauth-protected-resource', origin).toString();
}
