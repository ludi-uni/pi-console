// HTTP boundary for terminal-free speech onboarding — /api/voice/onboarding/*.
//
// Composed AFTER the normal Host/Access gates (server/index.ts calls it next to
// the existing public voice routes). Admission is deliberately stricter than a
// generic POST:
// - Local mode: the request must arrive on the loopback socket with a literal
//   localhost/127.0.0.1 Host on the bound port, zero proxy/tunnel headers (even
//   empty), exactly one matching Origin, sec-fetch-site same-origin, JSON, and
//   exactly one explicit `x-pi-console-speech: 1` custom header.
// - Remote mode: the verified Access principal supplied by the caller plus the
//   exact configured Origin/Host/custom-header checks. A remote POST is REQUEST
//   ONLY — the native host still approves; public GET reads never mutate.
// - The opaque HttpOnly SameSite=Strict path-scoped cookie is minted ONLY on an
//   explicit POST. Its value never appears in any JSON body; receipts bind to
//   the cookie hash AND the remote principal where one exists.
// - GET /status without a session returns an idle sanitized view; it never
//   issues cookies, dialogs or jobs and carries no paths/ports/PIDs/secrets.
// - An explicit confirmed POST /request is the ONLY way the native host dialog
//   is raised: the broker rate-limits prompts and binds each to requestId +
//   immutable payload + Console generation. No separate prompt route exists —
//   a remote-mode host cannot be reached over loopback by design, so a new
//   pre-gate mutation would be the only alternative and is deliberately absent.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readJsonBody } from './body.ts';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import type { VerifiedAccessPrincipal } from './access.ts';
import type { SpeechOnboardingBroker } from './speech-onboarding.ts';
import type { SpeechOnboardingPreflight } from '../shared/speech.ts';

const fail = (code: string): never => { throw new PermissionFault(code); };
const ROUTE = '/api/voice/onboarding/';
const COOKIE = 'pi_speech_onb';
const COOKIE_MAX_AGE_S = 8 * 3600;
const BODY_LIMIT = 8192;
const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const count = (req: IncomingMessage, name: string) => req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length;
const hash = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

const send = (res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(value));
};

export interface SpeechOnboardingHttpOptions {
  broker: SpeechOnboardingBroker;
  /** Bound console port — exact local Host match. */
  port: number;
  /** Configured public origin (remote mode). Absent in local-only mode. */
  publicOrigin?: string;
  /** Verified Access principal for this request (remote mode), already checked. */
  principal?: (req: IncomingMessage) => VerifiedAccessPrincipal | undefined;
  /** Test injection only; production always randomBytes(32). */
  cookieSecret?: () => string;
}

export function createSpeechOnboardingHttp(options: SpeechOnboardingHttpOptions) {
  const { broker } = options;
  const remote = !!options.publicOrigin;
  // Bounded registry of hashes this server actually minted — an arbitrary
  // cookie value is never trusted as an actor identity. Entries expire with
  // the cookie Max-Age; a same-OS forgery still can't mint without a POST.
  const issued = new Map<string, number>();
  const issuedNow = () => Date.now();
  const register = (key: string) => {
    const t = issuedNow();
    for (const [k, at] of issued) if (at <= t - COOKIE_MAX_AGE_S * 1000) issued.delete(k);
    if (issued.size >= 1024) { const oldest = issued.keys().next().value; if (oldest) issued.delete(oldest); }
    issued.set(key, t);
  };
  const known = (key: string) => {
    const at = issued.get(key);
    return at !== undefined && at > issuedNow() - COOKIE_MAX_AGE_S * 1000;
  };

  // Proxy/tunnel headers disqualify outright — even empty or unknown variants.
  const unproxied = (req: IncomingMessage) => !Object.keys(req.headers).some(name =>
    ['forwarded', 'via', 'x-real-ip', 'cdn-loop'].includes(name) || name.startsWith('x-forwarded-') || name.startsWith('cf-'));

  /**
   * Admission for every onboarding route. POST additionally needs the custom
   * header + same-origin fetch metadata. Local mode proves the literal loopback
   * socket; remote mode is already behind Access, so the configured origin
   * plus the custom header carry the CSRF decision. Returns the same-device
   * signal (a hint ONLY — the broker treats it as nothing more).
   */
  function admitted(req: IncomingMessage, post: boolean): { sameDevice: boolean } | undefined {
    if (remote) {
      if (count(req, 'host') !== 1) return undefined;
      const expected = new URL(options.publicOrigin!).host;
      if (req.headers.host !== expected) return undefined;
      if (post) {
        if (count(req, 'origin') !== 1 || req.headers.origin !== options.publicOrigin) return undefined;
        if (count(req, 'sec-fetch-site') !== 1 || req.headers['sec-fetch-site'] !== 'same-origin') return undefined;
        if (count(req, 'content-type') !== 1 || req.headers['content-type'] !== 'application/json') return undefined;
        if (count(req, 'x-pi-console-speech') !== 1 || req.headers['x-pi-console-speech'] !== '1') return undefined;
      }
      return { sameDevice: false };
    }
    // Local mode: the socket itself is the boundary.
    if (req.socket.localAddress !== '127.0.0.1' || req.socket.localPort !== options.port || req.socket.remoteAddress !== '127.0.0.1') return undefined;
    if (!unproxied(req)) return undefined;
    if (count(req, 'host') !== 1 || !['127.0.0.1', 'localhost', '[::1]'].some(h => req.headers.host === `${h}:${options.port}`)) return undefined;
    if (post) {
      if (count(req, 'origin') !== 1 || req.headers.origin !== `http://${req.headers.host}`) return undefined;
      if (count(req, 'sec-fetch-site') !== 1 || req.headers['sec-fetch-site'] !== 'same-origin') return undefined;
      if (count(req, 'content-type') !== 1 || req.headers['content-type'] !== 'application/json') return undefined;
      if (count(req, 'x-pi-console-speech') !== 1 || req.headers['x-pi-console-speech'] !== '1') return undefined;
    }
    return { sameDevice: true };
  }

  function actor(req: IncomingMessage): { key?: string } {
    const cookie = req.headers.cookie;
    if (typeof cookie !== 'string') return {};
    const match = cookie.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`));
    const value = match?.slice(COOKIE.length + 1);
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) return {};
    const key = hash(value);
    return known(key) ? { key } : {};
  }

  function publicStatus(req: IncomingMessage, requestId: unknown, sameDevice: boolean) {
    const { key } = actor(req);
    return broker.status({ actorKey: key, principal: options.principal?.(req), requestId: typeof requestId === 'string' ? requestId : undefined, sameDevice });
  }

  const errorStatus = (e: unknown) =>
    e instanceof PermissionFault && e.code === 'speech_onboarding_forbidden' ? 403
    : e instanceof PermissionFault && e.code === 'speech_onboarding_collision' ? 409
    : e instanceof PermissionFault && e.code === 'speech_onboarding_conflict' ? 409
    : e instanceof PermissionFault && e.code === 'speech_onboarding_rate_limited' ? 429
    : e instanceof PermissionFault && e.code === 'speech_onboarding_capacity' ? 429
    : 400;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(ROUTE)) return false;
    const route = url.pathname.slice(ROUTE.length);
    try {
      if (req.method === 'GET' && route === 'status') {
        const gate = admitted(req, false);
        if (!gate) { send(res, 403, { error: 'speech_onboarding_boundary_rejected' }); return true; }
        const requestId = url.searchParams.get('requestId') ?? undefined;
        if (requestId !== undefined && !UUID_RE.test(requestId)) fail('invalid_arguments');
        send(res, 200, { status: publicStatus(req, requestId ?? undefined, gate.sameDevice), preflight: await broker.preflight() });
        return true;
      }
      if (req.method !== 'POST') { req.resume(); send(res, 404, { error: 'not found' }); return true; }
      const gate = admitted(req, true);
      if (!gate) { req.resume(); send(res, 403, { error: 'speech_onboarding_boundary_rejected' }); return true; }
      const principal = options.principal?.(req);
      if (remote && !principal) { req.resume(); send(res, 401, { error: 'verified_access_required' }); return true; }

      if (route === 'request') {
        const body = await readJsonBody(req, BODY_LIMIT);
        // Exact whitelist; requestHostApproval is the optional remote ask.
        strictPermissionObject(body, ['requestId', 'payload', 'confirmed', 'requestHostApproval'].filter(k => Object.hasOwn(body as object, k)));
        const requestIdValue = (body as { requestId?: unknown }).requestId;
        if (typeof requestIdValue !== 'string' || !UUID_RE.test(requestIdValue)) fail('invalid_arguments');
        if ((body as { confirmed?: unknown }).confirmed !== true) fail('speech_confirmation_required');
        // Mint the per-browser opaque cookie ONLY on an explicit request.
        let { key } = actor(req);
        let mint: string | undefined;
        if (!key) { mint = randomBytes(32).toString('hex'); key = hash(mint); }
        const entry = await broker.request({ actorKey: key as string, principal, sameDevice: gate.sameDevice, body });
        // Rejected requests must not fill the cookie registry or evict the
        // requester of an already-running approval/job.
        if (mint) register(key as string);
        const headers: Record<string, string> = {};
        if (mint) headers['set-cookie'] = `${COOKIE}=${mint}; Path=/api/voice/onboarding; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}${remote ? '; Secure' : ''}`;
        send(res, 202, { status: broker.status({ actorKey: key as string, principal, requestId: entry.requestId, sameDevice: gate.sameDevice }), preflight: await broker.preflight() }, headers);
        return true;
      }
      if (route === 'cancel') {
        const { key } = actor(req);
        if (!key) fail('speech_onboarding_forbidden');
        const body = await readJsonBody(req, BODY_LIMIT);
        strictPermissionObject(body, ['requestId']);
        await broker.cancel({ actorKey: key as string, principal, requestId: (body as { requestId: unknown }).requestId as string });
        send(res, 200, { status: publicStatus(req, (body as { requestId: string }).requestId, gate.sameDevice), preflight: await broker.preflight() });
        return true;
      }
      req.resume();
      send(res, 404, { error: 'not found' });
    } catch (e) {
      req.resume();
      send(res, errorStatus(e), { error: e instanceof PermissionFault ? e.code : 'speech_onboarding_unavailable' });
    }
    return true;
  }

  return { handle };
}
export type SpeechOnboardingHttp = ReturnType<typeof createSpeechOnboardingHttp>;
