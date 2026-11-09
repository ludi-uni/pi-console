import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonBody } from './body.ts';
import { strictPermissionObject, PermissionFault } from './workspace-permissions.ts';
import { LocalOwnerProfile } from './local-owner-profile.ts';
import { folderMcpHttp, type FolderMcp } from './folder-mcp.ts';
const hash = (s: string) => createHash('sha256').update(s).digest();
const hex = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const equal = (a: Buffer, b: unknown) => timingSafeEqual(a, hex(b) ? hash(b) : Buffer.alloc(32)) && hex(b);
const count = (r: IncomingMessage, n: string) => r.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === n).length;
const proxy = (r: IncomingMessage) => Object.keys(r.headers).some(k => k === 'forwarded' || k === 'via' || k === 'x-real-ip' || k.startsWith('cf-') || k.startsWith('x-forwarded-'));
const send = (r: ServerResponse, status: number, value: unknown) => { r.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); r.end(JSON.stringify(value)); };
export interface LocalOwnerBootstrapOptions {
    enabled?: boolean;
    managementToken?: string;
    nonce: string;
    profileFile: string;
    legacyKeys?: readonly string[];
    assetsRoot?: string;
    now?: () => number;
    folders?: FolderMcp;
    /** Trusted installed composition; OFF unless explicitly supplied. */
    resume?: { status():{enabled:boolean};ownerBroker(context: {ownerVerify:(req:IncomingMessage)=>boolean;ownerExpiry:(req:IncomingMessage)=>number|undefined;port:()=>number}):(req:IncomingMessage,res:ServerResponse)=>Promise<boolean>;dispose():Promise<void> };
    consolePort?: number;
    settings?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
    /** Trusted local-owner voice/STT management boundary; session verify is enforced inside. */
    voice?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
    control?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
    /** Credential profile provisioning lane (read/control/final MCP keys). Default
     * preserves the standalone/test behavior; the release composition sets false so
     * existing persisted state stays readable but no new credential can be written. */
    credentials?: boolean;
    /** Trusted composition/test injection only; never configurable from HTTP/env/profile. */
    randomKey?: () => string;
    delegate?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}
/** Reuses trusted manager possession proof, never browser/static header identity.
 * Local owner listener is lazy, separate from public UI and the MCP listener. */
export function createLocalOwnerBootstrap(options: LocalOwnerBootstrapOptions) {
    const now = options.now ?? Date.now, configured = options.enabled === true && /^[0-9a-f]{48}$/.test(options.managementToken ?? '') && /^[0-9a-f]{32}$/.test(options.nonce);
    const epoch = randomUUID(), cookieName = 'pi_console_local_owner_' + epoch.replaceAll('-', '').slice(0, 12);
    const randomKey = () => { const key = options.randomKey ? options.randomKey() : randomBytes(32).toString('hex'); if (!hex(key)) throw new PermissionFault('owner_entropy_unavailable'); return key; };
    let server: Server | undefined, port: number | null = null, opening: Promise<void> | undefined, disposed = false, failures = 0;
    const outcomes = new Map<string, {
        expiresAt: number;
    }>(), reserved: Buffer[] = [], sessions = new Map<string, {
        digest: Buffer;
        expiresAt: number;
    }>();
    let bootstrap: {
        digest: Buffer;
        expiresAt: number;
    } | undefined;
    const profile = new LocalOwnerProfile(options.profileFile, options.legacyKeys ?? [], key => reserved.some(d => timingSafeEqual(d, hash(key))), now);
    const native = (req: IncomingMessage, post: boolean) => !disposed && !!server?.listening && req.socket.localAddress === '127.0.0.1' && req.socket.localPort === port && req.socket.remoteAddress === '127.0.0.1' && count(req, 'host') === 1 && req.headers.host === `127.0.0.1:${port}` && !proxy(req) && (!post || req.method === 'POST' && req.headers.origin === `http://127.0.0.1:${port}` && req.headers['sec-fetch-site'] === 'same-origin' && req.headers['content-type'] === 'application/json' && ['origin', 'sec-fetch-site', 'content-type'].every(n => count(req, n) === 1));
    const session = (req: IncomingMessage) => {
        if (!native(req, true) || count(req, 'cookie') !== 1)
            return;
        const cookies = String(req.headers.cookie ?? '').split(';').map(v => v.trim().split('='));
        const matches = cookies.filter(c => c[0] === cookieName);
        if (matches.length !== 1 || !hex(matches[0][1]))
            return;
        const token = matches[0][1], key = hash(token).toString('hex'), s = sessions.get(key);
        if (!s || s.expiresAt <= now() || !equal(s.digest, token)) {
            sessions.delete(key);
            return;
        }
        return { key, ...s };
    };
    const verify = (req: IncomingMessage) => !!session(req);
    /**
     * Validates the request once through the full native boundary, then returns a
     * lease guard that re-checks the *session record* (still present, unexpired,
     * listener alive) instead of the request socket — long-running jobs must not
     * fail just because the keepalive connection or tab moved on. Returns
     * undefined when the initial boundary check fails. No secret ever leaves.
     */
    const authorize = (req: IncomingMessage): (() => void) | undefined => {
        const s = session(req);
        if (!s)
            return;
        const key = s.key;
        return () => {
            const current = sessions.get(key);
            if (disposed || !server?.listening || !current || current.expiresAt <= now())
                throw new PermissionFault('owner_session_expired');
        };
    };
    const resumeHttp=options.resume?.ownerBroker({ownerVerify:verify,ownerExpiry:req=>session(req)?.expiresAt,port:()=>port??0});
    const folderHttp = options.folders && folderMcpHttp(options.folders, verify, req => session(req)?.expiresAt);
    const clearCookie = (res: ServerResponse) => res.setHeader('set-cookie', `${cookieName}=; Path=/local-owner; HttpOnly; SameSite=Strict; Max-Age=0`);
    async function handle(req: IncomingMessage, res: ServerResponse) {
        if (!native(req, false)) {
            req.resume();
            send(res, 403, { error: 'local_owner_boundary_rejected' });
            return;
        }
        const url = req.url ?? '';
        if (url.includes('?') || !url.startsWith('/local-owner')) {
            req.resume();
            send(res, 404, {});
            return;
        }
        if (req.method === 'GET' && (url === '/local-owner/' || /^\/local-owner\/assets\/[A-Za-z0-9._-]+\.(js|css)$/.test(url))) {
            if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}` || req.headers['sec-fetch-site'] === 'cross-site') {
                send(res, 403, {});
                return;
            }
            if (!options.assetsRoot) {
                send(res, 503, { error: 'local_owner_assets_unavailable' });
                return;
            }
            try {
                const p = url === '/local-owner/' ? 'owner.html' : url.replace('/local-owner/', ''), raw = await readFile(join(options.assetsRoot, p)), data = p.endsWith('.html') ? raw.toString('utf8').replaceAll('"/assets/', '"/local-owner/assets/') : raw;
                res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.css') ? 'text/css' : 'application/javascript', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
                res.end(data);
            }
            catch {
                send(res, 503, { error: 'local_owner_assets_unavailable' });
            }
            return;
        }
        if (resumeHttp && await resumeHttp(req,res)) return;
        if (folderHttp && await folderHttp(req, res)) return;
        if (options.control && await options.control(req, res)) return;
        if (options.voice && await options.voice(req, res)) return;
        if (options.settings && await options.settings(req, res)) return;
        if (!native(req, true)) {
            req.resume();
            send(res, 403, { error: 'local_owner_browser_required' });
            return;
        }
        try {
            if (url === '/local-owner/auth/claim') {
                const b = await readJsonBody(req, 4096);
                strictPermissionObject(b, ['code']);
                const ok = bootstrap && bootstrap.expiresAt > now() && failures < 8 && equal(bootstrap.digest, b.code);
                if (!ok) {
                    failures++;
                    send(res, 401, { error: 'bootstrap_rejected' });
                    return;
                }
                bootstrap = undefined;
                failures = 0;
                for (const [k, s] of sessions)
                    if (s.expiresAt <= now())
                        sessions.delete(k);
                if (sessions.size >= 8)
                    throw new PermissionFault('owner_session_capacity');
                const token = randomKey(), digest = hash(token), expiresAt = now() + 600000;
                sessions.set(digest.toString('hex'), { digest, expiresAt });
                reserved.push(digest);
                res.setHeader('set-cookie', `${cookieName}=${token}; Path=/local-owner; HttpOnly; SameSite=Strict; Max-Age=600`);
                send(res, 200, { authenticated: true, expiresAt });
                return;
            }
            const s = session(req);
            if (!s) {
                req.resume();
                send(res, 401, { error: 'local_owner_login_required' });
                return;
            }
            const assertSession = () => {
                if (!session(req))
                    throw new PermissionFault('owner_session_expired');
            };
            if (url === '/local-owner/auth/status') {
                strictPermissionObject(await readJsonBody(req, 4096), []);
                const view = await profile.view();
                assertSession();
                send(res, 200, { authenticated: true, expiresAt: s.expiresAt, profile: view,resumeAvailable:options.resume?.status().enabled===true, ...(options.consolePort ? { consoleOrigin: `http://127.0.0.1:${options.consolePort}` } : {}) });
                return;
            }
            if (url === '/local-owner/auth/logout') {
                strictPermissionObject(await readJsonBody(req, 4096), []);
                sessions.delete(s.key);
                clearCookie(res);
                send(res, 200, { authenticated: false });
                return;
            }
            if ((url === '/local-owner/credentials/save' || url === '/local-owner/credentials/result') && options.credentials === false) {
                req.resume();
                send(res, 404, {});
                return;
            }
            if (url === '/local-owner/credentials/save') {
                const b = await readJsonBody(req, 4096), saved = await profile.save(b, assertSession);
                assertSession();
                send(res, 200, saved);
                return;
            }
            if (url === '/local-owner/credentials/result') {
                const b = await readJsonBody(req, 4096);
                strictPermissionObject(b, ['requestId']);
                const result = await profile.result(b.requestId);
                assertSession();
                send(res, 200, result);
                return;
            }
            if (['/local-owner/api/local-mcp/', '/local-owner/api/workspace-permissions/'].some(p => url.startsWith(p)) && options.delegate) {
                const original = req.url;
                try {
                    req.url = url.slice('/local-owner'.length);
                    if (await options.delegate(req, res))
                        return;
                }
                finally {
                    req.url = original;
                }
            }
            req.resume();
            send(res, 404, {});
        }
        catch (e) {
            send(res, 409, { error: e instanceof PermissionFault ? e.code : 'local_owner_request_unavailable' });
        }
    }
    async function open() {
        if (opening)
            return opening;
        if (server?.listening)
            return;
        opening = (async () => {
            const s = createServer((req, res) => void handle(req, res).catch(() => {
                if (!res.destroyed && !res.writableEnded)
                    send(res, 503, { error: 'local_owner_unavailable' });
            }));
            server = s;
            s.requestTimeout = 5000;
            s.headersTimeout = 5000;
            try {
                await new Promise<void>((r, j) => { s.once('error', j); s.listen(0, '127.0.0.1', () => { s.off('error', j); r(); }); });
                const a = s.address();
                if (!a || typeof a === 'string' || a.address !== '127.0.0.1' || a.family !== 'IPv4')
                    throw Error();
                port = a.port;
                s.once('close', () => { bootstrap = undefined; sessions.clear(); port = null; });
            }
            catch {
                s.closeAllConnections();
                if (s.listening)
                    await new Promise<void>(r => s.close(() => r()));
                throw new PermissionFault('local_owner_listener_unavailable');
            }
        })();
        try {
            await opening;
        }
        finally {
            opening = undefined;
        }
    }
    async function issue(req: IncomingMessage, res: ServerResponse, body: any) {
        strictPermissionObject(body, ['challenge', 'requestId']);
        const id = body.requestId, validId = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
        const expected = configured ? createHmac('sha256', options.managementToken!).update(`pi-console-local-owner:${options.nonce}:${validId ? id : ''}`).digest() : Buffer.alloc(32), candidate = hex(req.headers['x-pi-console-manage-proof']) ? Buffer.from(req.headers['x-pi-console-manage-proof'], 'hex') : Buffer.alloc(32);
        const trusted = configured && !disposed && validId && body.challenge === options.nonce && timingSafeEqual(expected, candidate) && req.method === 'POST' && req.socket.localAddress === '127.0.0.1' && req.socket.remoteAddress === '127.0.0.1' && req.headers.host === `127.0.0.1:${req.socket.localPort}` && count(req, 'host') === 1 && count(req, 'x-pi-console-manage-proof') === 1 && count(req, 'content-type') === 1 && !proxy(req) && !req.headers.origin && !req.headers['sec-fetch-site'] && req.headers['content-type'] === 'application/json';
        candidate.fill(0);
        expected.fill(0);
        if (!trusted) {
            send(res, 403, { error: 'managed_owner_proof_required' });
            return;
        }
        if (outcomes.has(id)) {
            send(res, 409, { error: 'bootstrap_delivery_not_replayed' });
            return;
        }
        if (outcomes.size >= 64) {
            send(res, 409, { error: 'bootstrap_capacity' });
            return;
        }
        outcomes.set(id, { expiresAt: now() + 120000 });
        await open();
        if (disposed || !server?.listening || port === null)
            throw new PermissionFault('local_owner_listener_unavailable');
        const code = randomKey(), digest = hash(code);
        reserved.push(digest);
        bootstrap = { digest, expiresAt: now() + 120000 };
        failures = 0;
        send(res, 200, { url: `http://127.0.0.1:${port}/local-owner/`, code, expiresAt: bootstrap.expiresAt });
    }
    return { verify, authorize, expiresAt: (req: IncomingMessage) => session(req)?.expiresAt, issue, profile, async startBroker() { if (!configured || disposed) throw new PermissionFault('local_owner_setup_incomplete'); await open(); }, status: () => ({ configured, listening: !!server?.listening, port }), async dispose() {
            if (disposed)
                return;
            disposed = true;
        await options.resume?.dispose();
            options.folders?.dispose();
            bootstrap = undefined;
            sessions.clear();
            for (const d of reserved)
                d.fill(0);
            if (opening)
                await opening.catch(() => { });
            server?.closeAllConnections();
            if (server?.listening)
                await new Promise<void>(r => server!.close(() => r()));
            port = null;
        } };
}
