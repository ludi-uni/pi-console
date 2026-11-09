// speech.cpp setup routing — heuristically checks for the Console PC with a
// strict native loopback probe, then hands the same device a landing page that
// explains owner verification. The probe and landing run BEFORE the public
// Host/Access gates so a remote deployment's local owner can still reach them;
// everything here is read-only and side-effect free. The instanceId is a
// per-process random NONSECRET routing token — it is not the manage nonce, an
// auth code or a credential, so it may safely be echoed to the browser.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ASSET = /^\/voice-setup\/assets\/[A-Za-z0-9._-]+\.(js|css)$/;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const count = (req: IncomingMessage, name: string) => req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length;
const unproxied = (req: IncomingMessage) => !Object.keys(req.headers).some(name =>
  ['forwarded', 'via', 'x-real-ip', 'cdn-loop'].includes(name) || name.startsWith('x-forwarded-') || name.startsWith('cf-'));

// CSP for the public pages. connect-src gains ONLY the exact probe origin —
// narrowed to the /api/voice/local-probe path — the Settings tab fetches to
// detect a same-device Console. No wildcard, no other port, no scheme.
export const speechSetupCsp = (port: number) =>
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:${port}/api/voice/local-probe; img-src 'self' data:; media-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;

export interface SpeechSetupOptions {
  /** Actual bound console port. */
  port: number;
  /** Built asset directory (dist/). The landing is speech-setup.html inside it. */
  assetsRoot: string;
  /** Sanitized public speech status (same body as GET /api/voice/status). */
  publicStatus: () => unknown;
  /** Configured public origin (remote mode). Absent in local-only mode. */
  publicOrigin?: string;
  /** Test injection only. */
  instanceId?: string;
}

export function createSpeechSetup(options: SpeechSetupOptions) {
  const instanceId = options.instanceId ?? randomBytes(32).toString('hex');
  if (!/^[0-9a-f]{64}$/.test(instanceId)) throw new Error('speech_setup_instance_invalid');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('speech_setup_port_invalid');
  const port = options.port;
  const canonical = `http://127.0.0.1:${port}`;
  // Origins the public Settings page is ever served from: the configured public
  // origin plus canonical loopback console origins for this exact port.
  const allowedOrigins = new Set<string>([canonical, `http://localhost:${port}`, `http://[::1]:${port}`]);
  if (options.publicOrigin) allowedOrigins.add(options.publicOrigin);
  const unauthenticated = !options.publicOrigin;

  const send = (res: ServerResponse, status: number, value?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers, ...(value !== undefined ? { 'content-type': 'application/json; charset=utf-8' } : {}) });
    res.end(value === undefined ? undefined : JSON.stringify(value));
  };

  /**
   * Strict native boundary: this exact socket's loopback console port, one
   * literal matching Host, no proxy/tunnel headers. Origin must be absent or
   * explicitly allowlisted; cross-site navigation itself is allowed. Requests
   * never carry credentials by contract, and a present Cookie/Authorization
   * header is refused so no ambient authority can ride the probe.
   */
  function native(req: IncomingMessage, pathname: string): 'ok' | 'wrong' {
    if (req.socket.localAddress !== '127.0.0.1' || req.socket.localPort !== port || req.socket.remoteAddress !== '127.0.0.1') return 'wrong';
    if (!unproxied(req)) return 'wrong';
    if (count(req, 'host') !== 1 || !['127.0.0.1', 'localhost', '[::1]'].some(h => req.headers.host === `${h}:${port}`)) return 'wrong';
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== pathname || req.url?.includes('?') || req.url?.includes('#')) return 'wrong';
    if (count(req, 'origin') > 1 || count(req, 'referer') > 1) return 'wrong';
    if (req.headers.authorization || req.headers.cookie) return 'wrong';
    const origin = req.headers.origin;
    // A browser on the Console PC may be viewing the PUBLIC remote URL: its
    // cross-origin probe and the cross-site navigation that follows are both
    // legitimate, so Sec-Fetch-Site never gates these read-only routes. The
    // Origin allowlist carries the decision for CORS, credentials are already
    // refused above, and nothing here mutates state.
    if (typeof origin === 'string' && !allowedOrigins.has(origin)) return 'wrong';
    return 'ok';
  }

  const cors = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    return typeof origin === 'string' && allowedOrigins.has(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
  };

  /**
   * Pre-gate routes. Handles ONLY the exact read-only probe, the landing page,
   * its built assets and the landing's status read. Returns true when the
   * request was claimed (answer or reject); false lets normal routing proceed.
   */
  async function handleLocal(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const claim = (status: number) => { req.resume(); send(res, status); return true; };
    if (path === '/api/voice/local-probe') {
      if (req.method === 'OPTIONS') {
        // Narrowly-scoped preflight: simple GETs never need it, but answer the
        // exact shape a browser could send for this one route — no credentials,
        // no mutation methods, no requested-headers beyond what fetch adds.
        if (native(req, path) !== 'ok' || count(req, 'access-control-request-method') !== 1 || req.headers['access-control-request-method'] !== 'GET') return claim(403);
        const requested = req.headers['access-control-request-headers'];
        if (typeof requested === 'string' && requested.trim()) return claim(403);
        const allow = cors(req);
        if (!allow['access-control-allow-origin']) return claim(403);
        req.resume();
        res.writeHead(204, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...allow, 'access-control-allow-methods': 'GET', 'access-control-max-age': '600' });
        res.end();
        return true;
      }
      if (req.method !== 'GET') return claim(405);
      if (native(req, path) !== 'ok') return claim(403);
      // Minimal nonsecret same-instance answer; never a nonce, token or path.
      send(res, 200, { instanceId }, cors(req));
      return true;
    }
    if (path === '/voice-setup/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return claim(405);
      if (native(req, path) !== 'ok') return claim(403);
      try {
        const html = (await readFile(join(options.assetsRoot, 'speech-setup.html'))).toString('utf8').replaceAll('"/assets/', '"/voice-setup/assets/').replaceAll("'/assets/", "'/voice-setup/assets/");
        const appUrl = options.publicOrigin ? new URL('/?view=settings', options.publicOrigin).href : undefined;
        const page = appUrl ? html.replace('<body>', `<body data-console-url="${appUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}">`) : html;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : page);
      } catch { return claim(503); }
      return true;
    }
    if (path === '/voice-setup/icon.svg' || ASSET.test(path)) {
      if (url.search || url.hash) return claim(403);
      if (req.method !== 'GET' && req.method !== 'HEAD') return claim(405);
      if (native(req, path) !== 'ok') return claim(403);
      try {
        const name = path.slice('/voice-setup/'.length);
        if (name.includes('..') || name.includes('\\') || name !== decodeURIComponent(name)) return claim(404);
        const data = await readFile(join(options.assetsRoot, name));
        res.writeHead(200, { 'content-type': MIME[extname(name)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : data);
      } catch { return claim(404); }
      return true;
    }
    if (path === '/api/voice/status' && (req.method === 'GET' || req.method === 'HEAD')) {
      // Only a native loopback request may take the pre-gate status read (the
      // landing needs it even when Access remote mode would reject localhost).
      // Non-native callers fall through to the normal gated handler.
      if (native(req, path) === 'ok') { send(res, 200, options.publicStatus()); return true; }
      return false;
    }
    return false;
  }

  /**
   * Authenticated same-origin descriptor. Composed AFTER the normal Host/Access
   * gates, so remote users and the local owner alike reach it through the
   * usual checks. It only describes where the SAME process listens.
   */
  function descriptor(req: IncomingMessage): Record<string, unknown> | undefined {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/api/voice/setup' || req.url?.includes('?') || req.url?.includes('#')) return undefined;
    return { instanceId, probeUrl: `${canonical}/api/voice/local-probe`, setupUrl: `${canonical}/voice-setup/`, consolePort: port };
  }

  return { handleLocal, descriptor, instanceId, unauthenticated };
}
export type SpeechSetup = ReturnType<typeof createSpeechSetup>;
